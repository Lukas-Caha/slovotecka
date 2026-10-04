const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Načtení proměnných prostředí z .env (Node.js 20.6+ nebo záložní parser)
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile();
  } catch (err) {}
} else {
  try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf-8');
      for (const line of envContent.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"](.*)['"]$/, '$1');
          if (key && process.env[key] === undefined) {
            process.env[key] = val;
          }
        }
      }
    }
  } catch (err) {}
}

const helmet = require('helmet');
const { Server } = require('socket.io');
const gameManager = require('./src/roomManager');
const emoteService = require('./src/emoteService');
const wordService = require('./src/wordService');
const playerProfileManager = require('./src/playerProfileManager');
const authService = require('./src/authService');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const AUTH_COOKIE = 'slovo_session';
const REPORT_LOG_PATH = path.join(__dirname, 'src', 'data', 'reports.log');
const REPORT_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

// Důvěra v reverzní proxy (Render, Nginx, Cloudflare)
app.set('trust proxy', 1);
app.use(express.json({ limit: '20kb' }));

function getSessionToken(req) {
  try {
    const cookies = String(req?.headers?.cookie || '').split(';');
    const item = cookies.find((entry) => entry.trim().startsWith(`${AUTH_COOKIE}=`));
    return item ? decodeURIComponent(item.trim().slice(AUTH_COOKIE.length + 1)) : null;
  } catch (err) {
    return null;
  }
}

// Ochrana před brute-force a DoS útoky na autentizační endpointy (bcrypt ochrana)
function createAuthRateLimiter({ windowMs, maxRequests, message }) {
  const hits = new Map();
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of hits.entries()) {
      if (now > entry.resetTime) {
        hits.delete(ip);
      }
    }
  }, 5 * 60 * 1000);
  if (cleanupTimer.unref) cleanupTimer.unref();

  return (req, res, next) => {
    const clientIp = req.ip || req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let entry = hits.get(clientIp);

    if (!entry || now > entry.resetTime) {
      entry = { count: 1, resetTime: now + windowMs };
      hits.set(clientIp, entry);
      return next();
    }

    entry.count++;
    if (entry.count > maxRequests) {
      const retryAfterSec = Math.ceil((entry.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfterSec);
      return res.status(429).json({
        error: 'RATE_LIMIT_EXCEEDED',
        message: message || `Příliš mnoho pokusů. Zkus to znovu za ${retryAfterSec} s.`
      });
    }

    next();
  };
}

const loginLimiter = createAuthRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 10,
  message: 'Příliš mnoho pokusů o přihlášení. Chvíli počkej (limit 10/min).'
});

const registerLimiter = createAuthRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 5,
  message: 'Příliš mnoho pokusů o registraci. Chvíli počkej (limit 5/min).'
});

function setSessionCookie(res, token, maxAgeSeconds) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=${encodeURIComponent(token)}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=Lax${secure}`);
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure}`);
}

function pruneReportLog() {
  try {
    if (!fs.existsSync(REPORT_LOG_PATH)) return;
    const now = Date.now();
    const rows = fs.readFileSync(REPORT_LOG_PATH, 'utf8').split(/\r?\n/).filter(Boolean);
    const retained = rows.filter((row) => {
      try {
        const reportDate = Date.parse(JSON.parse(row).date);
        return !Number.isFinite(reportDate) || now - reportDate <= REPORT_RETENTION_MS;
      } catch (err) {
        return true;
      }
    });
    if (retained.length !== rows.length) {
      const tempPath = `${REPORT_LOG_PATH}.tmp`;
      fs.writeFileSync(tempPath, retained.length ? `${retained.join('\n')}\n` : '', 'utf8');
      fs.renameSync(tempPath, REPORT_LOG_PATH);
    }
  } catch (err) {
    console.error('[DSA REPORT] Automatické čištění hlášení selhalo:', err.message);
  }
}

io.use(async (socket, next) => {
  try {
    socket.data = socket.data || {};
    socket.data.authUser = await authService.getUserByToken(socket.handshake.headers.cookie
      ? getSessionToken({ headers: socket.handshake.headers })
      : null);
    next();
  } catch (err) {
    next();
  }
});

// Bezpečnostní HTTP hlavičky (Helmet)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://www.youtube.com",
          "https://s.ytimg.com"
        ],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: [
          "'self'",
          "data:",
          "https:",
          "https://*.7tv.app",
          "https://*.7tv.io",
          "https://i.ytimg.com",
          "https://yt3.ggpht.com"
        ],
        fontSrc: ["'self'", "data:"],
        connectSrc: [
          "'self'",
          "ws:",
          "wss:",
          "https://7tv.io",
          "https://api.7tv.app",
          "https://www.googleapis.com"
        ],
        frameSrc: [
          "'self'",
          "https://www.youtube.com",
          "https://www.youtube-nocookie.com"
        ],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
      }
    },
    crossOriginEmbedderPolicy: false
  })
);

// Inicializace 7TV emotů (Vernaton999 Kick & 7TV + Globální)
emoteService.init();

// Obnovení uloženého stavu hry z disku (pokud existuje a je aktuální)
gameManager.loadStateFromFile();

// Statické soubory z /public
app.use(express.static(path.join(__dirname, 'public')));

// Ping / Health endpoint pro UptimeRobot a Render keep-alive
app.get(['/ping', '/health'], (req, res) => {
  res.status(200).send('pong');
});

// Účty jsou volitelné; bez DATABASE_URL zůstává funkční guest režim.
app.get('/api/auth/me', async (req, res) => {
  try {
    const user = await authService.getUserByToken(getSessionToken(req));
    res.json({ authenticated: Boolean(user), user });
  } catch (err) {
    console.error('[AUTH] Chyba při načítání session:', err);
    res.status(503).json({ error: 'AUTH_UNAVAILABLE', message: 'Přihlášení je momentálně nedostupné.' });
  }
});

app.post('/api/auth/register', registerLimiter, async (req, res) => {
  try {
    const user = await authService.register(req.body?.username, req.body?.password);
    const session = await authService.createSession(user.id);
    playerProfileManager.markAsRegistered(user.username, user);
    setSessionCookie(res, session.token, 30 * 24 * 60 * 60);
    res.status(201).json({ user });
  } catch (err) {
    const known = {
      DATABASE_NOT_CONFIGURED: [503, 'AUTH_UNAVAILABLE', 'Databáze účtů není nakonfigurovaná.'],
      INVALID_USERNAME: [400, 'INVALID_USERNAME', 'Přezdívka musí mít 3–30 znaků a může obsahovat písmena, čísla, mezery, tečku, pomlčku a podtržítko.'],
      INVALID_PASSWORD: [400, 'INVALID_PASSWORD', 'Heslo musí mít 6–100 znaků a obsahovat číslo nebo velké písmeno.'],
      USERNAME_TAKEN: [409, 'USERNAME_TAKEN', 'Tato přezdívka už je registrovaná.']
    }[err.message];
    if (!known) console.error('[AUTH] Registrace selhala:', err);
    const [status, code, message] = known || [500, 'AUTH_ERROR', 'Registraci se nepodařilo dokončit.'];
    res.status(status).json({ error: code, message });
  }
});

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  try {
    const user = await authService.login(req.body?.username, req.body?.password);
    const session = await authService.createSession(user.id);
    playerProfileManager.markAsRegistered(user.username, user);
    setSessionCookie(res, session.token, 30 * 24 * 60 * 60);
    res.json({ user });
  } catch (err) {
    const known = {
      DATABASE_NOT_CONFIGURED: [503, 'AUTH_UNAVAILABLE', 'Databáze účtů není nakonfigurovaná.'],
      INVALID_CREDENTIALS: [401, 'INVALID_CREDENTIALS', 'Přezdívka nebo heslo není správně.']
    }[err.message];
    if (!known) console.error('[AUTH] Přihlášení selhalo:', err);
    const [status, code, message] = known || [500, 'AUTH_ERROR', 'Přihlášení se nepodařilo dokončit.'];
    res.status(status).json({ error: code, message });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    await authService.deleteSession(getSessionToken(req));
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (err) {
    console.error('[AUTH] Odhlášení selhalo:', err);
    res.status(500).json({ error: 'AUTH_ERROR' });
  }
});

