const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const SESSION_DAYS = 30;
const BCRYPT_ROUNDS = 10;
const INACTIVITY_ACCOUNT_DAYS = 21; // Automatické smazání účtu po 3 týdnech neaktivity

let isInitialized = false;
const userTouchCache = new Map(); // id/key -> timestamp posledního zápisu do DB

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
      max: 5
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
    lastActiveAt: user.last_active_at || user.created_at
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
    password.length <= 100 &&
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
  if (!pool) return;
  try {
    // 1. Promazání expirovaných session tokenů (> 30 dní)
    const sessionRes = await pool.query('DELETE FROM auth_sessions WHERE expires_at < NOW()');
    if (sessionRes.rowCount > 0) {
      console.log(`[AUTH] Automaticky smazáno ${sessionRes.rowCount} expirovaných sessions.`);
    }

    // 2. Promazání neaktivních účtů po 3 týdnech (21 dní)
    const inactiveRes = await pool.query(
      `SELECT username FROM users WHERE last_active_at < NOW() - INTERVAL '21 days'`
    );
    if (inactiveRes.rowCount > 0) {
      const usernames = inactiveRes.rows.map((r) => r.username);
      const delRes = await pool.query(
        `DELETE FROM users WHERE last_active_at < NOW() - INTERVAL '21 days'`
      );
      console.log(
        `[AUTH] Automaticky smazáno ${delRes.rowCount} účtů neaktivních déle než 21 dní: ${usernames.join(', ')}`
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
  } catch (err) {
    console.error('[AUTH] Čištění expirovaných dat selhalo:', err.message);
  }
}

async function init(onUserDeletedCallback) {
  if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
    isInitialized = false;
    throw new Error('SESSION_SECRET není nastaveno');
  }
  if (!pool) {
    isInitialized = false;
    console.warn('[AUTH] DATABASE_URL není nastaveno; účty jsou vypnuté, guest režim funguje dál.');
    return false;
  }
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
    isInitialized = false;
    throw err;
  }
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
  if (!isConfigured()) return false;
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
  return { token, expiresAt };
}

async function getUserByToken(token) {
  if (!isConfigured() || !token) return null;
  const result = await pool.query(
    `SELECT u.id, u.username, u.created_at, u.last_active_at
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
  deleteSession,
  deleteAccount,
  isConfigured,
  touchActivity,
  pruneExpiredData
};
