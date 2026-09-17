const wordService = require('./wordService');

class DailyGameManager {
  constructor() {
    this.activeDate = wordService.getCzechDateStr();
    this.targetWordObj = wordService.getDailyWord();
    this.players = {}; // socketId -> player object
    this.guesses = []; // array of guesses
    this.chatHistory = []; // array of last 50 chat messages
  }

  // Kontrola přechodu přes půlnoc (automatický posun na nové slovo)
  checkMidnightRoll() {
    const todayStr = wordService.getCzechDateStr();
    if (todayStr !== this.activeDate) {
      console.log(`[PŮLNOC] Půlnoční reset: ${this.activeDate} -> ${todayStr}`);
      this.activeDate = todayStr;
      this.targetWordObj = wordService.getDailyWord(todayStr);
      this.guesses = [];

      // Reset stavu všech připojených hráčů na nový den
      for (const pid of Object.keys(this.players)) {
        this.players[pid].solved = false;
        this.players[pid].gaveUp = false;
        this.players[pid].usedHint = false;
        this.players[pid].guessCount = 0;
        this.players[pid].solvedAt = null;
      }

      return {
        isNewDay: true,
        date: this.activeDate,
        dayNumber: this.targetWordObj.dayNumber
      };
    }
    return { isNewDay: false };
  }

  // Připojení hráče do společné denní hry
  joinPlayer(socketId, playerName) {
    this.checkMidnightRoll();

    const cleanName = (playerName || '').trim() || `Hráč_${Object.keys(this.players).length + 1}`;

    const player = {
      id: socketId,
      name: cleanName,
      solved: false,
      gaveUp: false,
      usedHint: false,
      guessCount: 0,
      solvedAt: null
    };

    this.players[socketId] = player;
    return player;
  }

  // Odpojení hráče
  removePlayer(socketId) {
    const player = this.players[socketId];
    if (player) {
      delete this.players[socketId];
      return player;
    }
    return null;
  }

  // Odeslání tipu od hráče
  submitGuess(socketId, rawWord) {
    this.checkMidnightRoll();

    const player = this.players[socketId];
    if (!player) return { error: 'Nejsi přihlášen(a) ve hře.' };

    if (player.gaveUp) {
      return { error: 'Vzdal(a) ses a odhalil(a) slovo. Již nemůžeš dnes hádat.' };
    }

    if (player.solved) {
      return { error: 'Gratulujeme, již jsi dnešní vítězné slovo uhodl(a)!' };
    }

    const rankResult = wordService.calculateRank(this.targetWordObj, rawWord);
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

    this.guesses.push(guessEntry);

    return {
      success: true,
      guess: guessEntry,
      player: player,
      isWinner: isWinner
    };
  }

  // Hráč se vzdá a odhalí slovo
  revealWord(socketId) {
    const player = this.players[socketId];
    if (!player) return { error: 'Nejsi přihlášen(a) ve hře.' };

    player.gaveUp = true;

    return {
      success: true,
      targetWord: this.targetWordObj.word,
      player: player
    };
  }

  // Hráč odhalí nápovědu (získá 🤡)
  useHint(socketId) {
    const player = this.players[socketId];
    if (!player) return { error: 'Nejsi přihlášen(a) ve hře.' };

    player.usedHint = true;

    return {
      success: true,
      hint: this.targetWordObj.hint,
      player: player
    };
  }

  // Uložení zprávy do chatu
  addChatMessage(player, message) {
    const time = new Date().toLocaleTimeString('cs-CZ', {
      timeZone: 'Europe/Prague',
      hour: '2-digit',
      minute: '2-digit'
    });

    const entry = {
      player,
      message: message.slice(0, 250),
      time
    };

    this.chatHistory.push(entry);
    if (this.chatHistory.length > 60) {
      this.chatHistory.shift();
    }

    return entry;
  }

  // Vygenerování stavu hry na míru pro daného hráče (skrytí #1 a nápovědy)
  getGameStateForPlayer(socketId) {
    const player = this.players[socketId];
    const canSeeSecret = player && (player.solved || player.gaveUp);

    // Sanitizace hádaných slov pro ty, kteří ještě nevyhráli / nevzdali se
    const sanitizedGuesses = this.guesses.map((g) => {
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
      date: this.activeDate,
      dayNumber: this.targetWordObj.dayNumber,
      hint: player && player.usedHint ? this.targetWordObj.hint : null,
      hasUsedHint: player ? !!player.usedHint : false,
      myStatus: player
        ? {
            name: player.name,
            solved: player.solved,
            gaveUp: player.gaveUp,
            usedHint: !!player.usedHint,
            guessCount: player.guessCount
          }
        : null,
      secretWord: canSeeSecret ? this.targetWordObj.word : null,
      players: Object.values(this.players).map((p) => ({
        id: p.id,
        name: p.name,
        solved: p.solved,
        gaveUp: p.gaveUp,
        usedHint: !!p.usedHint,
        guessCount: p.guessCount
      })),
      guesses: sanitizedGuesses,
      chatHistory: this.chatHistory
    };
  }
}

module.exports = new DailyGameManager();