app.delete('/api/auth/account', async (req, res) => {
  try {
    const username = await authService.deleteAccount(getSessionToken(req));
    if (!username) return res.status(401).json({ error: 'NOT_AUTHENTICATED', message: 'Pro smazání účtu se nejdřív přihlas.' });
    playerProfileManager.deleteProfile(username);
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (err) {
    console.error('[AUTH] Smazání účtu selhalo:', err);
    res.status(500).json({ error: 'AUTH_ERROR', message: 'Účet se nepodařilo smazat.' });
  }
});

// 7TV Emotes API pro herní chat
app.get('/api/emotes', (req, res) => {
  res.json(emoteService.getEmotes());
});

// Unlimited mód – servíruje stejnou webovou aplikaci
app.get('/unlimited', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Custom aréna – servíruje stejnou webovou aplikaci
app.get(['/custom/:code', '/room/:code'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Počty hráčů online pro lobby přehled
app.get('/api/arena-stats', (req, res) => {
  res.json(gameManager.getOnlineCounts());
});

// Včerejší výsledky pro Lobby po půlnoci
app.get('/api/yesterday-recap', (req, res) => {
  res.json(gameManager.getYesterdayRecap());
});

// Odeslání aktuálních počtů hráčů v aréně všem klientům (i v lobby)
function broadcastArenaCounts() {
  io.emit('arena_counts', gameManager.getOnlineCounts());
}

// Odeslání aktuálního stavu hry hráčům v dané místnosti
function broadcastGameState(mode) {
  const modes = mode ? [mode] : gameManager.getAllActiveModes();
  for (const m of modes) {
    const room = gameManager.getRoom(m);
    if (!room) continue;
    for (const socketId of Object.keys(room.players)) {
      const playerSocket = io.sockets.sockets.get(socketId);
      if (playerSocket) {
        const state = room.getGameStateForPlayer(socketId);
        playerSocket.emit('game_state', state);
      }
    }
  }
}

// Správa anket v aréně (!poll)
const activePollTimers = new Map(); // mode -> timerId

function broadcastPollUpdate(mode) {
  const room = gameManager.getRoom(mode);
  if (!room) return;
  for (const socketId of Object.keys(room.players)) {
    const playerSocket = io.sockets.sockets.get(socketId);
    if (playerSocket) {
      playerSocket.emit('poll_update', room.getPollPublicState(socketId));
    }
  }
}

function handleEndPoll(mode, byAdmin = false) {
  const room = gameManager.getRoom(mode);
  if (!room || !room.currentPoll || !room.currentPoll.active) return;

  if (activePollTimers.has(mode)) {
    clearTimeout(activePollTimers.get(mode));
    activePollTimers.delete(mode);
  }

  const result = room.endPoll();
  broadcastPollUpdate(mode);

  let endMsg = `📊 Anketa "${result.question}" skončila! `;
  if (result.winner) {
    endMsg += `Vítězí "${result.winner}" (${result.totalVotes} hlasů)!`;
  } else if (result.isTie) {
    endMsg += `Remíza (${result.totalVotes} hlasů)!`;
  } else {
    endMsg += `Nikdo nehlasoval.`;
  }

  const botMsg = room.addChatMessage('📊 ANKETA', endMsg, false, null, '#f59e0b');
  io.to(mode).emit('chat_message', botMsg);
  broadcastGameState(mode);
}

// Kontrola půlnoci každých 30 sekund (pro denní hru)
setInterval(() => {
  const roll = gameManager.checkMidnightRoll();
  if (roll.isNewDay) {
    io.to('daily').emit('notification', {
      message: `Odbila půlnoc! Začíná nové denní slovo pro ${roll.date}. Přejeme hodně štěstí!`
    });
    broadcastGameState('daily');
  }
}, 30 * 1000);

// Pomocné funkce pro YouTube přehrávač
function extractYouTubeId(urlOrText) {
  if (!urlOrText) return null;
  let str = urlOrText.trim();
  // Odstranění případných závorek kolem odkazu: [odkaz], <odkaz>, (odkaz)
  str = str.replace(/^[\[<(\s]+/, '').replace(/[\]>)\s]+$/, '');
  if (/^[a-zA-Z0-9_-]{11}$/.test(str)) {
    return str;
  }
  const match = str.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|shorts\/|watch\?v=|watch\?.+&v=))([\w-]{11})/i);
  return match ? match[1] : null;
}

async function checkYouTubeVideo(videoId) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (res.status === 401) {
      return { playable: false, reason: 'embedding_disabled', title: null };
    }
    if (res.status === 404) {
      return { playable: false, reason: 'not_found', title: null };
    }
    if (res.ok) {
      const data = await res.json();
      return { playable: true, title: data.title || `YouTube video (${videoId})` };
    }
  } catch (err) {
    // Timeout nebo síťová chyba
  }
  return { playable: true, title: `YouTube video (${videoId})` };
}

async function fetchYouTubeTitle(videoId) {
  const check = await checkYouTubeVideo(videoId);
  return check.title || `YouTube video (${videoId})`;
}

async function searchYouTube(query) {
  if (!query || !query.trim()) return null;
  const cleanQ = query.trim();

  // 1. Oficiální Google YouTube Data API v3 (pokud je v .env nastaven YOUTUBE_API_KEY)
  if (process.env.YOUTUBE_API_KEY) {
    try {
      const apiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=5&type=video&q=${encodeURIComponent(cleanQ)}&key=${encodeURIComponent(process.env.YOUTUBE_API_KEY)}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4500);
      const res = await fetch(apiUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        const items = data.items || [];
        for (const item of items) {
          const vid = item.id?.videoId;
          const title = item.snippet?.title;
          if (vid && vid !== 'dQw4w9WgXcQ') {
            const check = await checkYouTubeVideo(vid);
            if (check.playable) {
              return { videoId: vid, title: check.title || title };
            }
          }
        }
      }
    } catch (apiErr) {
      console.warn('[YouTube API] Chyba při volání oficiálního API:', apiErr.message);
    }
  }

  // 2. Fallback vyhledávání (webový dotaz)
  try {
    const url = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(cleanQ);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'cs-CZ,cs;q=0.9,en;q=0.8'
      }
    });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const html = await res.text();

    const jsonMatch = html.match(/var\s+ytInitialData\s*=\s*({.+?});<\/script>/s) ||
                      html.match(/ytInitialData\s*=\s*({.+?});<\/script>/s) ||
                      html.match(/ytInitialData\s*=\s*({.+?});/s);
    if (jsonMatch) {
      try {
        const data = JSON.parse(jsonMatch[1]);
        const sections = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
        const candidates = [];
        for (const sec of sections) {
          const items = sec.itemSectionRenderer?.contents || [];
          for (const item of items) {
            if (item.videoRenderer) {
              const vr = item.videoRenderer;
              const videoId = vr.videoId;
              const title = vr.title?.runs?.map(r => r.text).join('') || vr.title?.simpleText;
              if (videoId && title && videoId !== 'dQw4w9WgXcQ') {
                candidates.push({ videoId, title });
                if (candidates.length >= 5) break;
              }
            }
          }
          if (candidates.length >= 5) break;
        }

        // Zkontrolujeme kandidáty na povolení přehrávání přes iframe embed
        for (const cand of candidates) {
          const check = await checkYouTubeVideo(cand.videoId);
          if (check.playable) {
            return { videoId: cand.videoId, title: check.title || cand.title };
          }
        }
        if (candidates.length > 0) {
          return candidates[0];
        }
      } catch (e) {}
    }

    const videoMatches = html.matchAll(/\/watch\?v=([a-zA-Z0-9_-]{11})/g);
    const fallbackCandidates = [];
    for (const m of videoMatches) {
      const vid = m[1];
      if (vid && vid !== 'dQw4w9WgXcQ' && !fallbackCandidates.includes(vid)) {
        fallbackCandidates.push(vid);
        if (fallbackCandidates.length >= 4) break;
      }
    }
    for (const vid of fallbackCandidates) {
      const check = await checkYouTubeVideo(vid);
      if (check.playable) {
        return { videoId: vid, title: check.title || `YouTube video (${vid})` };
      }
    }
    if (fallbackCandidates.length > 0) {
      const vid = fallbackCandidates[0];
      const title = await fetchYouTubeTitle(vid);
      return { videoId: vid, title };
    }
  } catch (err) {
    console.warn('Chyba při vyhledávání na YouTube:', err.message);
  }
  return null;
}

function handlePlayTrackSuccess(room, mode, player, track, originalMsg) {
  const result = room.enqueueMusicTrack(track);

  if (originalMsg) {
    const chatEntry = room.addChatMessage(player.name, originalMsg, player.isAdmin);
    io.to(mode).emit('chat_message', chatEntry);
  }

  if (result.playingNow) {
    io.to(mode).emit('music_play', {
      ...result.track,
      skipVotes: 0,
      requiredSkipVotes: room.getRequiredSkipVotes(),
      hasVotedSkip: false,
      serverTime: Date.now(),
      queue: room.musicQueue.map((t, idx) => ({
        position: idx + 1,
        videoId: t.videoId,
        title: t.title,
        requestedBy: t.requestedBy
      })),
      queueLength: room.musicQueue.length
    });
    io.to(mode).emit('notification', {
      message: `🎵 ${player.name} pustil(a) hudbu: ${track.title}`
    });
  } else {
    io.to(mode).emit('music_queue_update', {
      queue: room.musicQueue.map((t, idx) => ({
        position: idx + 1,
        videoId: t.videoId,
        title: t.title,
        requestedBy: t.requestedBy
      })),
      queueLength: room.musicQueue.length
    });
    io.to(mode).emit('notification', {
      message: `📋 ${player.name} přidal(a) do fronty (#${result.position}): ${track.title}`
    });
  }
  broadcastGameState(mode);
}

function handleSongConfirmation(socket, room, mode, player, pendingConf, isYes) {
  delete room.pendingSongConfirmations[socket.id];

  if (isYes) {
    const track = {
      videoId: pendingConf.videoId,
      title: pendingConf.title,
      requestedBy: player.name
    };
    handlePlayTrackSuccess(room, mode, player, track);
  } else {
    const cancelMsg = room.addChatMessage('🤖 DJ', `@${player.name} Výběr skladby "${pendingConf.title}" zrušen.`);
    io.to(mode).emit('chat_message', cancelMsg);
  }
}

// Globální chat napříč všemi místnostmi
const globalChatHistory = [];
const MAX_GLOBAL_CHAT_HISTORY = 100;

// ── OCHRANA SERVERU A RATE LIMITING (Proti DoS / spamu / brute-force) ──
const socketRateLimits = new Map(); // key -> { lastGuess, lastChat, lastGlobalChat, customRoomsCount, customRoomsReset }

function getRateLimitKey(socketOrId) {
  if (socketOrId && typeof socketOrId === 'object') {
    const headerIp = socketOrId.handshake?.headers?.['x-forwarded-for'];
    const clientIp = headerIp ? headerIp.split(',')[0].trim() : (socketOrId.handshake?.address || socketOrId.id);
    return `ip_${clientIp}`;
  }
  const sock = io.sockets.sockets.get(socketOrId);
  if (sock) {
    const headerIp = sock.handshake?.headers?.['x-forwarded-for'];
    const clientIp = headerIp ? headerIp.split(',')[0].trim() : (sock.handshake?.address || socketOrId);
    return `ip_${clientIp}`;
  }
  return `sock_${socketOrId}`;
}

