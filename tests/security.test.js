const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const security = require('../src/security');
const root = path.join(__dirname, '..');
const word = require('../src/wordService');
const silent = { log() {}, warn() {}, error() {} };

function load(file, dependencies = {}, env = {}) {
  const module = { exports: {} };
  const timers = [];
  const schedule = (fn, delay) => { const timer = { fn, delay, unref() {} }; timers.push(timer); return timer; };
  const context = {
    module, exports: module.exports, require: name => dependencies[name] || require(name),
    __dirname: path.dirname(path.join(root, file)), console: silent, Buffer, URL,
    process: { env, platform: process.platform, on() {} },
    setTimeout: schedule, setInterval: schedule, clearTimeout() {}, clearInterval() {}
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  return { value: module.exports, timers };
}

function fixture() {
  const safeFs = { ...fs, existsSync: () => false };
  const profiles = load('src/playerProfileManager.js', { fs: safeFs, './wordService': word,
    './authService': { saveUserProfile() {} } }).value;
  const loaded = load('src/roomManager.js', { fs: safeFs, './wordService': word,
    './playerProfileManager': profiles, './security': security });
  return { profiles, gm: loaded.value, timers: loaded.timers, safeFs };
}

function serverFixture() {
  const f = fixture();
  const handlers = {};
  const io = { engine: { use() {} }, use(fn) { handlers.middleware = fn; },
    on(event, fn) { handlers[event] = fn; }, emit() {}, to() { return { emit() {} }; },
    sockets: { sockets: new Map() } };
  const app = { set() {}, use() {}, get() {}, post() {}, delete() {} };
  function express() { return app; }
  express.json = express.static = () => () => {};
  const auth = { isUsernameTaken: async () => false, init: async () => false,
    getUserByToken: async () => null, touchActivity() {}, markAsRegistered() {} };
  load('server.js', { express, http: { createServer: () => ({ listen() {} }) },
    helmet: () => () => {}, 'socket.io': { Server: function () { return io; } },
    './src/roomManager': f.gm, './src/emoteService': { init() {}, getEmotes: () => [] },
    './src/wordService': word, './src/playerProfileManager': f.profiles,
    './src/authService': auth, './src/security': security, fs: f.safeFs });
  function socket(id, identity = `guest:${id}`, address = `198.51.100.${io.sockets.sockets.size + 1}`) {
    const events = [], listeners = {};
    const s = { id, connected: true, data: { identity }, rooms: new Set([id]),
      handshake: { address, headers: {} }, request: { guestIdentity: identity },
      on: (name, fn) => { listeners[name] = fn; }, emit: (name, data) => events.push([name, data]),
      join: name => s.rooms.add(name), leave: name => s.rooms.delete(name),
      to: () => ({ emit() {} }), disconnect() { s.connected = false; listeners.disconnect?.(); } };
    io.sockets.sockets.set(id, s);
    handlers.connection(s);
    return { s, events, call: (event, ...args) => listeners[event](...args) };
  }
  return { ...f, auth, socket, handlers };
}

test('chat escaping encodes quotes in attribute context', () => {
  const source = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source.match(/function escapeHtml\(str\) \{[\s\S]*?\n\}/)[0], context);
  assert.equal(vm.runInContext(`escapeHtml('" onpointerenter="attack()')`, context), '&quot; onpointerenter=&quot;attack()');
  assert.equal(context.escapeHtml("<&'>"), '&lt;&amp;&#39;&gt;');
});

test('same name cannot recover another guest state, statistics or guesses', () => {
  const { gm, profiles } = fixture();
  const room = gm.rooms.daily;
  room.joinPlayer('a', 'Alice', null, 'guest:a');
  room.submitGuess('a', room.targetWordObj.word);
  const joined = room.joinPlayer('b', 'Alice', null, 'guest:b');
  assert.equal(joined.player.solved, false);
  assert.equal(room.guesses[0].socketId, 'a');
  assert.equal(room.getGameStateForPlayer('b').guesses.length, 0);
  assert.equal(room.getGameStateForPlayer('b').secretWord, null);
  assert.equal(profiles.getProfile(joined.player.profileKey).stats.gamesWon, 0);
});

