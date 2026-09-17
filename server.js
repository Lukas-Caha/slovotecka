const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const gameManager = require('./src/roomManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Statické soubory z /public
app.use(express.static(path.join(__dirname, 'public')));

// Odeslání aktuálního stavu hry všem připojeným hráčům na míru
function broadcastGameState() {
  for (const socketId of Object.keys(gameManager.players)) {
    const playerSocket = io.sockets.sockets.get(socketId);
    if (playerSocket) {
      const state = gameManager.getGameStateForPlayer(socketId);
      playerSocket.emit('game_state', state);
    }
  }
}

// Kontrola půlnoci každých 30 sekund
setInterval(() => {
  const roll = gameManager.checkMidnightRoll();
  if (roll.isNewDay) {
    io.emit('notification', {
      message: `Odbila půlnoc! Začíná nové denní slovo pro ${roll.date}. Přejeme hodně štěstí!`
    });
    broadcastGameState();
  }
}, 30 * 1000);

io.on('connection', (socket) => {
  // 1. Vstup do společné denní hry
  socket.on('join_game', ({ playerName }) => {
    const player = gameManager.joinPlayer(socket.id, playerName);

    // Oznámení pro ostatní
    socket.broadcast.emit('notification', {
      message: `${player.name} se připojil(a) do hry!`
    });

    // Odeslání stavu přihlášenému i ostatním
    broadcastGameState();
  });

  // 2. Odeslání tipu
  socket.on('submit_guess', ({ word }) => {
    const result = gameManager.submitGuess(socket.id, word);

    if (result.error) {
      socket.emit('error_message', { message: result.error });
      return;
    }

    if (result.isWinner) {
      socket.broadcast.emit('notification', {
        message: `${result.player.name} právě uhodl(a) dnešní tajné slovo (#1) na ${result.player.guessCount}. pokus!`
      });
      socket.emit('notification', {
        message: `Výborně! Uhodl(a) jsi tajné slovo: "${result.guess.word}" na ${result.player.guessCount}. pokus!`
      });
    } else {
      socket.broadcast.emit('notification', {
        message: `${result.player.name} zkusil(a) "${result.guess.word}" -> pořadí ${result.guess.rank}`
      });
    }

    broadcastGameState();
  });

  // 3. Vzdát se a odhalit tajné slovo
  socket.on('reveal_word', () => {
    const result = gameManager.revealWord(socket.id);

    if (result.error) {
      socket.emit('error_message', { message: result.error });
      return;
    }

    socket.emit('notification', {
      message: `Tajné slovo pro dnešek bylo: "${result.targetWord}". Nyní jsi v režimu diváka.`
    });

    socket.broadcast.emit('notification', {
      message: `${result.player.name} se vzdal(a) a odhalil(a) slovo.`
    });

    broadcastGameState();
  });

  // 4. Odhalení nápovědy (získání 🤡)
  socket.on('use_hint', () => {
    const result = gameManager.useHint(socket.id);

    if (result.error) {
      socket.emit('error_message', { message: result.error });
      return;
    }

    socket.broadcast.emit('notification', {
      message: `🤡 ${result.player.name} si zobrazil(a) nápovědu a získal(a) klauna!`
    });
    socket.emit('notification', {
      message: `Nápověda odhalena! Získal(a) jsi 🤡 vedle svého jména.`
    });

    broadcastGameState();
  });

  // 5. Zpráva do chatu
  socket.on('send_chat', ({ message }) => {
    const cleanMsg = (message || '').trim();
    if (!cleanMsg) return;

    const player = gameManager.players[socket.id];
    if (!player) return;

    const chatEntry = gameManager.addChatMessage(player.name, cleanMsg);
    io.emit('chat_message', chatEntry);
  });

  // 6. Odpojení hráče
  socket.on('disconnect', () => {
    const player = gameManager.removePlayer(socket.id);
    if (player) {
      io.emit('notification', {
        message: `${player.name} opustil(a) hru.`
      });
      broadcastGameState();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server běží na portu ${PORT}: http://localhost:${PORT}`);
});