const rateLimitCleanupTimer = setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [key, entry] of socketRateLimits.entries()) {
    if ((entry.lastChat || 0) < cutoff && (entry.lastGuess || 0) < cutoff && (entry.lastGlobalChat || 0) < cutoff && (!entry.customRoomsReset || entry.customRoomsReset < cutoff)) {
      socketRateLimits.delete(key);
    }
  }
}, 10 * 60 * 1000);
if (rateLimitCleanupTimer.unref) rateLimitCleanupTimer.unref();

function checkSocketRate(socketOrId, action, minIntervalMs) {
  const key = getRateLimitKey(socketOrId);
  const now = Date.now();
  let data = socketRateLimits.get(key);
  if (!data) {
    data = {};
    socketRateLimits.set(key, data);
  }
  const lastTime = data[action] || 0;
  if (now - lastTime < minIntervalMs) {
    return false;
  }
  data[action] = now;
  return true;
}

function checkCustomRoomRate(socketOrId) {
  const key = getRateLimitKey(socketOrId);
  const now = Date.now();
  let data = socketRateLimits.get(key);
  if (!data) {
    data = {};
    socketRateLimits.set(key, data);
  }
  if (!data.customRoomsReset || now > data.customRoomsReset) {
    data.customRoomsCount = 0;
    data.customRoomsReset = now + 60 * 60 * 1000; // 1 hodina
  }
  if (data.customRoomsCount >= 5) {
    return false;
  }
  data.customRoomsCount = (data.customRoomsCount || 0) + 1;
  return true;
}