test('verified owner recovers guesses after disconnect and a new socket', () => {
  const { gm } = fixture();
  const room = gm.rooms.daily;
  room.joinPlayer('a', 'Alice', null, 'guest:a');
  room.submitGuess('a', room.targetWordObj.word);
  room.removePlayer('a');
  const restored = room.joinPlayer('new', 'Alice', null, 'guest:a');
  assert.equal(restored.player.solved, true);
  assert.equal(room.guesses[0].socketId, 'new');
  assert.equal(room.getGameStateForPlayer('new').guesses[0].isMine, true);
});

test('reconnect recomputes admin privileges', () => {
  const { gm } = fixture();
  const room = gm.rooms.daily;
  room.joinPlayer('a', 'Admin', null, 'user:1', null, null, true);
  const next = room.joinPlayer('b', 'Admin', null, 'user:1', null, null, false);
  assert.equal(next.isReconnect, true);
  assert.equal(next.player.isAdmin, false);
  const guest = room.joinPlayer('c', 'Admin', null, 'guest:a');
  assert.equal(guest.isReconnect, false);
  assert.equal(guest.player.isAdmin, false);
});

test('client statistics are ignored; database statistics are hydrated', () => {
  const { profiles } = fixture();
  const profile = profiles.getOrCreateProfile('Cheater', null, { gamesWon: 999999, currentStreak: 999999 });
  assert.equal(profile.stats.gamesWon, 0);
  profiles.getOrCreateProfile('Cheater', null, { recordedPlayedGames: {} });
  profiles.markAsRegistered('Account', { stats: { gamesPlayed: 10, gamesWon: 4 } });
  assert.equal(profiles.getProfile('Account').stats.gamesWon, 4);
});

test('empty custom rooms expire both after switches and without a join', () => {
  const { gm, timers } = fixture();
  gm.createCustomRoom('daily', 'EMPTY');
  gm.joinPlayer('a', 'Alice', 'custom', null, 'FIRST', 'daily', 'guest:a');
  gm.joinPlayer('a', 'Alice', 'custom', null, 'SECOND', 'daily', 'guest:a');
  gm.getCustomRoom('EMPTY').emptySince = Date.now() - 16 * 60 * 1000;
  gm.getCustomRoom('FIRST').emptySince = Date.now() - 16 * 60 * 1000;
  timers.find(t => t.delay === 60000).fn();
  assert.equal(gm.getCustomRoom('EMPTY'), null);
  assert.equal(gm.getCustomRoom('FIRST'), null);
  assert.ok(gm.getCustomRoom('SECOND'));
});

test('custom rooms have a global capacity and validated codes', () => {
  const { gm } = fixture();
  assert.throws(() => gm.createCustomRoom('daily', '../bad'), /INVALID_ROOM_CODE/);
  for (let i = 0; i < 200; i++) gm.createCustomRoom('daily', `A${i}`);
  assert.throws(() => gm.createCustomRoom('daily', 'FULL'), /ROOM_CAPACITY_REACHED/);
});

test('forwarded IP is ignored for direct clients and resolved from trusted hops', () => {
  const socket = (address, header) => ({ handshake: { address, headers: { 'x-forwarded-for': header } } });
  assert.equal(security.getClientIp(socket('198.51.100.1', 'spoof')), '198.51.100.1');
  assert.equal(security.getClientIp(socket('127.0.0.1', 'spoof, 198.51.100.2')), '198.51.100.2');
  assert.equal(security.getClientIp(socket('::ffff:127.0.0.1', '198.51.100.3')), '198.51.100.3');
});

test('guest identity is server issued, signed and restored from cookie', () => {
  const headers = {};
  const res = { getHeader: name => headers[name], setHeader: (name, value) => { headers[name] = value; } };
  const first = { headers: {} };
  security.ensureGuest(first, res);
  const cookie = headers['Set-Cookie'][0].split(';')[0];
  const next = { headers: { cookie } };
  security.ensureGuest(next, res);
  assert.equal(next.guestIdentity, first.guestIdentity);
  const forged = { headers: { cookie: cookie.replace(/.$/, char => char === '0' ? '1' : '0') } };
  security.ensureGuest(forged, res);
  assert.notEqual(forged.guestIdentity, first.guestIdentity);
});

