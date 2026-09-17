const wordService = require('./wordService');

// Základní společná třída pro herní místnost
class BaseGameRoom {
  constructor(mode) {
    this.mode = mode;
    this.players = {}; // socketId -> player object
    this.guesses = []; // pole tipů
    this.chatHistory = []; // historie zpráv chatu
  }

  // Připojení hráče do místnosti
  joinPlayer(socketId, playerName) {
    let cleanName = (playerName || '').trim() || `Hráč_${Object.keys(this.players).length + 1}`;

    const existingNames = Object.values(this.players)
      .filter((p) => p.id !== socketId)
      .map((p) => p.name.toLowerCase());

    if (existingNames.includes(cleanName.toLowerCase())) {
      let counter = 2;
      while (existingNames.includes(`${cleanName} (${counter})`.toLowerCase())) {
        counter++;
      }
      cleanName = `${cleanName} (${counter})`;
    }

    const player = {
      id: socketId,
      name: cleanName,
      solved: false,
      gaveUp: false,
      usedHint: false,
      guessCount: 0,
      solvedAt: null,
      votedForNewWord: false
    };

    this.players[socketId] = player;
    return player;
  }

  // Odebrání hráče z místnosti
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
    const player = this.players[socketId];
    if (!player) return { error: 'Nejsi přihlášen(a) ve hře.' };

    if (player.gaveUp) {
      return { error: 'Vzdal(a) ses a odhalil(a) slovo. Již nemůžeš v tomto kole hádat.' };
    }

    if (player.solved) {
      return { error: 'Gratulujeme, již jsi vítězné slovo tohoto kola uhodl(a)!' };
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

  // Sanitizace tipů:
  // - Každý vidí pouze svoje tipy a společné tipy
  // - Žádné otazníky ani jak blízko jsou ostatní
  // - Ostatní neodhadnuté tipy se pro hráče vůbec neposílají
  getSanitizedGuesses(forSocketId, canSeeSecret) {
    const player = this.players[forSocketId];
    const playerName = player ? player.name.toLowerCase() : null;

    // Seznam slov a ranků, které tento hráč již sám uhodl/zadal
    const myGuessedWords = new Set();
    const myGuessedRanks = new Set();
    for (const g of this.guesses) {
      const isMyGuess = g.socketId === forSocketId || (playerName && g.player.toLowerCase() === playerName);
      if (isMyGuess) {
        if (g.word) myGuessedWords.add(g.word.toLowerCase());
        if (g.rank) myGuessedRanks.add(g.rank);
      }
    }

    const visibleGuesses = [];
    for (const g of this.guesses) {
      const isMine = g.socketId === forSocketId || (playerName && g.player.toLowerCase() === playerName);
      const isShared = (g.word && myGuessedWords.has(g.word.toLowerCase())) || (g.rank && myGuessedRanks.has(g.rank));

      // Hráč vidí pouze svoje tipy nebo společné (které sám také trefil)
      if (isMine || isShared || (g.rank === 1 && canSeeSecret)) {
        visibleGuesses.push({
          id: g.id,
          player: g.player,
          word: g.word,
          rank: g.rank,
          isWinner: g.isWinner,
          timestamp: g.timestamp,
          isMine: isMine,
          isShared: !isMine && isShared
        });
      }
    }

    return visibleGuesses;
  }
}

// ─────────────────────────────────────────────────────────────
// Denní společná hra (půlnoční reset, pevné slovo dle kalendáře)
// ─────────────────────────────────────────────────────────────
class DailyGameRoom extends BaseGameRoom {
  constructor() {
    super('daily');
    this.activeDate = wordService.getCzechDateStr();
    this.targetWordObj = wordService.getDailyWord();
  }

  checkMidnightRoll() {
    const todayStr = wordService.getCzechDateStr();
    if (todayStr !== this.activeDate) {
      console.log(`[PŮLNOC] Půlnoční reset denní hry: ${this.activeDate} -> ${todayStr}`);
      this.activeDate = todayStr;
      this.targetWordObj = wordService.getDailyWord(todayStr);
      this.guesses = [];

      for (const pid of Object.keys(this.players)) {
        this.players[pid].solved = false;
        this.players[pid].gaveUp = false;
        this.players[pid].usedHint = false;
        this.players[pid].guessCount = 0;
        this.players[pid].solvedAt = null;
        this.players[pid].votedForNewWord = false;
      }

      return {
        isNewDay: true,
        date: this.activeDate,
        dayNumber: this.targetWordObj.dayNumber
      };
    }
    return { isNewDay: false };
  }

