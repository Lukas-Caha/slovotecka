const crypto = require('crypto');
const net = require('net');

const guestSecret = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const GUEST_COOKIE = 'slovo_guest';

function normalizeIp(ip) {
  return String(ip || '').replace(/^::ffff:/, '');
}

function isTrustedProxy(ip) {
  const address = normalizeIp(ip);
  const configured = String(process.env.TRUST_PROXY_IPS || '').split(',').map(s => normalizeIp(s.trim())).filter(Boolean);
  return address === '::1' || address === '127.0.0.1' || configured.includes(address);
}

function getClientIp(socket) {
  const peer = normalizeIp(socket.handshake.address);
  if (!isTrustedProxy(peer)) return peer;
  const forwarded = String(socket.handshake.headers['x-forwarded-for'] || '').split(',').map(s => normalizeIp(s.trim()));
  // Walk from the trusted peer toward the client, stopping at the first untrusted hop.
  let address = peer;
  for (let i = forwarded.length - 1; i >= 0 && isTrustedProxy(address); i--) {
    if (!net.isIP(forwarded[i])) break;
    address = forwarded[i];
  }
  return address;
}

function readCookie(headers, name) {
  try {
    const entry = String(headers.cookie || '').split(';').find(s => s.trim().startsWith(`${name}=`));
    return entry ? decodeURIComponent(entry.trim().slice(name.length + 1)) : null;
  } catch { return null; }
}

function guestSignature(token) {
  return crypto.createHmac('sha256', guestSecret).update(token).digest('hex');
}

function ensureGuest(req, res) {
  const value = readCookie(req.headers, GUEST_COOKIE) || '';
  const [token, signature] = value.split('.');
  const valid = /^[a-f0-9]{64}$/.test(token || '') && /^[a-f0-9]{64}$/.test(signature || '') &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(guestSignature(token)));
  const guestToken = valid ? token : crypto.randomBytes(32).toString('hex');
  req.guestIdentity = `guest:${guestToken}`;
  if (!valid) {
    const cookie = `${GUEST_COOKIE}=${guestToken}.${guestSignature(guestToken)}; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
    const existing = res.getHeader('Set-Cookie');
    res.setHeader('Set-Cookie', [...(Array.isArray(existing) ? existing : existing ? [existing] : []), cookie]);
  }
}

function profileKey(name, identity) {
  return identity?.startsWith('guest:') ? `${identity}:${name.trim().toLowerCase()}` : name;
}

const objectEvents = new Set(['create_custom_room', 'switch_custom_word_source', 'send_global_chat',
  'check_guest_profile', 'update_player_color', 'update_player_emote', 'join_game', 'submit_guess',
  'report_content', 'send_chat', 'vote_poll', 'confirm_play_song']);
const stringFields = { playerName: 40, mode: 40, customCode: 12, wordSource: 12, color: 7,
  emote: 100, sessionId: 200, word: 100, message: 500, reportedUser: 50,
  messageText: 500, reason: 300, confirmId: 100, videoId: 11 };

function validPayload(event, payload) {
  if (payload === undefined && !objectEvents.has(event)) return true;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  try { if (Buffer.byteLength(JSON.stringify(payload)) > 20000) return false; } catch { return false; }
  for (const [key, value] of Object.entries(payload)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) return false;
    if (key in stringFields && value !== null && (typeof value !== 'string' || value.length > stringFields[key])) return false;
  }
  if (['send_chat', 'send_global_chat'].includes(event) && typeof payload.message !== 'string') return false;
  if (event === 'submit_guess' && typeof payload.word !== 'string') return false;
  if (['join_game', 'check_guest_profile'].includes(event) &&
      (typeof payload.playerName !== 'string' || !/^(?!\s*$)[\p{L}\p{N}_ .()-]{1,40}$/u.test(payload.playerName))) return false;
  if (payload.mode != null && !/^(daily|unlimited|custom|custom_[A-Z0-9]{1,12})$/i.test(payload.mode)) return false;
  if (payload.customCode != null && !/^[A-Z0-9]{1,12}$/i.test(payload.customCode)) return false;
  if (payload.wordSource != null && !['daily', 'archive', 'speedrun'].includes(payload.wordSource)) return false;
  if (payload.color != null && !/^#[a-f0-9]{6}$/i.test(payload.color)) return false;
  if (payload.speedrunConfig != null) {
    const config = payload.speedrunConfig;
    if (typeof config !== 'object' || Array.isArray(config)) return false;
    if (config.durationMinutes !== undefined && (!Number.isFinite(Number(config.durationMinutes)) || Number(config.durationMinutes) < 1 || Number(config.durationMinutes) > 30)) return false;
    for (const key of ['enableMines', 'enableHints']) if (config[key] !== undefined && typeof config[key] !== 'boolean') return false;
  }
  if (event === 'vote_poll' && (!Number.isInteger(payload.optionIndex) || payload.optionIndex < 0)) return false;
  if (event === 'confirm_play_song' && typeof payload.confirm !== 'boolean') return false;
  if (payload.level !== undefined && ![1, 2, 3].includes(payload.level)) return false;
  return true;
}

module.exports = { isTrustedProxy, getClientIp, ensureGuest, profileKey, validPayload };
