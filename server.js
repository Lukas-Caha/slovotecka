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

// Statické soubory z /public
app.use(express.static(path.join(__dirname, 'public')));

// 7TV Emotes API pro herní chat
app.get('/api/emotes', (req, res) => {
  res.json(emoteService.getEmotes());
});

// Unlimited mód – servíruje stejnou webovou aplikaci
app.get('/unlimited', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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

async function fetchYouTubeTitle(videoId) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, {
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data = await res.json();
      if (data && data.title) return data.title;
    }
  } catch (err) {
    // Timeout nebo selhání oEmbed dotazu
  }
  return `YouTube video (${videoId})`;
}

io.on('connection', (socket) => {
  // 1. Vstup do hry (denní nebo unlimited)
  socket.on('join_game', ({ playerName, mode }) => {
    const gameMode = mode === 'unlimited' ? 'unlimited' : 'daily';

    // Opuštění předchozích místností
    socket.leave('daily');
    socket.leave('unlimited');
    socket.join(gameMode);

    const { player } = gameManager.joinPlayer(socket.id, playerName, gameMode);

    // Oznámení pro ostatní v téže místnosti
    socket.to(gameMode).emit('notification', {
      message: `${player.name} se připojil(a) do hry!`
    });

    // Odeslání stavu všem v dané místnosti
    broadcastGameState(gameMode);
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

    // Příkaz pro přehrávání hudby: !play [youtube odkaz]
    if (cleanMsg.toLowerCase().startsWith('!play')) {
      const urlPart = cleanMsg.slice(5).trim();
      const videoId = extractYouTubeId(urlPart);
      if (!videoId) {
        socket.emit('error_message', {
          message: 'Neplatný YouTube odkaz. Použij např.: !play https://www.youtube.com/watch?v=...'
        });
        return;
      }

      const title = await fetchYouTubeTitle(videoId);
      const track = {
        videoId,
        title,
        requestedBy: player.name
      };

      const result = room.enqueueMusicTrack(track);

      // Zápis zprávy do chatu
      const chatEntry = room.addChatMessage(player.name, cleanMsg, player.isAdmin);
      io.to(mode).emit('chat_message', chatEntry);

      if (result.playingNow) {
        // Hudba začala hrát ihned od začátku
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
          message: `🎵 ${player.name} pustil(a) hudbu: ${title}`
        });
      } else {
        // Skladba byla zařazena do fronty
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
          message: `📋 ${player.name} přidal(a) do fronty (#${result.position}): ${title}`
        });
      }
      broadcastGameState(mode);
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
      let helpText = 'Příkazy: !play [YouTube odkaz] (pustit hudbu / přidat do fronty), !queue (fronta), !skip (hlasovat pro skip), !stop (zastavení pro sebe)';
      if (player.isAdmin) {
        helpText += '\n👑 Admin příkazy: !kick <hráč>, !clear, !announce <text>, !forceskip, !forcestop, !forceword, !reveal';
      }
      const helpMsg = room.addChatMessage('ℹ️ NÁPOVĚDA', helpText, player.isAdmin);
      socket.emit('chat_message', helpMsg);
      return;
    }

    const chatEntry = room.addChatMessage(player.name, cleanMsg, player.isAdmin);
    io.to(mode).emit('chat_message', chatEntry);
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
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server běží na portu ${PORT}: http://localhost:${PORT}`);
});
