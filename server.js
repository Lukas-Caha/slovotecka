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
        requestedBy: player.name,
        startedAt: Date.now()
      };

      room.setMusicTrack(track);

      // Zápis zprávy do chatu
      const chatEntry = room.addChatMessage(player.name, cleanMsg);
      io.to(mode).emit('chat_message', chatEntry);

      // Spuštění hudby a notifikace
      io.to(mode).emit('music_play', track);
      io.to(mode).emit('notification', {
        message: `🎵 ${player.name} pustil(a) hudbu: ${title}`
      });
      return;
    }

    // Příkaz pro zastavení hudby: !stop
    if (cleanMsg.toLowerCase() === '!stop') {
      if (!room.currentMusic) {
        socket.emit('error_message', { message: 'Právě nehraje žádná hudba.' });
        return;
      }

      room.clearMusicTrack();

      const chatEntry = room.addChatMessage(player.name, cleanMsg);
      io.to(mode).emit('chat_message', chatEntry);

      io.to(mode).emit('music_stop', { stoppedBy: player.name });
      io.to(mode).emit('notification', {
        message: `⏹️ ${player.name} zastavil(a) přehrávání hudby.`
      });
      return;
    }

    const chatEntry = room.addChatMessage(player.name, cleanMsg);
    io.to(mode).emit('chat_message', chatEntry);
  });

  // Zastavení hudby tlačítkem z horního baru
  socket.on('stop_music', () => {
    const room = gameManager.getRoomForSocket(socket.id);
    const mode = gameManager.getModeForSocket(socket.id);
    const player = room.players[socket.id];
    if (!player || !room.currentMusic) return;

    room.clearMusicTrack();
    io.to(mode).emit('music_stop', { stoppedBy: player.name });
    io.to(mode).emit('notification', {
      message: `⏹️ ${player.name} zastavil(a) přehrávání hudby.`
    });
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
