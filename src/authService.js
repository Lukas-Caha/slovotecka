const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const SESSION_DAYS = 30;
const BCRYPT_ROUNDS = 10;
const INACTIVITY_ACCOUNT_DAYS = 21; // Automatické smazání účtu po 3 týdnech neaktivity

let isInitialized = false;
const userTouchCache = new Map(); // id/key -> timestamp posledního zápisu do DB

function getSslConfig() {
  const url = new URL(process.env.DATABASE_URL || 'postgres://localhost');
  const mode = url.searchParams.get('sslmode');
  if (process.env.DB_SSL === 'false' || (process.env.DB_SSL !== 'true' && mode === 'disable')) return false;
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  if (process.env.DB_SSL === 'true' || (mode && mode !== 'disable') || url.searchParams.has('sslrootcert') || (!local && process.env.NODE_ENV === 'production')) {
    const caFile = process.env.DB_SSL_CA_FILE || url.searchParams.get('sslrootcert');
    // Render's private, single-label Postgres hosts use self-signed certificates.
    // Keep TLS enabled there, without relaxing verification for public hosts,
    // other platforms, an explicit verification mode, or a supplied CA.
    const renderInternal = process.env.RENDER === 'true' && /^dpg-[a-z0-9-]+$/i.test(url.hostname);
    const strictVerification = Boolean(caFile) || ['verify-ca', 'verify-full'].includes(mode);
    const ssl = { rejectUnauthorized: !renderInternal || strictVerification };
    if (!ssl.rejectUnauthorized) {
      console.log('[AUTH] Interní Render PostgreSQL: TLS zapnuto, self-signed certifikát v privátní síti.');
    }
    for (const [key, file] of [['ca', caFile], ['cert', url.searchParams.get('sslcert')], ['key', url.searchParams.get('sslkey')]]) {
      if (file) ssl[key] = require('fs').readFileSync(file, 'utf8');
    }
    return ssl;
  }
  return false;
}

function getConnectionString() {
  const url = new URL(process.env.DATABASE_URL);
  // pg would replace the verified SSL object if these parameters remained in the URL.
  for (const key of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'ssl']) url.searchParams.delete(key);
  return url.toString();
}

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: getConnectionString(),
      ssl: getSslConfig(),
      max: 10
    })
  : null;

if (pool) {
  pool.on('error', (err) => {
    console.error('[AUTH PG POOL ERROR]', err.message);
  });
}

function hashToken(token) {
  return crypto
    .createHmac('sha256', process.env.SESSION_SECRET || 'development-only-session-secret')
    .update(String(token || ''))
    .digest('hex');
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    createdAt: user.created_at,
    lastActiveAt: user.last_active_at || user.created_at,
    color: user.color || null,
    emote: user.emote || null,
    stats: user.stats || null
  };
}

function normalizeUsername(username) {
  return String(username || '').trim().normalize('NFC');
}

function validateUsername(username) {
  return (
    typeof username === 'string' &&
    username.length >= 3 &&
    username.length <= 30 &&
    /^(?!\s+$)[\p{L}\p{N}_ .-]+$/u.test(username)
  );
}