test('all malformed event examples are rejected before executing handlers', async () => {
  const f = serverFixture();
  const client = f.socket('a');
  for (const [event, payload] of [['send_global_chat', null], ['create_custom_room', null],
    ['submit_guess', null], ['send_chat', { message: 123 }], ['join_game', { playerName: 'Alice', mode: {} }],
    ['update_player_color', { color: '" onclick="alert(1)' }]]) {
    await client.call(event, payload);
  }
  assert.equal(client.events.filter(e => e[0] === 'error_message').length, 6);
  assert.equal(f.gm.customRooms.size, 0);
});

test('join_game creation is subject to the five-arena limit across reconnects', async () => {
  const f = serverFixture();
  for (let i = 0; i < 6; i++) {
    const client = f.socket('a' + i, 'guest:a', '198.51.100.1');
    // Creation rate persists across reconnects; join throttling is separate.
    if (i) await new Promise(resolve => setTimeout(resolve, 310));
    await client.call('join_game', { playerName: 'Alice', mode: 'custom', customCode: `ARENA${i}` });
  }
  assert.equal(f.gm.customRooms.size, 5);
});

test('member cannot change source, while host can', async () => {
  const f = serverFixture();
  const host = f.socket('host'), member = f.socket('member');
  await host.call('join_game', { playerName: 'Host', mode: 'custom', customCode: 'ROOM' });
  await member.call('join_game', { playerName: 'Member', mode: 'custom', customCode: 'ROOM' });
  await member.call('switch_custom_word_source', { wordSource: 'archive' });
  assert.equal(f.gm.getCustomRoom('ROOM').wordSource, 'daily');
  await host.call('switch_custom_word_source', { wordSource: 'archive' });
  assert.equal(f.gm.getCustomRoom('ROOM').wordSource, 'archive');
});

test('client sessionId cannot impersonate a server identity', async () => {
  const f = serverFixture();
  const client = f.socket('a', 'guest:verified');
  await client.call('join_game', { playerName: 'Alice', sessionId: 'user:1', clientStats: { gamesWon: 999999 } });
  const player = f.gm.rooms.daily.players.a;
  assert.equal(player.sessionId, 'guest:verified');
  assert.equal(f.profiles.getProfile(player.profileKey).stats.gamesWon, 0);
});

test('same host name cannot take over room controls after the host disconnects', async () => {
  const f = serverFixture();
  const host = f.socket('host', 'guest:host');
  await host.call('join_game', { playerName: 'Host', mode: 'custom', customCode: 'ROOM' });
  host.s.disconnect();
  const attacker = f.socket('attacker', 'guest:attacker');
  await attacker.call('join_game', { playerName: 'Host', mode: 'custom', customCode: 'ROOM' });
  assert.equal(f.gm.getCustomRoom('ROOM').getGameStateForPlayer('attacker').isHost, false);
  await attacker.call('switch_custom_word_source', { wordSource: 'archive' });
  assert.equal(f.gm.getCustomRoom('ROOM').wordSource, 'daily');
});

test('authentication outage rejects the handshake instead of admitting a guest', async () => {
  const f = serverFixture();
  f.auth.isUsernameTaken = async () => { throw new Error('AUTH_UNAVAILABLE'); };
  const client = f.socket('a');
  let error;
  await f.handlers.middleware(client.s, result => { error = result; });
  assert.match(error.message, /nedostupné/);
});

test('invalidated account session disconnects before processing a command', async () => {
  const f = serverFixture(), client = f.socket('a', 'user:1');
  client.s.data.authUser = { id: 1, username: 'Admin' };
  client.s.data.authToken = 'revoked';
  await client.call('join_game', { playerName: 'Admin' });
  assert.equal(client.s.connected, false);
  assert.equal(f.gm.rooms.daily.players.a, undefined);
});

function authFixture(env, query = async () => ({ rows: [], rowCount: 0 })) {
  let config;
  const captured = [];
  function Pool(options) { config = options; this.on = () => {}; this.query = async (...args) => { captured.push(args); return query(...args); }; }
  const auth = load('src/authService.js', { pg: { Pool } }, env).value;
  return { auth, captured, getConfig: () => config };
}

test('configured but unavailable database never reports usernames free', async () => {
  const { auth } = authFixture({ DATABASE_URL: 'postgres://localhost/test' });
  await assert.rejects(auth.isUsernameTaken('Alice'), /AUTH_UNAVAILABLE/);
  await assert.rejects(auth.isUsernameTaken(''), /AUTH_UNAVAILABLE/);
  const disabled = authFixture({}).auth;
  assert.equal(await disabled.isUsernameTaken('Alice'), false);
});