  joinPlayer(socketId, playerName) {
    this.checkMidnightRoll();
    return super.joinPlayer(socketId, playerName);
  }

  submitGuess(socketId, rawWord) {
    this.checkMidnightRoll();
    return super.submitGuess(socketId, rawWord);
  }

  getGameStateForPlayer(socketId) {
    const player = this.players[socketId];
    const canSeeSecret = player && (player.solved || player.gaveUp);

    return {
      mode: 'daily',
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
        guessCount: p.guessCount,
        votedForNewWord: false
      })),
      guesses: this.getSanitizedGuesses(socketId, canSeeSecret),
      chatHistory: this.chatHistory,
      voting: null
    };
  }
}

// ─────────────────────────────────────────────────────────────
// Unlimited mód (fond archivních slov 1–16, hlasování o nové slovo)
// ─────────────────────────────────────────────────────────────
class UnlimitedGameRoom extends BaseGameRoom {
  constructor() {
    super('unlimited');
    this.recentWords = [];
    this.targetWordObj = wordService.getUnlimitedWord(this.recentWords);
    this.recentWords.push(this.targetWordObj.word);
    this.votes = new Set(); // socketIds hráčů, kteří hlasovali pro nové slovo
  }

  // Výpočet potřebné nadpoloviční většiny: Math.floor(počet / 2) + 1
  // 1 hráč -> 1 hlas, 2 hráči -> 2 hlasy, 3 hráči -> 2 hlasy (přesně dle zadání)
  getRequiredVotes() {
    const totalPlayers = Object.keys(this.players).length;
    if (totalPlayers <= 0) return 0;
    return Math.floor(totalPlayers / 2) + 1;
  }

  // Získání nového slova z archivu a reset kola
  resetWithNewWord() {
    const oldWord = this.targetWordObj.word;
    const pastPool = wordService.getPastWordsPool();

    if (this.recentWords.length >= pastPool.length) {
      this.recentWords = [];
    }

    this.targetWordObj = wordService.getUnlimitedWord(this.recentWords);
    this.recentWords.push(this.targetWordObj.word);

    this.guesses = [];
    this.votes.clear();

    for (const pid of Object.keys(this.players)) {
      this.players[pid].solved = false;
      this.players[pid].gaveUp = false;
      this.players[pid].usedHint = false;
      this.players[pid].guessCount = 0;
      this.players[pid].solvedAt = null;
      this.players[pid].votedForNewWord = false;
    }

    return {
      oldWord,
      newWord: this.targetWordObj.word,
      dayNumber: this.targetWordObj.dayNumber
    };
  }

  // Hlasování o nové slovo (toggle)
  voteNewWord(socketId) {
    const player = this.players[socketId];
    if (!player) return { error: 'Nejsi přihlášen(a) ve hře.' };

    let hasVoted = false;
    if (this.votes.has(socketId)) {
      this.votes.delete(socketId);
      player.votedForNewWord = false;
      hasVoted = false;
    } else {
      this.votes.add(socketId);
      player.votedForNewWord = true;
      hasVoted = true;
    }

    const requiredVotes = this.getRequiredVotes();
    const votesCount = this.votes.size;

    // Pokud je splněna většina (např. 2 ze 3)
    if (votesCount >= requiredVotes && requiredVotes > 0) {
      const resetInfo = this.resetWithNewWord();
      return {
        success: true,
        toggled: true,
        hasVoted: false,
        votesCount: 0,
        requiredVotes: this.getRequiredVotes(),
        newWordTriggered: true,
        oldWord: resetInfo.oldWord,
        newWord: resetInfo.newWord,
        dayNumber: resetInfo.dayNumber,
        player
      };
    }

    return {
      success: true,
      toggled: true,
      hasVoted,
      votesCount,
      requiredVotes,
      newWordTriggered: false,
      player
    };
  }