function validatePassword(password) {
  return (
    typeof password === 'string' &&
    password.length >= 6 &&
    !bcrypt.truncates(password) &&
    /[0-9A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/.test(password)
  );
}

async function touchActivity(userIdOrKey) {
  if (!pool || !isInitialized || !userIdOrKey) return;
  const now = Date.now();
  const key = String(userIdOrKey).toLowerCase();
  const last = userTouchCache.get(key) || 0;
  // Zápis do DB omezíme maximálně na 1x za 10 minut na uživatele
  if (now - last < 10 * 60 * 1000) return;
  userTouchCache.set(key, now);

  try {
    if (typeof userIdOrKey === 'number' || /^\d+$/.test(String(userIdOrKey))) {
      await pool.query('UPDATE users SET last_active_at = NOW() WHERE id = $1', [userIdOrKey]);
    } else {
      await pool.query('UPDATE users SET last_active_at = NOW() WHERE username_key = $1', [key]);
    }
  } catch (err) {
    console.error('[AUTH] Chyba při aktualizaci aktivity:', err.message);
  }
}

async function pruneExpiredData(onUserDeletedCallback) {
  if (!pool || !isInitialized) return;
  try {
    // 1. Promazání expirovaných session tokenů (> 30 dní)
    const sessionRes = await pool.query('DELETE FROM auth_sessions WHERE expires_at < NOW()');
    if (sessionRes.rowCount > 0) {
      console.log(`[AUTH] Automaticky smazáno ${sessionRes.rowCount} expirovaných sessions.`);
    }

    // 2. Bezpečné promazání pouze velmi dlouho neaktivních účtů (> 180 dní výchozí, administrátoři vyloučeni)
    const adminUsernames = (process.env.ADMIN_USERNAMES || '')
      .split(',')
      .map((u) => u.trim().toLowerCase())
      .filter(Boolean);

    const inactiveDays = parseInt(process.env.INACTIVITY_ACCOUNT_DAYS, 10) || 180;
    if (inactiveDays > 0) {
      const inactiveRes = await pool.query(
        `SELECT username FROM users 
         WHERE last_active_at < NOW() - ($1 || ' days')::INTERVAL 
           AND NOT (username_key = ANY($2::text[]))`,
        [String(inactiveDays), adminUsernames]
      );
      if (inactiveRes.rowCount > 0) {
        const usernames = inactiveRes.rows.map((r) => r.username);
        const delRes = await pool.query(
          `DELETE FROM users 
           WHERE last_active_at < NOW() - ($1 || ' days')::INTERVAL 
             AND NOT (username_key = ANY($2::text[]))`,
          [String(inactiveDays), adminUsernames]
        );
        console.log(
          `[AUTH] Automaticky smazáno ${delRes.rowCount} účtů neaktivních déle než ${inactiveDays} dní: ${usernames.join(', ')}`
        );
        if (typeof onUserDeletedCallback === 'function') {
          for (const u of usernames) {
            try {
              onUserDeletedCallback(u);
            } catch (e) {
              console.error('[AUTH] Callback selhal při mazání profilu:', e.message);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('[AUTH] Čištění expirovaných dat selhalo:', err.message);
  }
}

async function init(onUserDeletedCallback, maxRetries = 5, retryDelayMs = 2000) {
  if (pool && process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
    isInitialized = false;
    throw new Error('SESSION_SECRET není nastaveno');
  }
  if (!pool) {
    isInitialized = false;
    console.warn('[AUTH] DATABASE_URL není nastaveno; účty jsou vypnuté, guest režim funguje dál.');
    return false;
  }

  let lastError = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id BIGSERIAL PRIMARY KEY,
          username TEXT NOT NULL,
          username_key TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
        ALTER TABLE users ADD COLUMN IF NOT EXISTS color TEXT;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS emote TEXT;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS stats JSONB;
        CREATE TABLE IF NOT EXISTS auth_sessions (
          token_hash CHAR(64) PRIMARY KEY,
          user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS auth_sessions_expires_idx ON auth_sessions(expires_at);
        CREATE INDEX IF NOT EXISTS users_last_active_idx ON users(last_active_at);
      `);

      isInitialized = true;
      await pruneExpiredData(onUserDeletedCallback);
      console.log('[AUTH] PostgreSQL databáze je připravená.');
      return true;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        console.warn(`[AUTH] Pokus o připojení k PostgreSQL č. ${attempt}/${maxRetries} selhal (${err.message}). Čekám ${retryDelayMs}ms...`);
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }
  }

  isInitialized = false;
  throw lastError;
}

function isConfigured() {
  return Boolean(pool) && isInitialized;
}

async function register(username, password) {
  if (!isConfigured()) throw new Error('DATABASE_NOT_CONFIGURED');
  const clean = normalizeUsername(username);
  if (!validateUsername(clean)) throw new Error('INVALID_USERNAME');
  if (!validatePassword(password)) throw new Error('INVALID_PASSWORD');

  const usernameKey = clean.toLocaleLowerCase('cs-CZ');
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  try {
    const result = await pool.query(
      `INSERT INTO users (username, username_key, password_hash, created_at, last_active_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       RETURNING id, username, created_at, last_active_at`,
      [clean, usernameKey, passwordHash]
    );
    return publicUser(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') throw new Error('USERNAME_TAKEN');
    throw err;
  }
}

async function login(username, password) {
  if (!isConfigured()) throw new Error('DATABASE_NOT_CONFIGURED');
  const clean = normalizeUsername(username);
  const result = await pool.query(
    'SELECT * FROM users WHERE username_key = $1',
    [clean.toLocaleLowerCase('cs-CZ')]
  );
  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(String(password || ''), user.password_hash))) {
    throw new Error('INVALID_CREDENTIALS');
  }

  // Obnovení času aktivity
  touchActivity(user.id);
  return publicUser(user);
}

async function isUsernameTaken(username) {
  if (!isConfigured()) {
    if (pool) throw new Error('AUTH_UNAVAILABLE');
    return false;
  }
  const clean = normalizeUsername(username);
  if (!clean) return false;
  const result = await pool.query(
    'SELECT 1 FROM users WHERE username_key = $1',
    [clean.toLocaleLowerCase('cs-CZ')]
  );
  return result.rowCount > 0;
}

async function createSession(userId) {
  if (!isConfigured()) throw new Error('DATABASE_NOT_CONFIGURED');
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await pool.query(
    'INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
    [hashToken(token), userId, expiresAt]
  );
  // Omezení počtu aktivních relací na uživatele na max 10
  try {
    await pool.query(
      `DELETE FROM auth_sessions 
       WHERE user_id = $1 
         AND token_hash NOT IN (
           SELECT token_hash FROM auth_sessions 
           WHERE user_id = $1 
           ORDER BY created_at DESC 
           LIMIT 10
         )`,
      [userId]
    );
  } catch (cleanErr) {}
  return { token, expiresAt };
}

async function getUserByToken(token) {
  if (!isConfigured() || !token) return null;
  const result = await pool.query(
    `SELECT u.id, u.username, u.created_at, u.last_active_at, u.color, u.emote, u.stats
     FROM auth_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
    [hashToken(token)]
  );
  const user = result.rows[0];
  if (user) {
    touchActivity(user.id);
  }
  return publicUser(user);
}

async function saveUserProfile(username, { color, emote, stats } = {}) {
  if (!isConfigured() || !username) return;
  const usernameKey = normalizeUsername(username).toLocaleLowerCase('cs-CZ');
  try {
    await pool.query(
      `UPDATE users 
       SET color = COALESCE($2, color), 
           emote = CASE WHEN $5::boolean THEN $3 ELSE emote END,
           stats = COALESCE($4::jsonb, stats) 
       WHERE username_key = $1`,
      [
        usernameKey,
        color !== undefined && color !== null ? String(color) : null,
        emote !== undefined ? (emote ? String(emote) : null) : null,
        stats ? JSON.stringify(stats) : null,
        emote !== undefined
      ]
    );
  } catch (err) {
    console.error('[AUTH] Nepodařilo se uložit profil uživatele do DB:', err.message);
  }
}

async function getUserProfile(username) {
  if (!isConfigured() || !username) return null;
  const usernameKey = normalizeUsername(username).toLocaleLowerCase('cs-CZ');
  try {
    const result = await pool.query(
      'SELECT color, emote, stats FROM users WHERE username_key = $1',
      [usernameKey]
    );
    return result.rows[0] || null;
  } catch (err) {
    return null;
  }
}

async function deleteSession(token) {
  if (isConfigured() && token) {
    await pool.query('DELETE FROM auth_sessions WHERE token_hash = $1', [hashToken(token)]);
  }
}

async function deleteAccount(token) {
  if (!isConfigured() || !token) return null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT u.id, u.username
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > NOW()
       FOR UPDATE OF u`,
      [hashToken(token)]
    );
    const user = result.rows[0];
    if (!user) {
      await client.query('ROLLBACK');
      return null;
    }
    await client.query('DELETE FROM users WHERE id = $1', [user.id]);
    await client.query('COMMIT');
    return user.username;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  init,
  register,
  login,
  isUsernameTaken,
  createSession,
  getUserByToken,
  saveUserProfile,
  getUserProfile,
  deleteSession,
  deleteAccount,
  isConfigured,
  touchActivity,
  pruneExpiredData
};
