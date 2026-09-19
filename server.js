const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const gameManager = require('./src/roomManager');
const emoteService = require('./src/emoteService');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

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

// 7TV Emotes API pro herní chat
app.get('/api/emotes', (req, res) => {
  res.json(emoteService.getEmotes());
});

// Unlimited mód – servíruje stejnou webovou aplikaci
app.get('/unlimited', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Počty hráčů online pro lobby přehled
app.get('/api/arena-stats', (req, res) => {
  res.json(gameManager.getOnlineCounts());
});

// Odeslání aktuálních počtů hráčů v aréně všem klientům (i v lobby)
function broadcastArenaCounts() {
  io.emit('arena_counts', gameManager.getOnlineCounts());
}

// Odeslání aktuálního stavu hry hráčům v dané místnosti
function broadcastGameState(mode) {
  const modes = mode ? [mode] : ['daily', 'unlimited'];
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

io.on('connection', (socket) => {
  // Odeslání aktuálních počtů hráčů v obou arénách (denní + unlimited) nově připojenému klientovi
  socket.emit('arena_counts', gameManager.getOnlineCounts());

  // 1. Vstup do hry (denní nebo unlimited)
  socket.on('join_game', ({ playerName, mode, color }) => {
    const gameMode = mode === 'unlimited' ? 'unlimited' : 'daily';

    // Opuštění předchozích místností
    socket.leave('daily');
    socket.leave('unlimited');
    socket.join(gameMode);

    const { player } = gameManager.joinPlayer(socket.id, playerName, gameMode, color);

    // Oznámení pro ostatní v téže místnosti
    socket.to(gameMode).emit('notification', {
      message: `${player.name} se připojil(a) do hry!`
    });

    // Odeslání stavu všem v dané místnosti
    broadcastGameState(gameMode);

    // Aktualizace počtů hráčů pro všechny klienty (včetně těch v lobby)
    broadcastArenaCounts();
  });

  // 2. Odeslání tipu
  socket.on('submit_guess', ({ word }) => {
    const room = gameManager.getRoomForSocket(socket.id);
    const mode = gameManager.getModeForSocket(socket.id);
    const result = room.submitGuess(socket.id, word);

    if (result.error) {
      socket.emit('error_message', { message: result.error });
      return;
    }

    if (result.isWinner) {
      socket.to(mode).emit('notification', {
        message: `${result.player.name} právě uhodl(a) tajné slovo (#1) na ${result.player.guessCount}. pokus!`
      });
      socket.emit('notification', {
        message: `Výborně! Uhodl(a) jsi tajné slovo: "${result.guess.word}" na ${result.player.guessCount}. pokus!`
      });

      // Bot komentátor na konci kola
      const commentaryLines = room.generateRoundCommentary(result.player);
      if (commentaryLines && commentaryLines.length > 0) {
        const fullCommentary = commentaryLines.join('\n');
        const botMsg = room.addChatMessage('🤖 BOT', fullCommentary, false, null, '#10b981');
        io.to(mode).emit('chat_message', botMsg);
      }
    } else {
      socket.to(mode).emit('notification', {
        message: `${result.player.name} poslal(a) nový tip.`
      });
    }

    broadcastGameState(mode);
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
  socket.on('use_hint', () => {
    const room = gameManager.getRoomForSocket(socket.id);
    const mode = gameManager.getModeForSocket(socket.id);
    const result = room.useHint(socket.id);

    if (result.error) {
      socket.emit('error_message', { message: result.error });
      return;
    }

    socket.to(mode).emit('notification', {
      message: `🤡 ${result.player.name} si zobrazil(a) nápovědu a získal(a) klauna!`
    });
    socket.emit('notification', {
      message: `Nápověda odhalena! Získal(a) jsi 🤡 vedle svého jména.`
    });

    broadcastGameState(mode);
  });

  // 5. Hlasování o nové slovo (pouze v Unlimited módu)
  socket.on('vote_new_word', () => {
    const mode = gameManager.getModeForSocket(socket.id);
    if (mode !== 'unlimited') {
      socket.emit('error_message', { message: 'Hlasování o nové slovo je dostupné pouze v Unlimited módu.' });
      return;
    }

    const room = gameManager.getRoom('unlimited');
    const result = room.voteNewWord(socket.id);

    if (result.error) {
      socket.emit('error_message', { message: result.error });
      return;
    }

    if (result.newWordTriggered) {
      io.to('unlimited').emit('notification', {
        message: `🗳️ Hlasování úspěšné! Předchozí slovo bylo: "${result.oldWord}". Vylosováno nové archivní slovo!`
      });
    } else {
      const actionText = result.hasVoted ? 'hlasoval(a) pro nové slovo' : 'zrušil(a) svůj hlas pro nové slovo';
      io.to('unlimited').emit('notification', {
        message: `🗳️ ${result.player.name} ${actionText} (${result.votesCount}/${result.requiredVotes}).`
      });
    }

    broadcastGameState('unlimited');
  });

  // 6. Zpráva do chatu a příkazy (!play, !stop)
  socket.on('send_chat', async ({ message }) => {
    const cleanMsg = (message || '').trim();
    if (!cleanMsg) return;

    const room = gameManager.getRoomForSocket(socket.id);
    const mode = gameManager.getModeForSocket(socket.id);
    const player = room.players[socket.id];
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

    // Příkaz pro přehrávání hudby: !play [youtube odkaz / název skladby]
    if (cleanMsg.toLowerCase().startsWith('!play')) {
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
      let helpText = 'Příkazy: !play [název skladby nebo YouTube odkaz] (pustit hudbu / přidat do fronty), !queue (fronta), !skip (hlasovat pro skip), !stop (zastavení pro sebe), !debil (změří na kolik % jsi debil), !poll <otázka> | <volba 1> | <volba 2> (anketa)';
      if (player.isAdmin) {
        helpText += '\n👑 Admin příkazy: !kick <hráč>, !clear, !announce <text>, !forceskip, !forcestop, !forceword, !reveal, !endpoll';
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

server.listen(PORT, () => {
  console.log(`Server běží na portu ${PORT}: http://localhost:${PORT}`);
});

// Uložení stavu při vypnutí serveru (Ctrl+C nebo SIGTERM)
function handleShutdown(signal) {
  console.log(`\n[SERVER] Přijat signál ${signal}. Ukládám stav hry před vypnutím...`);
  gameManager.saveStateToFile(true);
  process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