  removePlayer(socketId) {
    this.votes.delete(socketId);
    const player = super.removePlayer(socketId);

    // Pokud po odpojení zbylé hlasy splňují novou většinu
    const requiredVotes = this.getRequiredVotes();
    const votesCount = this.votes.size;

    let resetInfo = null;
    if (requiredVotes > 0 && votesCount >= requiredVotes) {
      resetInfo = this.resetWithNewWord();
    }

    return {
      player,
      newWordTriggered: !!resetInfo,
      oldWord: resetInfo ? resetInfo.oldWord : null,
      newWord: resetInfo ? resetInfo.newWord : null,
      dayNumber: resetInfo ? resetInfo.dayNumber : null
    };
  }

  getGameStateForPlayer(socketId) {
    const player = this.players[socketId];
    const canSeeSecret = player && (player.solved || player.gaveUp);
    const requiredVotes = this.getRequiredVotes();

    return {
      mode: 'unlimited',
      date: `Archivní slovo (z předchozích dnů 1–16)`,
      dayNumber: this.targetWordObj.dayNumber,
      hint: player && player.usedHint ? this.targetWordObj.hint : null,
      hasUsedHint: player ? !!player.usedHint : false,
      myStatus: player
        ? {
            name: player.name,
            solved: player.solved,
            gaveUp: player.gaveUp,
            usedHint: !!player.usedHint,
            guessCount: player.guessCount,
            votedForNewWord: this.votes.has(socketId)
          }
        : null,
      secretWord: canSeeSecret ? this.targetWordObj.word : null,
      players: Object.values(this.players).map((p) => ({
        id: p.id,
        name: p.name,
        solved: p.solved,
        gaveUp: p.gaveUp,
        usedHint: !!p.usedHint,
        guessCount: p.guessCount,
        votedForNewWord: this.votes.has(p.id)
      })),
      guesses: this.getSanitizedGuesses(socketId, canSeeSecret),
      chatHistory: this.chatHistory,
      voting: {
        votesCount: this.votes.size,
        requiredVotes: requiredVotes,
        hasVoted: this.votes.has(socketId),
        totalPlayers: Object.keys(this.players).length
      }
    };
  }
}

// ─────────────────────────────────────────────────────────────
// Správce místností (GameManager)
// ─────────────────────────────────────────────────────────────
class RoomManager {
  constructor() {
    this.rooms = {
      daily: new DailyGameRoom(),
      unlimited: new UnlimitedGameRoom()
    };
    this.socketToRoom = new Map(); // socketId -> 'daily' | 'unlimited'
  }

  getRoom(mode) {
    return mode === 'unlimited' ? this.rooms.unlimited : this.rooms.daily;
  }

  getRoomForSocket(socketId) {
    const mode = this.socketToRoom.get(socketId) || 'daily';
    return this.rooms[mode];
  }

  getModeForSocket(socketId) {
    return this.socketToRoom.get(socketId) || 'daily';
  }

  joinPlayer(socketId, playerName, mode = 'daily') {
    const validMode = mode === 'unlimited' ? 'unlimited' : 'daily';

    // Pokud byl hráč v jiné místnosti, odebereme ho
    const previousMode = this.socketToRoom.get(socketId);
    if (previousMode && previousMode !== validMode) {
      this.rooms[previousMode].removePlayer(socketId);
    }

    const room = this.rooms[validMode];
    const player = room.joinPlayer(socketId, playerName);
    this.socketToRoom.set(socketId, validMode);

    return { player, room, mode: validMode };
  }

  removePlayer(socketId) {
    const mode = this.socketToRoom.get(socketId);
    if (!mode) return null;

    this.socketToRoom.delete(socketId);
    const room = this.rooms[mode];
    const removeResult = room.removePlayer(socketId);

    const player = removeResult && removeResult.player ? removeResult.player : removeResult;
    return {
      player,
      mode,
      room,
      newWordTriggered: removeResult && removeResult.newWordTriggered,
      oldWord: removeResult && removeResult.oldWord,
      newWord: removeResult && removeResult.newWord,
      dayNumber: removeResult && removeResult.dayNumber
    };
  }

  checkMidnightRoll() {
    return this.rooms.daily.checkMidnightRoll();
  }
}

module.exports = new RoomManager();