io.on('connection', (socket) => {
  // Odeslání aktuálních počtů hráčů nově připojenému klientovi
  socket.emit('arena_counts', gameManager.getOnlineCounts());
  // Odeslání historie globálního chatu
  socket.emit('global_chat_history', globalChatHistory);

  // Vyžádání aktuálního seznamu online hráčů
  socket.on('get_online_players', () => {
    socket.emit('arena_counts', gameManager.getOnlineCounts());
  });

  // Vytvoření nové vlastní místnosti (Custom Room)
  socket.on('create_custom_room', ({ wordSource }) => {
    if (!checkCustomRoomRate(socket.id)) {
      socket.emit('error_message', {
        message: 'Překročen limit pro zakládání vlastních arén (max 5 za hodinu).'
      });
      return;
    }
    const room = gameManager.createCustomRoom(wordSource || 'daily');
    socket.emit('custom_room_created', {
      roomCode: room.roomCode,
      mode: room.mode,
      wordSource: room.wordSource
    });
  });

  // Přepnutí zdroje slov ve vlastní aréně (Denní / Archivní)
  socket.on('switch_custom_word_source', ({ wordSource }) => {
    const room = gameManager.getRoomForSocket(socket.id);
    const mode = gameManager.getModeForSocket(socket.id);
    if (!room || !mode || !mode.startsWith('custom_')) return;
    if (typeof room.setWordSource === 'function') {
      const changed = room.setWordSource(wordSource);
      if (changed) {
        const sourceLabel = wordSource === 'daily' ? 'Dnešní denní slovo' : 'Náhodné archivní slovo';
        const msg = room.addChatMessage('⚙️ ARÉNA', `Režim slov byl přepnut na: ${sourceLabel}`, false, null, '#10b981');
        io.to(mode).emit('chat_message', msg);
        broadcastGameState(mode);
      }
    }
  });

  // Odeslání zprávy do globálního chatu (pro všechny připojené hráče)
  socket.on('send_global_chat', ({ message }) => {
    if (!checkSocketRate(socket.id, 'lastGlobalChat', 1200)) {
      socket.emit('error_message', { message: 'Globální zprávy lze posílat jednou za 1,2 sekundy.' });
      return;
    }
    const cleanMsg = (message || '').trim();
    if (!cleanMsg || cleanMsg.length > 300) return;

    const room = gameManager.getRoomForSocket(socket.id);
    const player = room?.players?.[socket.id];
    const senderName = player ? player.name : (socket.data?.playerName || 'Hráč');
    const senderColor = player ? player.color : '#38bdf8';
    const isAdmin = !!player?.isAdmin;

    const globalEntry = {
      id: 'g_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      sender: senderName,
      message: cleanMsg,
      color: senderColor,
      isAdmin,
      isBot: false,
      timestamp: new Date().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })
    };

    globalChatHistory.push(globalEntry);
    if (globalChatHistory.length > MAX_GLOBAL_CHAT_HISTORY) {
      globalChatHistory.shift();
    }

    playerProfileManager.touchActivity(senderName);
    io.emit('global_chat_message', globalEntry);
  });

  // Dotaz na existující profil (barva a statistiky) při zadání jména v lobby
  socket.on('check_guest_profile', async ({ playerName }, callback) => {
    if (typeof callback !== 'function') return;
    if (!playerName || typeof playerName !== 'string') {
      return callback({ exists: false, isRegistered: false });
    }
    const clean = playerName.replace(/(\s*\(\d+\))+$/, '').trim();
    if (!clean) return callback({ exists: false, isRegistered: false });

    try {
      const isRegistered = await authService.isUsernameTaken(clean);
      const prof = playerProfileManager.getProfile(clean);
      if (prof) {
        return callback({
          exists: true,
          isRegistered,
          name: prof.name,
          color: prof.color,
          emote: prof.emote || null,
          stats: prof.stats
        });
      }
      return callback({ exists: false, isRegistered });
    } catch (err) {
      return callback({ exists: false, isRegistered: false });
    }
  });

  // Aktualizace barvy hráče
  socket.on('update_player_color', ({ color }) => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (room && room.players && room.players[socket.id]) {
      const player = room.players[socket.id];
      player.color = color;
      playerProfileManager.updateColor(player.name, color);
      const mode = gameManager.getModeForSocket(socket.id);
      if (mode) broadcastGameState(mode);
    }
  });

  // Aktualizace 7TV ikony / emotu hráče
  socket.on('update_player_emote', ({ emote }) => {
    const room = gameManager.getRoomForSocket(socket.id);
    if (room && room.players && room.players[socket.id]) {
      const player = room.players[socket.id];
      player.emote = emote || null;
      playerProfileManager.updateEmote(player.name, emote);
      const mode = gameManager.getModeForSocket(socket.id);
      if (mode) broadcastGameState(mode);
    }
  });

  // 1. Vstup do hry (denní, unlimited, nebo vlastní aréna)
  socket.on('join_game', async ({ playerName, mode, color, emote, customCode, wordSource, speedrunConfig, sessionId, clientStats }) => {
    const cleanRequestedName = String(playerName || '').replace(/(\s*\(\d+\))+$/, '').trim();
    const accountUser = socket.data?.authUser;
    if (accountUser) {
      authService.touchActivity(accountUser.id);
      playerProfileManager.markAsRegistered(accountUser.username, accountUser);
    }
    if (accountUser && cleanRequestedName.toLocaleLowerCase('cs-CZ') !== accountUser.username.toLocaleLowerCase('cs-CZ')) {
      socket.emit('error_message', { message: `Tento účet musí hrát pod přezdívkou „${accountUser.username}“.` });
      return;
    }
    if (!accountUser && await authService.isUsernameTaken(cleanRequestedName)) {
      socket.emit('error_message', { message: 'Tato přezdívka je registrovaná. Přihlas se ke svému účtu, nebo zvol jinou.' });
      return;
    }

    // Určení administrátorských práv – pouze pro ověřené uživatele v ADMIN_USERNAMES
    let isExplicitAdmin = false;
    if (accountUser && process.env.ADMIN_USERNAMES) {
      const adminList = process.env.ADMIN_USERNAMES
        .split(',')
        .map((u) => u.trim().toLowerCase())
        .filter(Boolean);
      if (adminList.includes(accountUser.username.toLowerCase())) {
        isExplicitAdmin = true;
      }
    }

    let gameMode = 'daily';
    if (mode === 'unlimited') {
      gameMode = 'unlimited';
    } else if (mode === 'custom' || (mode && mode.startsWith('custom_')) || customCode) {
      const rawCode = (customCode || (mode && mode.startsWith('custom_') ? mode.replace('custom_', '') : '')).toUpperCase().trim();
      let customRoom = rawCode ? gameManager.getCustomRoom(rawCode) : null;
      if (!customRoom && rawCode) {
        customRoom = gameManager.createCustomRoom(wordSource || 'daily', rawCode, playerName, speedrunConfig);
      } else if (!customRoom) {
        customRoom = gameManager.createCustomRoom(wordSource || 'daily', null, playerName, speedrunConfig);
      }
      gameMode = customRoom.mode;
    }

    // Případná migrace statistik z klienta do profilu na serveru
    if (clientStats && playerName) {
      playerProfileManager.getOrCreateProfile(playerName, color, clientStats, emote);
    }

    // Opuštění předchozích místností
    for (const r of socket.rooms) {
      if (r !== socket.id) socket.leave(r);
    }
    socket.join(gameMode);

    const clientIp = socket.handshake.headers['x-forwarded-for']
      ? socket.handshake.headers['x-forwarded-for'].split(',')[0].trim()
      : socket.handshake.address;

    const effectiveName = accountUser ? accountUser.username : cleanRequestedName;
    const { player, isReconnect, oldSocketId } = gameManager.joinPlayer(
      socket.id,
      effectiveName,
      gameMode,
      color,
      customCode,
      wordSource,
      sessionId,
      clientIp,
      speedrunConfig,
      emote,
      isExplicitAdmin
    );
    socket.data = socket.data || {};
    socket.data.playerName = player.name;

    // Pokud starý socket ještě existuje, bezpečně ho odpojíme
    if (isReconnect && oldSocketId) {
      const oldSock = io.sockets.sockets.get(oldSocketId);
      if (oldSock) {
        try {
          oldSock.disconnect(true);
        } catch (e) {}
      }
    }

    // Oznámení pro ostatní v téže místnosti (pouze při novém příchodu, ne při tichém reconnectu)
    if (!isReconnect) {
      socket.to(gameMode).emit('notification', {
        message: `${player.name} se připojil(a) do hry!`
      });
    }

    // Odeslání stavu všem v dané místnosti
    broadcastGameState(gameMode);

    // Aktualizace počtů hráčů pro všechny klienty (včetně těch v lobby)
    broadcastArenaCounts();
  });

  function executePlayerGuess(socket, room, mode, word, fromChat = false) {
    if (!room || !socket) return null;
    const result = room.submitGuess(socket.id, word);

    if (result.error) {
      if (!fromChat) {
        socket.emit('error_message', { message: result.error });
      }
      return result;
    }

    if (result.isWinner) {
      socket.to(mode).emit('notification', {
        message: `${result.player.name} právě uhodl(a) tajné slovo (#1) na ${result.player.guessCount}. pokus!`
      });
      socket.emit('notification', {
        message: fromChat
          ? `🎉 Výborně! Spletl(a) sis chat s herním polem? Tajné slovo "${result.guess.word}" bylo započteno a vyhrál(a) jsi na ${result.player.guessCount}. pokus!`
          : `Výborně! Uhodl(a) jsi tajné slovo: "${result.guess.word}" na ${result.player.guessCount}. pokus!`
      });

      // Stručné oznámení bota v chatu (místo zaplnění celého okna)
      const solveText = mode === 'unlimited'
        ? `🎉 ${result.player.name} uhodl(a) archivní slovo na ${result.player.guessCount}. pokus!`
        : `🎉 ${result.player.name} právě uhodl(a) dnešní tajné slovo na ${result.player.guessCount}. pokus!`;
      const botMsg = room.addChatMessage('🤖 BOT', solveText, false, null, '#15803D');
      io.to(mode).emit('chat_message', botMsg);
    } else {
      if (fromChat) {
        socket.emit('notification', {
          message: `💡 Slovo "${result.guess.word}" z chatu bylo započteno jako tvůj herní tip (#${result.guess.rank}). Do chatu nebylo odesláno, aby nenapovídalo ostatním.`
        });
      }
      // Bleskový zásah (Telegraph do chatu při TOP 10 – bez prozrazení slova)
      if (result.guess && result.guess.rank >= 2 && result.guess.rank <= 10) {
        const telegraphText = `⚡ [TELEGRAPH] ${result.player.name} právě zasáhl(a) #${result.guess.rank} (TOP 10)!`;
        const telegraphMsg = room.addChatMessage('⚡ TELEGRAPH', telegraphText, false, null, '#D97706');
        io.to(mode).emit('chat_message', telegraphMsg);
      }
    }

    if (result.isMine) {
      socket.emit('speedrun_mine_hit', { penaltySeconds: 10, word: result.guess.word });
      socket.to(mode).emit('notification', {
        message: `💣 ${result.player.name} šlápl(a) na minu se slovem "${result.guess.word}"! (-10s)`
      });
    }

    if (result.triggeredSuddenDeath) {
      io.to(mode).emit('speedrun_sudden_death', {
        winner: result.player.name,
        remainingSeconds: 30
      });
      io.to(mode).emit('notification', {
        message: `⚡ SUDDEN DEATH! ${result.player.name} uhodl(a) slovo! Ostatní mají 30 sekund na dohnání!`
      });
    }

    broadcastGameState(mode);
    return result;
  }

  // 2. Odeslání tipu
  socket.on('submit_guess', ({ word }) => {
    if (!checkSocketRate(socket.id, 'lastGuess', 400)) {
      socket.emit('error_message', { message: 'Tipuješ příliš rychle. Zpomal prosím.' });
      return;
    }
    const room = gameManager.getRoomForSocket(socket.id);
    const mode = gameManager.getModeForSocket(socket.id);
    executePlayerGuess(socket, room, mode, word, false);
  });

  // 3. Vzdát se a odhalit tajné slovo
  socket.on('reveal_word', () => {
    const room = gameManager.getRoomForSocket(socket.id);
    const mode = gameManager.getModeForSocket(socket.id);
    const result = room.revealWord(socket.id);

    if (result.error) {
      socket.emit('error_message', { message: result.error });
      return;
    }

    socket.emit('notification', {
      message: `Tajné slovo bylo: "${result.targetWord}". Nyní jsi v režimu diváka.`
    });

    socket.to(mode).emit('notification', {
      message: `${result.player.name} se vzdal(a) a odhalil(a) slovo.`
    });

    broadcastGameState(mode);
  });

  // 4. Odhalení nápovědy (získání 🤡)
  socket.on('use_hint', (data) => {
    const requestedLevel = data && data.level ? parseInt(data.level, 10) : null;
    const room = gameManager.getRoomForSocket(socket.id);
    const mode = gameManager.getModeForSocket(socket.id);
    if (!room) return;

    const hadHintBefore = Boolean(room.players?.[socket.id]?.usedHint);
    const result = room.useHint(socket.id, requestedLevel);

    if (result.error) {
      socket.emit('error_message', { message: result.error });
      return;
    }

    const lvl = result.hintLevel || 1;
    if (!hadHintBefore) {
      socket.to(mode).emit('notification', {
        message: `🤡 ${result.player.name} si zobrazil(a) ${lvl}. nápovědu a získal(a) klauna!`
      });
      socket.emit('notification', {
        message: `${lvl}. nápověda odhalena! Získal(a) jsi 🤡 vedle svého jména.`
      });
    } else {
      socket.emit('notification', {
        message: `${lvl}. nápověda odhalena!`
      });
    }

    broadcastGameState(mode);
  });

  // 5. Hlasování o nové slovo (v Unlimited nebo Vlastní aréně s archivními slovy)
  socket.on('vote_new_word', () => {
    const mode = gameManager.getModeForSocket(socket.id);
    const room = gameManager.getRoomForSocket(socket.id);
    if (!room) return;

    if (mode !== 'unlimited' && (!mode.startsWith('custom_') || room.wordSource === 'daily')) {
      socket.emit('error_message', { message: 'Hlasování o nové slovo je dostupné pouze v Unlimited módu nebo ve Vlastní aréně s archivními slovy.' });
      return;
    }

    const result = room.voteNewWord(socket.id);

    if (result.error) {
      socket.emit('error_message', { message: result.error });
      return;
    }

    if (result.newWordTriggered) {
      io.to(mode).emit('notification', {
        message: `🗳️ Hlasování úspěšné! Předchozí slovo bylo: "${result.oldWord}". Vylosováno nové archivní slovo!`
      });
    } else {
      const actionText = result.hasVoted ? 'hlasoval(a) pro nové slovo' : 'zrušil(a) svůj hlas pro nové slovo';
      io.to(mode).emit('notification', {
        message: `🗳️ ${result.player.name} ${actionText} (${result.votesCount}/${result.requiredVotes}).`
      });
    }

    broadcastGameState(mode);
  });

  // 6. Odstartování Rychlovky zakladatelem
  socket.on('start_speedrun', () => {
    const mode = gameManager.getModeForSocket(socket.id);
    const room = gameManager.getRoomForSocket(socket.id);
    if (!room || room.wordSource !== 'speedrun') {
      socket.emit('error_message', { message: 'Tato akce je dostupná pouze v režimu Rychlovka.' });
      return;
    }
    const player = room.players[socket.id];
    if (!player || (player.name !== room.hostName && !player.isAdmin)) {
      socket.emit('error_message', { message: 'Odstartovat hru může pouze zakladatel arény.' });
      return;
    }

    const res = room.startSpeedrunCountdown(io, () => {
      broadcastGameState(mode);
    });

    if (res.error) {
      socket.emit('error_message', { message: res.error });
      return;
    }

    broadcastGameState(mode);
  });

  // 7. Další kolo v Rychlovce zakladatelem
  socket.on('speedrun_next_round', () => {
    const mode = gameManager.getModeForSocket(socket.id);
    const room = gameManager.getRoomForSocket(socket.id);
    if (!room || room.wordSource !== 'speedrun') {
      socket.emit('error_message', { message: 'Tato akce je dostupná pouze v režimu Rychlovka.' });
      return;
    }
    const player = room.players[socket.id];
    if (!player || (player.name !== room.hostName && !player.isAdmin)) {
      socket.emit('error_message', { message: 'Nové kolo může spustit pouze zakladatel arény.' });
      return;
    }

    room.resetWithNewWord();
    io.to(mode).emit('notification', {
      message: '⚡ Zakladatel připravil nové kolo Rychlovky! Vyčkej na odstartování.'
    });
    broadcastGameState(mode);
  });

  // ── Hlášení nevhodného obsahu (EU Digital Services Act – DSA) ──
  socket.on('report_content', ({ reportedUser, messageText, reason }) => {
    try {
      const room = gameManager.getRoomForSocket(socket.id);
      const mode = gameManager.getModeForSocket(socket.id) || 'lobby';
      const player = room?.players?.[socket.id];
      const reporterName = player?.name || socket.data?.playerName || 'Anonymní hráč';

      const cleanReason = (reason || 'Nevhodný obsah').toString().slice(0, 300);
      const cleanTarget = (reportedUser || 'Neznámý').toString().slice(0, 50);
      const cleanSnippet = (messageText || '').toString().slice(0, 500);

      const reportEntry = {
        id: 'rep_' + Date.now(),
        date: new Date().toISOString(),
        mode,
        reporter: reporterName,
        target: cleanTarget,
        reason: cleanReason,
        text: cleanSnippet
      };

      console.warn(`[DSA REPORT] Hráč "${reporterName}" nahlásil "${cleanTarget}": "${cleanReason}"`);

      // Zápis do logu hlášení v src/data (asynchronně bez blokování event loopu)
      const dataDir = path.join(__dirname, 'src', 'data');
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      fs.promises.appendFile(path.join(dataDir, 'reports.log'), JSON.stringify(reportEntry) + '\n', 'utf-8').catch((err) => {
        console.error('[DSA REPORT] Chyba při zápisu hlášení:', err.message);
      });

      // Oznámení pro administrátora v aréně
      if (room && room.players) {
        for (const [sId, p] of Object.entries(room.players)) {
          if (p.isAdmin) {
            const adminSocket = io.sockets.sockets.get(sId);
            if (adminSocket) {
              adminSocket.emit('notification', {
                message: `⚠️ [DSA HLÁŠENÍ]: ${reporterName} nahlásil hráče ${cleanTarget} (${cleanReason})`
              });
            }
          }
        }
      }

      socket.emit('notification', {
        message: '🛡️ Děkujeme za hlášení. Provozovatel podnět prověří v souladu s DSA.'
      });
    } catch (e) {
      console.error('Chyba při zpracování hlášení DSA:', e.message);
    }
  });

  // Běžná konverzační slova, která nikdy neblokujeme pro blízká slova (rank >= 2)
  const CHAT_COMMON_STOP_WORDS = new Set([
    'a', 'i', 'v', 's', 'z', 'u', 'o', 'k', 'se', 'si', 'je', 'to', 'ta', 'ten',
    'ti', 'ty', 'toho', 'tomu', 'tom', 'tech', 'těch', 'co', 'jak', 'tak', 'uz', 'už',
    'ne', 'ano', 'jo', 'ale', 'nebo', 'kdyz', 'když', 'jen', 'proc', 'proč',
    'tam', 'tady', 'dnes', 'dneska', 'hra', 'hry', 'den', 'cas', 'čas', 'moc',
    'mam', 'mám', 'mas', 'máš', 'ma', 'má', 'mame', 'máme', 'mate', 'máte', 'maji', 'mají',
    'jsem', 'jsi', 'jsme', 'jste', 'jsou', 'byl', 'byla', 'bylo', 'byli',
    'bude', 'budu', 'budes', 'budeš', 'budeme', 'budete', 'budou',
    'chci', 'chces', 'chceš', 'chce', 'chceme', 'chcete', 'chteji', 'chtějí',
    'nevim', 'nevím', 'vis', 'víš', 'vi', 'ví', 'vime', 'víme', 'vic', 'víc', 'min', 'míň',
    'dobre', 'dobře', 'spatne', 'špatně', 'super', 'hele', 'ahoj', 'cau', 'čau', 'dik', 'dík', 'diky', 'díky',
    'kdo', 'proc', 'proč', 'kde', 'kam', 'odkud', 'proto', 'protoze', 'protože',
    'malo', 'málo', 'docela', 'fakt', 'asi', 'mozna', 'možná', 'urcite', 'určitě',
    'ani', 'bud', 'buď', 'zatim', 'zatím', 'porad', 'pořád', 'stale', 'stále',
    'vsechno', 'všechno', 'nic', 'vse', 'vše', 'kazdy', 'každý', 'nekdo', 'někdo',
    'clovek', 'člověk', 'lidi', 'lide', 'lidé', 'slovo', 'slova', 'tip', 'tipy'
  ]);

  function escapeRegexForChat(s) {
    return s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  }

  /**
   * Kontrola spoilerů v chatu – pouze pro aktivní tajné slovo daného dne / místnosti!
   * Nikdy neblokuje dopředu ani neomezuje běžnou konverzaci.
   */
  function checkChatSpoiler(targetWordObj, message, isSolvedOrGaveUp) {
    if (!targetWordObj || !targetWordObj.dayData || !message) return null;

    const targetWord = (targetWordObj.word || '').trim().toLowerCase();
    if (!targetWord) return null;
    const targetNorm = wordService.removeDiacritics(targetWord);

    // 1. Zkouška roztaženého nebo odděleného tajného slova (např. "p r o h l a s e n i", "p.r.o.h.l.a.s.e.n.i")
    if (targetNorm.length >= 3) {
      const lettersPattern = targetNorm.split('').map(escapeRegexForChat).join('[\\s\\.\\-_*~`\'",]{1,3}');
      const regex = new RegExp('(?:^|[^a-záčďéěíňóřšťúůýž])' + lettersPattern + '(?:$|[^a-záčďéěíňóřšťúůýž])', 'i');
      const msgNorm = wordService.removeDiacritics(message);
      if (regex.test(msgNorm)) {
        return { isTarget: true, word: targetWord };
      }
    }

    // 2. Kontrola jednotlivých slov / tokenů
    const words = message.match(/[a-záčďéěíňóřšťúůýž]+/gi) || [];
    const { exactMap, normalizedMap } = targetWordObj.dayData;
    const collapse = (s) => s.replace(/(.)\1+/g, '$1');
    const targetCollapsed = collapse(targetNorm);

    for (const rawWord of words) {
      const w = rawWord.toLowerCase();
      const wNorm = wordService.removeDiacritics(w);

      // Přímá shoda s tajným slovem nebo protaženým slovem (např. "prohlaaaaseni")
      if (wNorm === targetNorm || (targetNorm.length >= 3 && collapse(wNorm) === targetCollapsed)) {
        return { isTarget: true, word: rawWord };
      }

      // Běžná konverzační stop-slova nikdy neblokujeme pro blízká slova
      if (CHAT_COMMON_STOP_WORDS.has(wNorm)) continue;

      let rank = exactMap.get(w);
      if (rank === undefined && normalizedMap.has(wNorm)) {
        rank = normalizedMap.get(wNorm).rank;
      }

      if (rank && rank > 1) {
        // Slova v TOP 10 (bezprostřední synonyma a bezprostřední blízkost)
        if (rank <= 10) {
          return { isTarget: false, rank, word: rawWord };
        }
        // Krátké zprávy (1-3 slova) s nápovědou v TOP 20 (např. "zkus oznámení")
        if (words.length <= 3 && rank <= 20) {
          return { isTarget: false, rank, word: rawWord };
        }
        // Hráč, který se vzdal nebo vyhrál a radí v TOP 20
        if (isSolvedOrGaveUp && rank <= 20) {
          return { isTarget: false, rank, word: rawWord };
        }
      }
    }

    return null;
  }

  // 6. Zpráva do chatu a příkazy (!play, !stop)
  socket.on('send_chat', async ({ message }) => {
    if (!checkSocketRate(socket.id, 'lastChat', 800)) {
      socket.emit('error_message', { message: 'Zprávy lze do chatu posílat jednou za sekundu.' });
      return;
    }
    const cleanMsg = (message || '').trim();
    if (!cleanMsg) return;

    const room = gameManager.getRoomForSocket(socket.id);
    const mode = gameManager.getModeForSocket(socket.id);
    const player = room?.players?.[socket.id];
    if (!player) return;

    // Kontrola, zda hráč odpovídá na čekající potvrzení skladby (ano / ne)
    const pendingConf = room.pendingSongConfirmations ? room.pendingSongConfirmations[socket.id] : null;
    if (pendingConf && Date.now() < pendingConf.expiresAt) {
      const lower = cleanMsg.toLowerCase().trim();
      const isYes = ['ano', 'jo', 'yes', 'y', 'jj', '!ano', '!yes', '1'].includes(lower);
      const isNo = ['ne', 'no', 'n', 'nn', '!ne', '!no', 'zrusit', 'cancel', '0'].includes(lower);

      if (isYes || isNo) {
        const userMsg = room.addChatMessage(player.name, cleanMsg, player.isAdmin);
        io.to(mode).emit('chat_message', userMsg);
        handleSongConfirmation(socket, room, mode, player, pendingConf, isYes);
        return;
      }
    }

    // Ochrana proti spoilerům v chatu – pouze pro aktivní slovo daného dne / místnosti
    if (!player.isAdmin && room && room.targetWordObj) {
      const isSolvedOrGaveUp = Boolean(player.solved || player.gaveUp);
      const spoiler = checkChatSpoiler(room.targetWordObj, cleanMsg, isSolvedOrGaveUp);
      if (spoiler) {
        if (isSolvedOrGaveUp) {
          // Hráč už zná řešení -> zákaz vyzrazování v chatu
          socket.emit('error_message', {
            message: spoiler.isTarget
              ? '🚫 Již znáš tajné slovo – neprozrazuj ho ostatním v chatu!'
              : '🚫 Již znáš řešení – nenapovídej ostatním v chatu blízká slova!'
          });
          return;
        }

        // Hráč je aktivní hádající:
        // Zjistíme, zda už toto slovo má ve svých předchozích tipech
        const targetClean = room.targetWordObj.word;
        const guessWord = spoiler.isTarget ? targetClean : spoiler.word;
        const normSpoilerWord = wordService.removeDiacritics(guessWord.toLowerCase());

        const alreadyGuessed = Array.isArray(room.guesses) && room.guesses.some((g) =>
          (g.socketId === socket.id || (g.player && player.name && g.player.toLowerCase() === player.name.toLowerCase())) &&
          wordService.removeDiacritics((g.word || '').toLowerCase()) === normSpoilerWord
        );

        if (alreadyGuessed) {
          // Hráč už slovo dříve sám trefil na své herní ploše -> teď ho píše do chatu, aby radil
          socket.emit('error_message', {
            message: `🚫 Slovo "${guessWord}" již máš ve svých tipech – nenapovídej ostatním v chatu!`
          });
          return;
        }

        // Hráč slovo ještě netipnul:
        // AUTOMATICKÉ PŘESMĚROVÁNÍ (AUTO-GUESS):
        // Započte se jako oficiální herní tip (přičte se pokus, odhalí se pořadí nebo rovnou výhra),
        // zpráva se do chatu nepošle, takže ostatní hráči nedostanou spoiler ani nápovědu!
        executePlayerGuess(socket, room, mode, guessWord, true);
        return;
      }
    }

    // Příkaz pro aktivaci administrátorských práv v chatu: !admin <heslo>
    if (cleanMsg.toLowerCase().startsWith('!admin ') || cleanMsg.toLowerCase() === '!admin') {
      const enteredSecret = cleanMsg.slice(6).trim();
      const actualSecret = (process.env.ADMIN_SECRET || '').trim();

      if (!actualSecret || actualSecret === '/admin-perms-456' || actualSecret === 'zmente_toto_tajne_heslo_pred_spustenim_12345') {
        socket.emit('error_message', {
          message: '[ADMIN] Administrátorský přístup přes heslo není bezpečně nakonfigurován (nastavte silné ADMIN_SECRET v .env).'
        });
        return;
      }

      let matches = false;
      try {
        const enteredBuf = Buffer.from(enteredSecret, 'utf-8');
        const actualBuf = Buffer.from(actualSecret, 'utf-8');
        if (enteredBuf.length === actualBuf.length && enteredBuf.length > 0) {
          matches = crypto.timingSafeEqual(enteredBuf, actualBuf);
        }
      } catch (e) {
        matches = false;
      }

      if (matches) {
        player.isAdmin = true;
        socket.emit('notification', {
          message: '[ADMIN] Úspěšně jsi aktivoval administrátorská práva pro tuto relaci.'
        });
        const helpMsg = room.addChatMessage(
          '[SYSTÉM]',
          `@${player.name} Jsi nyní administrátorem arény. Příkazy: !poll, !endpoll, !kick <hráč>, !clear, !announce <text>, !forceskip, !forcestop, !forceword, !reveal`,
          true
        );
        socket.emit('chat_message', helpMsg);
        broadcastGameState(mode);
        return;
      } else {
        socket.emit('error_message', {
          message: '[CHYBA] Nesprávné administrátorské heslo.'
        });
        return;
      }
    }

    // Příkaz pro přehrávání hudby: !play [youtube odkaz / název skladby]
    if (cleanMsg.toLowerCase().startsWith('!play')) {
      if (!mode.startsWith('custom_')) {
        socket.emit('error_message', {
          message: 'Hudební jukebox (!play) je povolen pouze ve Vlastní aréně (Custom Room)!'
        });
        return;
      }

      const queryPart = cleanMsg.slice(5).trim();
      if (!queryPart) {
        socket.emit('error_message', {
          message: 'Zadej název skladby nebo YouTube odkaz. Např.: !play kabat pohoda nebo !play https://www.youtube.com/watch?v=...'
        });
        return;
      }

      // 1. Zkontrolujeme, zda jde o přímý YouTube odkaz nebo ID -> rovnou pustit bez potvrzení
      const directVideoId = extractYouTubeId(queryPart);
      if (directVideoId) {
        const check = await checkYouTubeVideo(directVideoId);
        if (!check.playable) {
          if (check.reason === 'embedding_disabled') {
            socket.emit('error_message', {
              message: 'Tuto skladbu nelze přehrát – autor videa zakázal vkládání na externí weby (autorská práva). Zkus jinou verzi nebo skladbu.'
            });
          } else {
            socket.emit('error_message', {
              message: 'Zadané YouTube video nebylo nalezeno nebo je soukromé.'
            });
          }
          return;
        }

        const track = {
          videoId: directVideoId,
          title: check.title,
          requestedBy: player.name
        };
        handlePlayTrackSuccess(room, mode, player, track, cleanMsg);
        return;
      }

      // 2. Vyhledání podle názvu skladby -> vyžaduje potvrzení: "myslis tuhle sus ? " ano/ne
      const userMsg = room.addChatMessage(player.name, cleanMsg, player.isAdmin);
      io.to(mode).emit('chat_message', userMsg);

      const searchResult = await searchYouTube(queryPart);
      if (!searchResult || !searchResult.videoId) {
        const notFoundMsg = room.addChatMessage(
          '🤖 DJ',
          `@${player.name} Nenašel jsem na YouTube žádnou skladbu pro "${queryPart}". Zkus jiný název nebo zadej přímo odkaz.`
        );
        io.to(mode).emit('chat_message', notFoundMsg);
        return;
      }

      let title = searchResult.title;
      if (!title) {
        title = await fetchYouTubeTitle(searchResult.videoId);
      }

      const confirmId = 'conf-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
      if (!room.pendingSongConfirmations) room.pendingSongConfirmations = {};
      room.pendingSongConfirmations[socket.id] = {
        confirmId,
        videoId: searchResult.videoId,
        title,
        requestedBy: player.name,
        expiresAt: Date.now() + 60000
      };

      const confirmText = `@${player.name} myslis tuhle sus ? "${title}"`;
      const botMsg = room.addChatMessage('🤖 DJ', confirmText, false, {
        confirmId,
        targetPlayer: player.name,
        videoId: searchResult.videoId,
        title
      });
      io.to(mode).emit('chat_message', botMsg);
      return;
    }

    // Příkaz pro zobrazení fronty skladeb: !queue, !fronta
    if (['!queue', '!fronta'].includes(cleanMsg.toLowerCase())) {
      if (!mode.startsWith('custom_')) {
        socket.emit('error_message', {
          message: 'Hudební fronta je dostupná pouze ve Vlastní aréně!'
        });
        return;
      }

      if (!room.currentMusic) {
        const qMsg = room.addChatMessage('📋 FRONTA', 'Právě nehraje žádná hudba a fronta je prázdná.');
        socket.emit('chat_message', qMsg);
        return;
      }

      let qText = `Právě hraje: "${room.currentMusic.title}" (od ${room.currentMusic.requestedBy || 'neznámý'})\n`;
      if (room.musicQueue.length === 0) {
        qText += 'Ve frontě nejsou žádné další skladby. Přidat můžeš přes !play <odkaz>';
      } else {
        qText += `Další ve frontě (${room.musicQueue.length}):\n` +
          room.musicQueue.map((t, idx) => `#${idx + 1} "${t.title}" (od ${t.requestedBy || 'neznámý'})`).join('\n');
      }

      const qMsg = room.addChatMessage('📋 FRONTA', qText);
      socket.emit('chat_message', qMsg);
      return;
    }

    // Příkaz pro přeskočení hudby: !skip (více jak polovina hráčů)
    if (cleanMsg.toLowerCase() === '!skip') {
      if (!mode.startsWith('custom_')) {
        socket.emit('error_message', {
          message: 'Hudba a hlasování o skip je povoleno pouze ve Vlastní aréně!'
        });
        return;
      }

      const skipRes = room.voteSkipMusic(socket.id);
      if (skipRes.error) {
        socket.emit('error_message', { message: skipRes.error });
        return;
      }

      const chatEntry = room.addChatMessage(player.name, cleanMsg, player.isAdmin);
      io.to(mode).emit('chat_message', chatEntry);

      if (skipRes.skipped) {
        if (skipRes.nextTrack) {
          io.to(mode).emit('music_play', {
            ...skipRes.nextTrack,
            skipVotes: 0,
            requiredSkipVotes: room.getRequiredSkipVotes(),
            hasVotedSkip: false,
            serverTime: Date.now(),
            queue: room.musicQueue.map((t, idx) => ({
              position: idx + 1,
              videoId: t.videoId,
              title: t.title,
              requestedBy: t.requestedBy
            })),
            queueLength: room.musicQueue.length
          });
          io.to(mode).emit('notification', {
            message: `⏭️ Hudba přeskočena většinou hráčů! Nyní z fronty hraje: ${skipRes.nextTrack.title}`
          });
        } else {
          io.to(mode).emit('music_stop', { stoppedBy: 'hlasování (skip)' });
          io.to(mode).emit('notification', {
            message: `⏭️ Hudba byla přeskočena většinou hráčů a fronta je prázdná.`
          });
        }
        broadcastGameState(mode);
      } else {
        const actionText = skipRes.hasVoted ? 'hlasoval(a) pro přeskočení hudby' : 'zrušil(a) svůj hlas pro přeskočení';
        io.to(mode).emit('notification', {
          message: `⏭️ ${player.name} ${actionText} (${skipRes.votesCount}/${skipRes.requiredVotes}).`
        });
        io.to(mode).emit('music_skip_update', {
          skipVotes: skipRes.votesCount,
          requiredSkipVotes: skipRes.requiredVotes
        });
      }
      return;
    }

    // Příkaz pro zastavení hudby: !stop (pouze pro odesílatele)
    if (cleanMsg.toLowerCase() === '!stop') {
      const chatEntry = room.addChatMessage(player.name, cleanMsg, player.isAdmin);
      io.to(mode).emit('chat_message', chatEntry);

      socket.emit('music_stop');
      socket.emit('notification', {
        message: '⏹️ Hudba byla zastavena pro tebe.'
      });
      return;
    }

    // Příkaz pro zábavu: !debil
    if (cleanMsg.toLowerCase() === '!debil' || cleanMsg.toLowerCase().startsWith('!debil ')) {
      const chatEntry = room.addChatMessage(player.name, cleanMsg, player.isAdmin);
      io.to(mode).emit('chat_message', chatEntry);

      const rawTarget = cleanMsg.slice(6).trim();
      const target = rawTarget ? rawTarget.replace(/^@/, '').trim() : player.name;
      const percent = Math.floor(Math.random() * 101);

      const botMsg = room.addChatMessage('🤖 BOT', `@${target} je na ${percent}% debil`);
      io.to(mode).emit('chat_message', botMsg);
      return;
    }

    // Příkaz pro vytvoření ankety: !poll <otázka> | <volba 1> | <volba 2> [| <volba 3> ...]
    if (cleanMsg.toLowerCase().startsWith('!poll ') || cleanMsg.toLowerCase() === '!poll') {
      if (!player.isAdmin) {
        socket.emit('error_message', {
          message: 'Anketu v chatu může vyhlásit pouze administrátor.'
        });
        return;
      }

      const chatEntry = room.addChatMessage(player.name, cleanMsg, player.isAdmin);
      io.to(mode).emit('chat_message', chatEntry);

      const pollContent = cleanMsg.slice(5).trim();
      if (!pollContent || !pollContent.includes('|')) {
        socket.emit('error_message', {
          message: 'Použití: !poll Otázka? | Možnost 1 | Možnost 2 (odděluj svislicí |).'
        });
        return;
      }

      const parts = pollContent.split('|').map(s => s.trim()).filter(Boolean);
      if (parts.length < 3) {
        socket.emit('error_message', {
          message: 'Zadej otázku a alespoň 2 možnosti. Např.: !poll Dáme těžké slovo? | Ano | Ne'
        });
        return;
      }

      const question = parts[0];
      const options = parts.slice(1);

      const createRes = room.createPoll(question, options, player.name, player.isAdmin);
      if (createRes.error) {
        socket.emit('error_message', { message: createRes.error });
        return;
      }

      if (activePollTimers.has(mode)) {
        clearTimeout(activePollTimers.get(mode));
      }
      activePollTimers.set(mode, setTimeout(() => {
        handleEndPoll(mode);
      }, 60000));

      const annMsg = room.addChatMessage(
        '📊 ANKETA',
        `@${player.name} vyhlásil(a) anketu: "${createRes.poll.question}"!\nHlasuj kliknutím na tlačítko nebo napiš číslo 1-${options.length} do chatu (zbývá 60 s).`,
        false,
        null,
        '#f59e0b'
      );
      io.to(mode).emit('chat_message', annMsg);
      broadcastPollUpdate(mode);
      return;
    }

    // Příkaz pro předčasné ukončení ankety: !endpoll
    if (cleanMsg.toLowerCase() === '!endpoll') {
      if (!player.isAdmin) {
        socket.emit('error_message', { message: 'Nemáš administrátorská oprávnění.' });
        return;
      }
      if (!room.currentPoll || !room.currentPoll.active) {
        socket.emit('error_message', { message: 'Právě neprobíhá žádná aktivní anketa.' });
        return;
      }
      handleEndPoll(mode, true);
      return;
    }

    // Hlasování v anketě napsáním čísla do chatu (1, 2, 3...)
    if (/^[1-5]$/.test(cleanMsg) && room.currentPoll && room.currentPoll.active) {
      const optIdx = parseInt(cleanMsg, 10) - 1;
      if (optIdx < room.currentPoll.options.length) {
        const vRes = room.votePoll(socket.id, optIdx);
        if (!vRes.error) {
          const chatEntry = room.addChatMessage(player.name, cleanMsg, player.isAdmin);
          io.to(mode).emit('chat_message', chatEntry);

          socket.emit('notification', {
            message: `Tvůj hlas byl započítán pro: "${room.currentPoll.options[optIdx].text}"`
          });
          broadcastPollUpdate(mode);
          return;
        }
      }
    }

    // ── ADMINISTRÁTORSKÉ PŘÍKAZY ─────────────────────────
    // Admin příkaz pro promazání chatu: !clear, !clearchat
    if (['!clear', '!clearchat'].includes(cleanMsg.toLowerCase())) {
      if (!player.isAdmin) {
        socket.emit('error_message', { message: 'Nemáš administrátorská oprávnění.' });
        return;
      }
      room.clearChat();
      io.to(mode).emit('chat_cleared');
      io.to(mode).emit('notification', {
        message: `🧹 Administrátor ${player.name} promazal historii chatu.`
      });
      return;
    }

    // Admin příkaz pro globální oznámení: !announce <text>, !oznameni <text>
    if (cleanMsg.toLowerCase().startsWith('!announce ') || cleanMsg.toLowerCase().startsWith('!oznameni ')) {
      if (!player.isAdmin) {
        socket.emit('error_message', { message: 'Nemáš administrátorská oprávnění.' });
        return;
      }
      const text = cleanMsg.replace(/^!(announce|oznameni)\s+/i, '').trim();
      if (!text) {
        socket.emit('error_message', { message: 'Použití: !announce <text oznámení>' });
        return;
      }
      io.to(mode).emit('notification', {
        message: `📢 [OZNÁMENÍ]: ${text}`
      });
      const annMsg = room.addChatMessage('📢 OZNÁMENÍ', text, true);
      io.to(mode).emit('chat_message', annMsg);
      return;
    }

    // Admin příkaz pro vyhození hráče: !kick <hráč>
    if (cleanMsg.toLowerCase().startsWith('!kick ')) {
      if (!player.isAdmin) {
        socket.emit('error_message', { message: 'Nemáš administrátorská oprávnění.' });
        return;
      }
      const targetName = cleanMsg.slice(6).trim().toLowerCase();
      const targetSocketId = Object.keys(room.players).find(
        (id) => room.players[id].name.toLowerCase() === targetName
      );
      if (!targetSocketId) {
        socket.emit('error_message', { message: `Hráč "${cleanMsg.slice(6).trim()}" nebyl v aréně nalezen.` });
        return;
      }
      const kickedPlayer = room.players[targetSocketId];
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.emit('kicked', { message: 'Byl(a) jsi vyhozen(a) administrátorem.' });
        targetSocket.disconnect(true);
      }
      io.to(mode).emit('notification', {
        message: `👢 Hráč ${kickedPlayer.name} byl vyhozen administrátorem.`
      });
      broadcastGameState(mode);
      broadcastArenaCounts();
      return;
    }

    // Admin příkaz pro okamžité přeskočení hudby: !forceskip
    if (cleanMsg.toLowerCase() === '!forceskip') {
      if (!player.isAdmin) {
        socket.emit('error_message', { message: 'Nemáš administrátorská oprávnění.' });
        return;
      }
      if (!room.currentMusic) {
        socket.emit('error_message', { message: 'Právě nehraje žádná hudba.' });
        return;
      }
      const nextTrack = room.playNextTrack();
      if (nextTrack) {
        io.to(mode).emit('music_play', {
          ...nextTrack,
          skipVotes: 0,
          requiredSkipVotes: room.getRequiredSkipVotes(),
          hasVotedSkip: false,
          serverTime: Date.now(),
          queue: room.musicQueue.map((t, idx) => ({
            position: idx + 1,
            videoId: t.videoId,
            title: t.title,
            requestedBy: t.requestedBy
          })),
          queueLength: room.musicQueue.length
        });
        io.to(mode).emit('notification', {
          message: `⏭️ Administrátor přeskočil hudbu! Nyní hraje: ${nextTrack.title}`
        });
      } else {
        io.to(mode).emit('music_stop', { stoppedBy: 'administrátor' });
        io.to(mode).emit('notification', {
          message: '⏭️ Administrátor přeskočil hudbu. Fronta je prázdná.'
        });
      }
      broadcastGameState(mode);
      return;
    }

    // Admin příkaz pro zastavení hudby pro celou místnost: !forcestop
    if (cleanMsg.toLowerCase() === '!forcestop') {
      if (!player.isAdmin) {
        socket.emit('error_message', { message: 'Nemáš administrátorská oprávnění.' });
        return;
      }
      room.clearMusicTrack();
      io.to(mode).emit('music_stop');
      io.to(mode).emit('notification', {
        message: '⏹️ Administrátor zastavil přehrávání hudby pro celou arénu.'
      });
      broadcastGameState(mode);
      return;
    }

    // Admin příkaz pro okamžité vylosování nového slova: !forceword, !nove
    if (['!forceword', '!nove'].includes(cleanMsg.toLowerCase())) {
      if (!player.isAdmin) {
        socket.emit('error_message', { message: 'Nemáš administrátorská oprávnění.' });
        return;
      }
      if (mode === 'unlimited') {
        const resetInfo = room.resetWithNewWord();
        io.to('unlimited').emit('notification', {
          message: `🎲 Administrátor vylosoval nové slovo! Předchozí slovo bylo: "${resetInfo.oldWord}".`
        });
        broadcastGameState('unlimited');
      } else {
        socket.emit('error_message', { message: 'Okamžité losování nového slova je dostupné v Unlimited režimu.' });
      }
      return;
    }

    // Admin příkaz pro privátní zobrazení tajného slova administrátorovi: !reveal
    if (cleanMsg.toLowerCase() === '!reveal') {
      if (!player.isAdmin) {
        socket.emit('error_message', { message: 'Nemáš administrátorská oprávnění.' });
        return;
      }
      const secret = room.targetWordObj ? room.targetWordObj.word : 'Neznámé';
      const hint = room.targetWordObj ? room.targetWordObj.hint : '';
      const privMsg = room.addChatMessage('🔑 ADMIN NÁPOVĚDA', `Tajné slovo (#1) je: "${secret}" (nápověda: ${hint})`, true);
      socket.emit('chat_message', privMsg);
      return;
    }

    // Nápověda příkazů: !, !help, !prikazy
    if (['!', '!help', '!prikazy', '!commands'].includes(cleanMsg.toLowerCase())) {
      let helpText = 'Příkazy: !play [název skladby nebo YouTube odkaz] (pustit hudbu / přidat do fronty), !queue (fronta), !skip (hlasovat pro skip), !stop (zastavení pro sebe), !debil (změří na kolik % jsi debil)';
      if (player.isAdmin) {
        helpText += '\n👑 Admin příkazy: !poll <otázka> | <volba 1> | <volba 2> (anketa), !endpoll, !kick <hráč>, !clear, !announce <text>, !forceskip, !forcestop, !forceword, !reveal';
      }
      const helpMsg = room.addChatMessage('ℹ️ NÁPOVĚDA', helpText, player.isAdmin);
      socket.emit('chat_message', helpMsg);
      return;
    }

    const chatEntry = room.addChatMessage(player.name, cleanMsg, player.isAdmin);
    io.to(mode).emit('chat_message', chatEntry);
  });

  // Hlasování v anketě kliknutím na tlačítko
  socket.on('vote_poll', ({ optionIndex }) => {
    const room = gameManager.getRoomForSocket(socket.id);
    const mode = gameManager.getModeForSocket(socket.id);
    const player = room?.players[socket.id];
    if (!room || !player) return;

    const vRes = room.votePoll(socket.id, optionIndex);
    if (vRes.error) {
      socket.emit('error_message', { message: vRes.error });
      return;
    }

    socket.emit('notification', {
      message: `Hlasoval(a) jsi pro: "${room.currentPoll.options[optionIndex].text}"`
    });
    broadcastPollUpdate(mode);
  });

  // Žádost o data TOP 50 pro hráče v diváckém režimu
  socket.on('get_top_50', () => {
    const room = gameManager.getRoomForSocket(socket.id);
    const player = room?.players[socket.id];
    if (!room || !player) return;

    const canSeeSecret = player.solved || player.gaveUp;
    if (!canSeeSecret) {
      socket.emit('error_message', { message: 'TOP 50 je dostupné až po uhodnutí slova nebo vzdání se.' });
      return;
    }

    const top50 = wordService.getTop50(room.targetWordObj);
    socket.emit('top_50_data', {
      word: room.targetWordObj.word,
      top50
    });
  });

  // Hlasování o přeskočení hudby tlačítkem z horního baru
  socket.on('skip_music', () => {
    const room = gameManager.getRoomForSocket(socket.id);
    const mode = gameManager.getModeForSocket(socket.id);
    const player = room.players[socket.id];
    if (!player) return;

    const skipRes = room.voteSkipMusic(socket.id);
    if (skipRes.error) {
      socket.emit('error_message', { message: skipRes.error });
      return;
    }

    if (skipRes.skipped) {
      if (skipRes.nextTrack) {
        io.to(mode).emit('music_play', {
          ...skipRes.nextTrack,
          skipVotes: 0,
          requiredSkipVotes: room.getRequiredSkipVotes(),
          hasVotedSkip: false,
          serverTime: Date.now(),
          queue: room.musicQueue.map((t, idx) => ({
            position: idx + 1,
            videoId: t.videoId,
            title: t.title,
            requestedBy: t.requestedBy
          })),
          queueLength: room.musicQueue.length
        });
        io.to(mode).emit('notification', {
          message: `⏭️ Hudba přeskočena většinou hráčů! Nyní z fronty hraje: ${skipRes.nextTrack.title}`
        });
      } else {
        io.to(mode).emit('music_stop', { stoppedBy: 'hlasování (skip)' });
        io.to(mode).emit('notification', {
          message: `⏭️ Hudba byla přeskočena většinou hráčů a fronta je prázdná.`
        });
      }
      broadcastGameState(mode);
    } else {
      const actionText = skipRes.hasVoted ? 'hlasoval(a) pro přeskočení hudby' : 'zrušil(a) svůj hlas pro přeskočení';
      io.to(mode).emit('notification', {
        message: `⏭️ ${player.name} ${actionText} (${skipRes.votesCount}/${skipRes.requiredVotes}).`
      });
      io.to(mode).emit('music_skip_update', {
        skipVotes: skipRes.votesCount,
        requiredSkipVotes: skipRes.requiredVotes
      });
    }
  });

  // Zastavení hudby tlačítkem z horního baru (pouze pro odesílatele)
  socket.on('stop_music', () => {
    socket.emit('music_stop');
    socket.emit('notification', {
      message: '⏹️ Hudba byla zastavena pro tebe.'
    });
  });

  // Potvrzení vyhledané skladby tlačítkem ANO / NE z chatu
  socket.on('confirm_play_song', ({ confirm, confirmId }) => {
    const room = gameManager.getRoomForSocket(socket.id);
    const mode = gameManager.getModeForSocket(socket.id);
    const player = room?.players[socket.id];
    if (!room || !player) return;

    const pendingConf = room.pendingSongConfirmations ? room.pendingSongConfirmations[socket.id] : null;
    if (!pendingConf || (confirmId && pendingConf.confirmId !== confirmId)) {
      socket.emit('error_message', { message: 'Žádost o potvrzení skladby již vypršela nebo neexistuje.' });
      return;
    }

    handleSongConfirmation(socket, room, mode, player, pendingConf, !!confirm);
  });

  // Konec skladby ohlášený klientem (automatický přechod na další skladbu ve frontě)
  socket.on('track_ended', (data) => {
    const room = gameManager.getRoomForSocket(socket.id);
    const mode = gameManager.getModeForSocket(socket.id);
    if (!room || !room.currentMusic) return;

    if (data && data.videoId && room.currentMusic.videoId !== data.videoId) {
      return;
    }

    const now = Date.now();
    if (room.lastTrackEndedAt && now - room.lastTrackEndedAt < 2500) {
      return;
    }
    room.lastTrackEndedAt = now;

    const nextTrack = room.playNextTrack();
    if (nextTrack) {
      io.to(mode).emit('music_play', {
        ...nextTrack,
        skipVotes: 0,
        requiredSkipVotes: room.getRequiredSkipVotes(),
        hasVotedSkip: false,
        serverTime: Date.now(),
        queue: room.musicQueue.map((t, idx) => ({
          position: idx + 1,
          videoId: t.videoId,
          title: t.title,
          requestedBy: t.requestedBy
        })),
        queueLength: room.musicQueue.length
      });
      io.to(mode).emit('notification', {
        message: `🎵 Z fronty nyní hraje: ${nextTrack.title}`
      });
      broadcastGameState(mode);
    } else {
      io.to(mode).emit('music_stop');
      broadcastGameState(mode);
    }
  });

  // Hlášení klienta, že skladbu nelze přehrát (autorská práva, zablokované vkládání apod.)
  socket.on('track_failed', (data) => {
    const room = gameManager.getRoomForSocket(socket.id);
    const mode = gameManager.getModeForSocket(socket.id);
    if (!room || !room.currentMusic) return;

    if (data && data.videoId && room.currentMusic.videoId !== data.videoId) {
      return;
    }

    const now = Date.now();
    if (room.lastTrackFailedAt && now - room.lastTrackFailedAt < 3000) {
      return;
    }
    room.lastTrackFailedAt = now;

    const failedTitle = room.currentMusic.title || 'Skladba';
    const nextTrack = room.playNextTrack();

    io.to(mode).emit('notification', {
      message: `⚠️ Skladbu "${failedTitle}" nelze přehrát (autorská práva nebo omezení vloženého videa na YouTube). Přeskakuji...`
    });

    if (nextTrack) {
      io.to(mode).emit('music_play', {
        ...nextTrack,
        skipVotes: 0,
        requiredSkipVotes: room.getRequiredSkipVotes(),
        hasVotedSkip: false,
        serverTime: Date.now(),
        queue: room.musicQueue.map((t, idx) => ({
          position: idx + 1,
          videoId: t.videoId,
          title: t.title,
          requestedBy: t.requestedBy
        })),
        queueLength: room.musicQueue.length
      });
      io.to(mode).emit('notification', {
        message: `🎵 Z fronty nyní hraje: ${nextTrack.title}`
      });
      broadcastGameState(mode);
    } else {
      io.to(mode).emit('music_stop');
      broadcastGameState(mode);
    }
  });

  // 7. Odpojení hráče
  socket.on('disconnect', () => {
    socketRateLimits.delete(socket.id);
    if (gameManager.isSocketReplaced(socket.id)) {
      gameManager.clearReplacedSocket(socket.id);
      return;
    }
    const removal = gameManager.removePlayer(socket.id);
    if (removal && removal.player) {
      io.to(removal.mode).emit('notification', {
        message: `${removal.player.name} opustil(a) hru.`
      });

      if (removal.newWordTriggered) {
        io.to('unlimited').emit('notification', {
          message: `🗳️ Po odpojení hráče byla splněna většina hlasů! Předchozí slovo bylo: "${removal.oldWord}". Vylosováno nové slovo!`
        });
      }

      broadcastGameState(removal.mode);
      broadcastArenaCounts();
    }
  });
});

