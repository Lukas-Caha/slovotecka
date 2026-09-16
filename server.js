const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const roomManager = require('./src/roomManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static frontend from /public
app.use(express.static(path.join(__dirname, 'public')));

// Helper to broadcast personalized room state to all sockets in a room
function broadcastRoomState(roomCode) {
  const room = roomManager.getRoom(roomCode);
  if (!room) return;

  for (const socketId of Object.keys(room.players)) {
    const playerSocket = io.sockets.sockets.get(socketId);
    if (playerSocket) {
      const state = roomManager.getRoomStateForPlayer(room, socketId);
      playerSocket.emit('room_state', state);
    }
  }
}

io.on('connection', (socket) => {
  // Create a room
  socket.on('create_room', ({ playerName, isDaily }) => {
    const cleanName = (playerName || '').trim();
    if (!cleanName) {
      socket.emit('error_message', { message: 'Zadej své jméno.' });
      return;
    }

    const room = roomManager.createRoom(socket.id, cleanName, isDaily !== false);
    socket.join(room.code);

    const state = roomManager.getRoomStateForPlayer(room, socket.id);
    socket.emit('room_joined', state);
  });

  // Join an existing room
  socket.on('join_room', ({ code, playerName }) => {
    const cleanName = (playerName || '').trim();
    const cleanCode = (code || '').trim().toUpperCase();

    if (!cleanName) {
      socket.emit('error_message', { message: 'Zadej své jméno.' });
      return;
    }
    if (!cleanCode) {
      socket.emit('error_message', { message: 'Zadej kód místnosti.' });
      return;
    }

    const result = roomManager.joinRoom(cleanCode, socket.id, cleanName);
    if (result.error) {
      socket.emit('error_message', { message: result.error });
      return;
    }

    socket.join(cleanCode);

    // Notify others in the room
    socket.to(cleanCode).emit('notification', {
      message: `${cleanName} se připojil(a) do hry!`
    });

    // Send state to everyone in room
    broadcastRoomState(cleanCode);
  });

  // Submit a guess
  socket.on('submit_guess', ({ code, word }) => {
    const cleanCode = (code || '').trim().toUpperCase();
    const result = roomManager.submitGuess(cleanCode, socket.id, word);

    if (result.error) {
      socket.emit('error_message', { message: result.error });
      return;
    }

    if (result.isWinner) {
      // Announce victory to others without revealing the actual word!
      socket.to(cleanCode).emit('notification', {
        message: `🎉 ${result.player.name} právě uhodl(a) tajné slovo (#1) na ${result.player.guessCount}. pokus!`
      });
      socket.emit('notification', {
        message: `🏆 Výborně! Uhodl(a) jsi tajné slovo: "${result.guess.word}" na ${result.player.guessCount}. pokus!`
      });
    } else {
      socket.to(cleanCode).emit('notification', {
        message: `${result.player.name} zkusil(a) "${result.guess.word}" -> pořadí ${result.guess.rank}`
      });
    }

    // Refresh state for everyone (masks #1 for those who haven't solved it yet)
    broadcastRoomState(cleanCode);
  });

  // Reveal the secret word (give up)
  socket.on('reveal_word', ({ code }) => {
    const cleanCode = (code || '').trim().toUpperCase();
    const result = roomManager.revealWord(cleanCode, socket.id);

    if (result.error) {
      socket.emit('error_message', { message: result.error });
      return;
    }

    socket.emit('notification', {
      message: `Tajné slovo bylo: "${result.targetWord}". Nyní jsi v režimu diváka.`
    });

    socket.to(cleanCode).emit('notification', {
      message: `${result.player.name} se vzdal(a) a odhalil(a) slovo.`
    });

    // Update states so this player now sees the revealed word
    broadcastRoomState(cleanCode);
  });

  // Hráč odhalí nápovědu (dostane 🤡)
  socket.on('use_hint', ({ code }) => {
    const cleanCode = (code || '').trim().toUpperCase();
    const result = roomManager.useHint(cleanCode, socket.id);

    if (result.error) {
      socket.emit('error_message', { message: result.error });
      return;
    }

    socket.to(cleanCode).emit('notification', {
      message: `🤡 ${result.player.name} si zobrazil(a) nápovědu a získal(a) klauna!`
    });
    socket.emit('notification', {
      message: `💡 Nápověda odhalena! Získal(a) jsi 🤡 vedle svého jména.`
    });

    broadcastRoomState(cleanCode);
  });

  // Host starts next round with a new word
  socket.on('next_round', ({ code }) => {
    const cleanCode = (code || '').trim().toUpperCase();
    const result = roomManager.nextRound(cleanCode, socket.id);

    if (result.error) {
      socket.emit('error_message', { message: result.error });
      return;
    }

    io.to(cleanCode).emit('notification', {
      message: 'Hostitel zahájil nové kolo s novým tajným slovem!'
    });

    broadcastRoomState(cleanCode);
  });

  // Chat v místnosti
  socket.on('send_chat', ({ code, message }) => {
    const cleanCode = (code || '').trim().toUpperCase();
    const cleanMsg = (message || '').trim();
    if (!cleanMsg) return;

    const room = roomManager.getRoom(cleanCode);
    if (!room) return;

    const player = room.players[socket.id];
    if (!player) return;

    const chatEntry = {
      player: player.name,
      message: cleanMsg.slice(0, 250),
      time: new Date().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })
    };

    io.to(cleanCode).emit('chat_message', chatEntry);
  });

  // Disconnect
  socket.on('disconnect', () => {
    const result = roomManager.removePlayer(socket.id);
    if (result && !result.roomDeleted) {
      io.to(result.code).emit('notification', {
        message: `${result.playerName} opustil(a) hru.`
      });
      broadcastRoomState(result.code);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server běží na portu ${PORT}: http://localhost:${PORT}`);
});