test('TLS verifies certificates even with sslmode=require in connection string', () => {
  const f = authFixture({ DATABASE_URL: 'postgres://db.example/test?sslmode=require', NODE_ENV: 'production' });
  assert.equal(f.getConfig().ssl.rejectUnauthorized, true);
  assert.equal(new URL(f.getConfig().connectionString).searchParams.has('sslmode'), false);
});

test('registration rejects bcrypt truncation for ASCII and Czech passwords', async () => {
  const f = authFixture({ DATABASE_URL: 'postgres://localhost/test' });
  await f.auth.init(undefined, 1);
  await assert.rejects(f.auth.register('Alice', 'A'.repeat(73)), /INVALID_PASSWORD/);
  await assert.rejects(f.auth.register('Alice', 'Ž'.repeat(37)), /INVALID_PASSWORD/);
});

test('emote update distinguishes omission from explicit deletion', async () => {
  const f = authFixture({ DATABASE_URL: 'postgres://localhost/test' });
  await f.auth.init(undefined, 1);
  await f.auth.saveUserProfile('Alice', { emote: null });
  const deleted = f.captured.at(-1);
  assert.match(deleted[0], /CASE WHEN \$5::boolean THEN \$3 ELSE emote END/);
  assert.equal(deleted[1][2], null);
  assert.equal(deleted[1][4], true);
  await f.auth.saveUserProfile('Alice', { color: '#123456' });
  assert.equal(f.captured.at(-1)[1][4], false);
});

test('live HTTP and Engine.IO handshake preserve guest ownership and reject malformed packets', async t => {
  const f = fixture();
  const http = require('node:http');
  const SocketServer = require('socket.io').Server;
  let server, io;
  load('server.js', {
    http: { createServer(app) { server = http.createServer(app); return server; } },
    'socket.io': { Server: function (...args) { io = new SocketServer(...args); return io; } },
    './src/roomManager': f.gm, './src/emoteService': { init() {}, getEmotes: () => [] },
    './src/wordService': word, './src/playerProfileManager': f.profiles,
    './src/security': security, fs: f.safeFs,
    './src/authService': { init: async () => false, isUsernameTaken: async () => false,
      getUserByToken: async () => null }
  }, { PORT: '0' });
  t.after(() => new Promise(resolve => io.close(resolve)));
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const me = await fetch(`${base}/api/auth/me`);
  assert.equal(me.status, 200);
  const cookie = me.headers.getSetCookie().map(s => s.split(';')[0]).join('; ');
  assert.match(cookie, /slovo_guest=/);
  const opened = await fetch(`${base}/socket.io/?EIO=4&transport=polling`, { headers: { Cookie: cookie } });
  const session = JSON.parse((await opened.text()).slice(1));
  const url = `${base}/socket.io/?EIO=4&transport=polling&sid=${session.sid}`;
  const post = body => fetch(url, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'text/plain' }, body });
  async function receive(event) {
    for (let i = 0; i < 10; i++) {
      const response = await fetch(url, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(3000) });
      for (const packet of (await response.text()).split('\x1e')) {
        if (packet === '2') await post('3');
        if (packet.startsWith('42')) {
          const data = JSON.parse(packet.slice(2));
          if (data[0] === event) return data[1];
        }
      }
    }
    throw new Error(`No ${event} received`);
  }
  await post('40');
  await receive('arena_counts');
  await post('42' + JSON.stringify(['join_game', { playerName: 'LiveGuest', sessionId: 'user:forged' }]));
  const state = await receive('game_state');
  assert.equal(state.myStatus.name, 'LiveGuest');
  const player = Object.values(f.gm.rooms.daily.players)[0];
  assert.match(player.sessionId, /^guest:/);
  assert.notEqual(player.sessionId, 'user:forged');
  await post('42' + JSON.stringify(['send_global_chat', null]));
  assert.match((await receive('error_message')).message, /Neplatný/);
  await post('42' + JSON.stringify(['submit_guess', { word: f.gm.rooms.daily.targetWordObj.word }]));
  const winning = await receive('game_state');
  assert.equal(winning.myStatus.solved, true);
  assert.equal(winning.guesses[0].isMine, true);
  assert.equal('ownerId' in winning.guesses[0], false);
  assert.equal('sessionId' in winning.players[0], false);
});
