const { getDailyWord, getRandomWord, calculateRank } = require('./wordService');

const ROOM_TTL_MS = 2 * 60 * 60 * 1000; // 2 hodiny nečinnosti
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // kontrola každých 10 minut

class RoomManager {
  constructor() {
    this.rooms = new Map(); // roomId -> room object
    this._startCleanupTimer();
  }

  // Automaticky maže místnosti bez aktivity déle než ROOM_TTL_MS
  _startCleanupTimer() {
    setInterval(() => {
      const now = Date.now();
      for (const [code, room] of this.rooms.entries()) {
        const idle = now - (room.lastActivity || room.createdAt);
        if (idle > ROOM_TTL_MS) {
          console.log(`[cleanup] Místnost ${code} smazána po ${Math.round(idle / 60000)} min nečinnosti.`);
          this.rooms.delete(code);
        }
      }
    }, CLEANUP_INTERVAL_MS);
  }

  // Generate a random 4-letter uppercase room code
  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return this.rooms.has(code) ? this.generateRoomCode() : code;
  }

  // Create a new room
  createRoom(hostSocketId, hostName, isDaily = true) {
    const code = this.generateRoomCode();
    const targetWordObj = isDaily ? getDailyWord() : getRandomWord();

    const room = {
      code,
      isDaily,
      targetWordObj,
      hostId: hostSocketId,
      createdAt: Date.now(),
      players: {
        [hostSocketId]: {
          id: hostSocketId,
          name: hostName || 'Hostitel',
          solved: false,
          gaveUp: false,
          guessCount: 0,
          solvedAt: null
        }
      },
      guesses: [], // array of { player, socketId, word, rank, timestamp }
      lastActivity: Date.now()
    };

    this.rooms.set(code, room);
    return room;
  }

  // Get room by code
  getRoom(code) {
    if (!code) return null;
    return this.rooms.get(code.toUpperCase().trim()) || null;
  }

  // Join existing room
  joinRoom(code, socketId, playerName) {
    const room = this.getRoom(code);
    if (!room) {
      return { error: 'Místnost nebyla nalezena.' };
    }

    room.players[socketId] = {
      id: socketId,
      name: playerName || `Hráč ${Object.keys(room.players).length + 1}`,
      solved: false,
      gaveUp: false,
      guessCount: 0,
      solvedAt: null
    };

    return { room };
  }

  // Player disconnects
  removePlayer(socketId) {
    for (const [code, room] of this.rooms.entries()) {
      if (room.players[socketId]) {
        const playerName = room.players[socketId].name;
        delete room.players[socketId];

        const remainingPlayerIds = Object.keys(room.players);
        if (remainingPlayerIds.length === 0) {
          // Delete empty room
          this.rooms.delete(code);
          return { roomDeleted: true, code };
        } else {
          // Migrate host if needed
          if (room.hostId === socketId) {
            room.hostId = remainingPlayerIds[0];
          }
          return {
            roomDeleted: false,
            code,
            playerName,
            newHostId: room.hostId,
            room
          };
        }
      }
    }
    return null;
  }

  // Submit a guess
  submitGuess(code, socketId, rawWord) {
    const room = this.getRoom(code);
    if (!room) return { error: 'Místnost neexistuje.' };

    const player = room.players[socketId];
    if (!player) return { error: 'Nejsi v této místnosti.' };

    if (player.gaveUp) {
      return { error: 'Vzdal(a) ses a odhalil(a) slovo. Již nemůžeš hádat.' };
    }

    if (player.solved) {
      return { error: 'Gratulujeme, již jsi vítězné slovo uhodl(a)!' };
    }

    const rankResult = calculateRank(room.targetWordObj, rawWord);
    if (!rankResult.isValid) {
      return { error: rankResult.error || 'Neplatné slovo.' };
    }

    player.guessCount += 1;

    const isWinner = rankResult.isWinner || rankResult.rank === 1;

    if (isWinner) {
      player.solved = true;
      player.solvedAt = Date.now();
    }

    const guessEntry = {
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      player: player.name,
      socketId: socketId,
      word: rankResult.word,
      rank: rankResult.rank,
      isWinner: isWinner,
      timestamp: Date.now()
    };

    room.guesses.push(guessEntry);
    room.lastActivity = Date.now(); // obnoví TTL místnosti

    return {
      success: true,
      guess: guessEntry,
      player: player,
      isWinner: isWinner
    };
  }

  // Player surrenders and reveals the secret word
  revealWord(code, socketId) {
    const room = this.getRoom(code);
    if (!room) return { error: 'Místnost neexistuje.' };

    const player = room.players[socketId];
    if (!player) return { error: 'Nejsi v této místnosti.' };

    player.gaveUp = true;

    return {
      success: true,
      targetWord: room.targetWordObj.word,
      hint: room.targetWordObj.hint,
      player: player
    };
  }

  // Start next round with a new random word (host only)
  nextRound(code, socketId) {
    const room = this.getRoom(code);
    if (!room) return { error: 'Místnost neexistuje.' };
    if (room.hostId !== socketId) return { error: 'Pouze hostitel může zahájit další kolo.' };

    room.targetWordObj = getRandomWord();
    room.isDaily = false;
    room.guesses = [];

    // Reset players
    for (const pid of Object.keys(room.players)) {
      room.players[pid].solved = false;
      room.players[pid].gaveUp = false;
      room.players[pid].guessCount = 0;
      room.players[pid].solvedAt = null;
    }

    return { success: true, room };
  }

  // Format room state for a specific player (masking winning word if unrevealed)
  getRoomStateForPlayer(room, socketId) {
    const player = room.players[socketId];
    const canSeeSecret = player && (player.solved || player.gaveUp);

    // Sanitize guesses
    const sanitizedGuesses = room.guesses.map((g) => {
      if (g.rank === 1 && !canSeeSecret) {
        return {
          id: g.id,
          player: g.player,
          word: '??? (Uhodnuto)',
          rank: 1,
          isWinner: true,
          timestamp: g.timestamp
        };
      }
      return {
        id: g.id,
        player: g.player,
        word: g.word,
        rank: g.rank,
        isWinner: g.isWinner,
        timestamp: g.timestamp
      };
    });

    return {
      code: room.code,
      isDaily: room.isDaily,
      date: room.targetWordObj.date,
      hint: room.targetWordObj.hint,
      isHost: room.hostId === socketId,
      myStatus: player
        ? {
            name: player.name,
            solved: player.solved,
            gaveUp: player.gaveUp,
            guessCount: player.guessCount
          }
        : null,
      secretWord: canSeeSecret ? room.targetWordObj.word : null,
      players: Object.values(room.players).map((p) => ({
        id: p.id,
        name: p.name,
        solved: p.solved,
        gaveUp: p.gaveUp,
        guessCount: p.guessCount,
        isHost: p.id === room.hostId
      })),
      guesses: sanitizedGuesses
    };
  }
}

module.exports = new RoomManager();