async function startServer() {
  pruneReportLog();
  const reportCleanupTimer = setInterval(pruneReportLog, 24 * 60 * 60 * 1000);
  if (reportCleanupTimer.unref) reportCleanupTimer.unref();

  const onUserDeleted = (deletedUsername) => {
    playerProfileManager.deleteProfile(deletedUsername);
  };

  try {
    await authService.init(onUserDeleted);
    // Periodické čištění expirovaných relací (> 30 dní) a neaktivních účtů (> 21 dní / 3 týdny)
    const authCleanupTimer = setInterval(() => {
      authService.pruneExpiredData(onUserDeleted);
    }, 24 * 60 * 60 * 1000);
    if (authCleanupTimer.unref) authCleanupTimer.unref();
  } catch (err) {
    console.error('[AUTH] Databázi se nepodařilo inicializovat; server poběží bez účtů:', err.message);
  }
  server.listen(PORT, () => {
    console.log(`Server běží na portu ${PORT}: http://localhost:${PORT}`);
  });
}

startServer();

// Uložení stavu při vypnutí serveru (Ctrl+C nebo SIGTERM)
function handleShutdown(signal) {
  console.log(`\n[SERVER] Přijat signál ${signal}. Ukládám stav hry a guest profily před vypnutím...`);
  gameManager.saveStateToFile(true);
  playerProfileManager.saveProfiles(true);
  process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
  console.error('[SERVER] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[SERVER] Unhandled Rejection at:', promise, 'reason:', reason);
});
