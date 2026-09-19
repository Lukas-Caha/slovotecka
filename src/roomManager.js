const fs = require('fs');
const path = require('path');
const wordService = require('./wordService');

const STATE_FILE_PATH = path.join(__dirname, 'data', 'savedState.json');

// Tajný token pro získání administrátorských práv v přezdívce (např. Lukas /admin-perms-456)
const ADMIN_SECRET = process.env.ADMIN_SECRET || '/admin-perms-456';

// 8 základních barev pro výběr přezdívky
const ALLOWED_COLORS = [
  '#ef4444', // Červená
  '#f97316', // Oranžová
  '#eab308', // Žlutá
  '#22c55e', // Zelená
  '#06b6d4', // Azurová
  '#3b82f6', // Modrá
  '#a855f7', // Fialová
  '#ec4899'  // Růžová
];
const DEFAULT_COLOR = '#3b82f6';

function sanitizeColor(color) {
  if (typeof color === 'string') {
    const trimmed = color.trim().toLowerCase();
    if (ALLOWED_COLORS.includes(trimmed)) return trimmed;
    if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed;
  }
  return DEFAULT_COLOR;
}

class BaseGameRoom {
  constructor(mode) {
    this.mode = mode;
    this.players = {}; // socketId -> player object
    this.playerProfiles = {}; // playerName.toLowerCase() -> { name, guessCount, solved, gaveUp, usedHint, solvedAt, isAdmin }
    this.guesses = []; // pole tipů
    this.chatHistory = []; // historie zpráv chatu
    this.currentMusic = null; // aktuálně přehrávaná YouTube hudba { videoId, title, requestedBy, startedAt }
    this.musicQueue = []; // fronta následujících skladeb [{ videoId, title, requestedBy }]
    this.musicSkipVotes = new Set(); // socketIds hráčů, kteří hlasovali pro přeskočení skladby
    this.lastTrackEndedAt = 0; // debounce pro konec skladby
    this.pendingSongConfirmations = {}; // socketId -> { confirmId, videoId, title, query, requestedBy, expiresAt }
    this.onStateChange = null;
  }

  // Výpočet potřebné většiny pro přeskočení hudby: Math.floor(počet / 2) + 1
  getRequiredSkipVotes() {
    const total = Object.keys(this.players).length;
    if (total <= 0) return 0;
    return Math.floor(total / 2) + 1;
  }

  // Správa přehrávané hudby a fronty (Queue)
  enqueueMusicTrack(track) {
    if (!this.currentMusic) {
      track.startedAt = Date.now();
      this.currentMusic = track;
      this.musicSkipVotes.clear();
      return {
        playingNow: true,
        track,
        queueLength: this.musicQueue.length
      };
    } else {
      this.musicQueue.push(track);
      return {
        playingNow: false,
        track,
        position: this.musicQueue.length,
        queueLength: this.musicQueue.length
      };
    }
  }

  playNextTrack() {
    this.musicSkipVotes.clear();
    if (this.musicQueue.length > 0) {
      const nextTrack = this.musicQueue.shift();
      nextTrack.startedAt = Date.now();
      this.currentMusic = nextTrack;
      return nextTrack;
    } else {
      this.currentMusic = null;
      return null;
    }
  }

  clearMusicTrack() {
    this.currentMusic = null;
    this.musicQueue = [];
    this.musicSkipVotes.clear();
  }

  // Hlasování o přeskočení hudby (skip vote)
  voteSkipMusic(socketId) {
    const player = this.players[socketId];
    if (!player) return { error: 'Nejsi přihlášen(a) ve hře.' };
    if (!this.currentMusic) return { error: 'Právě nehraje žádná hudba.' };

    let hasVoted = false;
    if (this.musicSkipVotes.has(socketId)) {
      this.musicSkipVotes.delete(socketId);
      hasVoted = false;
    } else {
      this.musicSkipVotes.add(socketId);
      hasVoted = true;
    }

    const requiredVotes = this.getRequiredSkipVotes();
    const votesCount = this.musicSkipVotes.size;

    // Pokud je splněna většina (> 50 % hráčů v aréně)
    if (votesCount >= requiredVotes && requiredVotes > 0) {
      const skippedTrack = this.currentMusic;
      const nextTrack = this.playNextTrack();
      return {
        success: true,
        skipped: true,
        skippedTrack,
        nextTrack,
        votesCount,
        requiredVotes,
        player
      };
    }

    return {
      success: true,
      skipped: false,
      hasVoted,
      votesCount,
      requiredVotes,
      player
    };
  }

  // Získání stavu hlasování o přeskočení a fronty pro daného hráče
  getSkipVoteStatus(socketId) {
    return {
      skipVotes: this.musicSkipVotes.size,
      requiredSkipVotes: this.getRequiredSkipVotes(),
      hasVotedSkip: socketId ? this.musicSkipVotes.has(socketId) : false,
      queue: this.musicQueue.map((t, idx) => ({
        position: idx + 1,
        videoId: t.videoId,
        title: t.title,
        requestedBy: t.requestedBy
      })),
      queueLength: this.musicQueue.length
    };
  }

  // Uložení profilu hráče pro možnost návratu pod stejným jménem
  savePlayerProfile(player) {
    if (!player || !player.name) return;
    this.playerProfiles[player.name.toLowerCase()] = {
      name: player.name,
      color: player.color || DEFAULT_COLOR,
      isAdmin: !!player.isAdmin,
      solved: !!player.solved,
      gaveUp: !!player.gaveUp,
      usedHint: !!player.usedHint,
      guessCount: player.guessCount || 0,
      solvedAt: player.solvedAt || null
    };
    if (typeof this.onStateChange === 'function') {
      this.onStateChange();
    }
  }

  // Připojení hráče do místnosti
  joinPlayer(socketId, playerName, playerColor = null) {
    let raw = (playerName || '').trim().slice(0, 40);
    let isAdmin = false;

    // Kontrola tajného administrátorského klíče v přezdívce (např. Lukas /admin-perms-456)
    if (raw.toLowerCase().includes(ADMIN_SECRET.toLowerCase())) {
      isAdmin = true;
      const regex = new RegExp(ADMIN_SECRET.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi');
      raw = raw.replace(regex, '').trim().slice(0, 40);
    }

    let cleanName = raw || (isAdmin ? 'Admin' : `Hráč_${Object.keys(this.players).length + 1}`);
    cleanName = cleanName.slice(0, 40);

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

    // Obnovení předchozího stavu hráče se stejným jménem (pokud už v této hře/dnu hádal)
    const existingProfile = this.playerProfiles[cleanName.toLowerCase()];
    const chosenColor = sanitizeColor(playerColor || (existingProfile ? existingProfile.color : null));

    const player = {
      id: socketId,
      name: existingProfile ? existingProfile.name : cleanName,
      color: chosenColor,
      isAdmin: existingProfile && existingProfile.isAdmin !== undefined ? (existingProfile.isAdmin || !!isAdmin) : !!isAdmin,
      solved: existingProfile ? !!existingProfile.solved : false,
      gaveUp: existingProfile ? !!existingProfile.gaveUp : false,
      usedHint: existingProfile ? !!existingProfile.usedHint : false,
      guessCount: existingProfile ? existingProfile.guessCount : 0,
      solvedAt: existingProfile ? existingProfile.solvedAt : null,
      votedForNewWord: false
    };

    // Pokud se hráč vrací pod stejným jménem, aktualizujeme socketId v minulých tipech
    const normName = player.name.toLowerCase();
    for (const g of this.guesses) {
      if (g.player && g.player.toLowerCase() === normName) {
        g.socketId = socketId;
      }
    }

    this.players[socketId] = player;
    this.savePlayerProfile(player);
    return player;
  }

  // Odebrání hráče z místnosti
  removePlayer(socketId) {
    this.musicSkipVotes.delete(socketId);
    delete this.pendingSongConfirmations[socketId];
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
      playerColor: player.color || DEFAULT_COLOR,
      socketId: socketId,
      word: rankResult.word,
      rank: rankResult.rank,
      isWinner: isWinner,
      timestamp: Date.now()
    };

    this.guesses.push(guessEntry);
    this.savePlayerProfile(player);
    if (typeof this.onStateChange === 'function') {
      this.onStateChange();
    }

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
    this.savePlayerProfile(player);
    if (typeof this.onStateChange === 'function') {
      this.onStateChange();
    }

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
    this.savePlayerProfile(player);
    if (typeof this.onStateChange === 'function') {
      this.onStateChange();
    }

    return {
      success: true,
      hint: this.targetWordObj.hint,
      player: player
    };
  }

  // Uložení zprávy do chatu
  addChatMessage(player, message, isAdmin = false, confirmAction = null, color = null) {
    const time = new Date().toLocaleTimeString('cs-CZ', {
      timeZone: 'Europe/Prague',
      hour: '2-digit',
      minute: '2-digit'
    });

    let playerColor = color;
    if (!playerColor && player) {
      const norm = player.toLowerCase();
      const p = Object.values(this.players).find(x => x.name && x.name.toLowerCase() === norm);
      if (p && p.color) {
        playerColor = p.color;
      } else if (this.playerProfiles[norm] && this.playerProfiles[norm].color) {
        playerColor = this.playerProfiles[norm].color;
      }
    }

    const entry = {
      player,
      playerColor: playerColor || null,
      isAdmin: !!isAdmin,
      message: message.slice(0, 500),
      time
    };

    if (confirmAction) {
      entry.confirmAction = confirmAction;
    }

    this.chatHistory.push(entry);
    if (this.chatHistory.length > 60) {
      this.chatHistory.shift();
    }

    if (typeof this.onStateChange === 'function') {
      this.onStateChange();
    }

    return entry;
  }

  clearChat() {
    this.chatHistory = [];
  }

  // Sanitizace tipů:
  // - Aktivní hráč vidí pouze svoje tipy a společné tipy (které sám také trefil)
  // - Divák (ten, kdo uhodl nebo se vzdal) vidí naživo všechny tipy všech hráčů
  getSanitizedGuesses(forSocketId, canSeeSecret) {
    const player = this.players[forSocketId];
    const playerName = player ? player.name.toLowerCase() : null;
    const isSpectator = !!canSeeSecret;

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

      // Hráč vidí svoje tipy, společné tipy, nebo jako divák vidí úplně všechny tipy v aréně
      if (isSpectator || isMine || isShared || (g.rank === 1 && canSeeSecret)) {
        visibleGuesses.push({
          id: g.id,
          player: g.player,
          playerColor: g.playerColor || DEFAULT_COLOR,
          word: g.word,
          rank: g.rank,
          isWinner: g.isWinner,
          timestamp: g.timestamp,
          isMine: isMine,
          isShared: !isMine && isShared,
          isOther: !isMine && !isShared
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
      this.playerProfiles = {};
      this.chatHistory = [];

      for (const pid of Object.keys(this.players)) {
        this.players[pid].solved = false;
        this.players[pid].gaveUp = false;
        this.players[pid].usedHint = false;
        this.players[pid].guessCount = 0;
        this.players[pid].solvedAt = null;
        this.players[pid].votedForNewWord = false;
        this.savePlayerProfile(this.players[pid]);
      }

      if (typeof this.onMidnightReset === 'function') {
        this.onMidnightReset();
      }

      return {
        isNewDay: true,
        date: this.activeDate,
        dayNumber: this.targetWordObj.dayNumber
      };
    }
    return { isNewDay: false };
  }

  joinPlayer(socketId, playerName, playerColor = null) {
    this.checkMidnightRoll();
    return super.joinPlayer(socketId, playerName, playerColor);
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
      isSpectator: !!canSeeSecret,
      hint: player && player.usedHint ? this.targetWordObj.hint : null,
      hasUsedHint: player ? !!player.usedHint : false,
      myStatus: player
        ? {
            name: player.name,
            color: player.color || DEFAULT_COLOR,
            isAdmin: !!player.isAdmin,
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
        color: p.color || DEFAULT_COLOR,
        isAdmin: !!p.isAdmin,
        solved: p.solved,
        gaveUp: p.gaveUp,
        usedHint: !!p.usedHint,
        guessCount: p.guessCount,
        votedForNewWord: false
      })),
      guesses: this.getSanitizedGuesses(socketId, canSeeSecret),
      chatHistory: this.chatHistory,
      voting: null,
      currentMusic: this.currentMusic ? {
        ...this.currentMusic,
        ...this.getSkipVoteStatus(socketId),
        serverTime: Date.now()
      } : null
    };
  }
}

// ─────────────────────────────────────────────────────────────
// Unlimited mód (fond archivních slov, hlasování o nové slovo)
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
    this.playerProfiles = {};
    this.votes.clear();

    for (const pid of Object.keys(this.players)) {
      this.players[pid].solved = false;
      this.players[pid].gaveUp = false;
      this.players[pid].usedHint = false;
      this.players[pid].guessCount = 0;
      this.players[pid].solvedAt = null;
      this.players[pid].votedForNewWord = false;
      this.savePlayerProfile(this.players[pid]);
    }

    if (typeof this.onStateChange === 'function') {
      this.onStateChange();
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
      date: `Archivní slovo (z předchozích dnů)`,
      dayNumber: this.targetWordObj.dayNumber,
      isSpectator: !!canSeeSecret,
      hint: player && player.usedHint ? this.targetWordObj.hint : null,
      hasUsedHint: player ? !!player.usedHint : false,
      myStatus: player
        ? {
            name: player.name,
            color: player.color || DEFAULT_COLOR,
            isAdmin: !!player.isAdmin,
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
        color: p.color || DEFAULT_COLOR,
        isAdmin: !!p.isAdmin,
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
      },
      currentMusic: this.currentMusic ? {
        ...this.currentMusic,
        ...this.getSkipVoteStatus(socketId),
        serverTime: Date.now()
      } : null
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
    this.saveTimeout = null;

    // Propojení callbacků pro automatické ukládání
    const onSave = () => this.scheduleSave();
    this.rooms.daily.onStateChange = onSave;
    this.rooms.unlimited.onStateChange = onSave;

    // Půlnoční reset denní hry smaže uložený stav pro úsporu místa na disku
    this.rooms.daily.onMidnightReset = () => {
      this.clearSavedStateFile();
    };
  }

  // Naplánování asynchronního uložení (debounce 1s)
  scheduleSave() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      this.saveStateToFile(false);
    }, 1000);
  }

  // Uložení stavu na disk (synchronně při vypnutí serveru, asynchronně za běhu)
  saveStateToFile(sync = false) {
    try {
      const data = {
        savedAt: Date.now(),
        daily: {
          date: this.rooms.daily.activeDate,
          dayNumber: this.rooms.daily.targetWordObj ? this.rooms.daily.targetWordObj.dayNumber : null,
          targetWord: this.rooms.daily.targetWordObj ? this.rooms.daily.targetWordObj.word : null,
          guesses: this.rooms.daily.guesses,
          playerProfiles: this.rooms.daily.playerProfiles,
          chatHistory: this.rooms.daily.chatHistory,
          currentMusic: this.rooms.daily.currentMusic,
          musicQueue: this.rooms.daily.musicQueue
        },
        unlimited: {
          targetWord: this.rooms.unlimited.targetWordObj ? this.rooms.unlimited.targetWordObj.word : null,
          dayNumber: this.rooms.unlimited.targetWordObj ? this.rooms.unlimited.targetWordObj.dayNumber : null,
          recentWords: this.rooms.unlimited.recentWords,
          guesses: this.rooms.unlimited.guesses,
          playerProfiles: this.rooms.unlimited.playerProfiles,
          chatHistory: this.rooms.unlimited.chatHistory,
          currentMusic: this.rooms.unlimited.currentMusic,
          musicQueue: this.rooms.unlimited.musicQueue
        }
      };

      const jsonStr = JSON.stringify(data, null, 2);
      const dataDir = path.dirname(STATE_FILE_PATH);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      if (sync) {
        fs.writeFileSync(STATE_FILE_PATH, jsonStr, 'utf-8');
      } else {
        const tmpPath = `${STATE_FILE_PATH}.tmp`;
        fs.writeFile(tmpPath, jsonStr, 'utf-8', (err) => {
          if (!err) {
            fs.rename(tmpPath, STATE_FILE_PATH, () => {});
          }
        });
      }
    } catch (err) {
      console.error('[STATE] Chyba při ukládání stavu hry:', err);
    }
  }

  // Načtení uloženého stavu při startu serveru
  loadStateFromFile() {
    try {
      if (!fs.existsSync(STATE_FILE_PATH)) {
        console.log('[STATE] Žádný předchozí stav k obnovení.');
        return false;
      }

      const raw = fs.readFileSync(STATE_FILE_PATH, 'utf-8');
      if (!raw || !raw.trim()) return false;
      const data = JSON.parse(raw);

      const todayStr = wordService.getCzechDateStr();

      // Obnovení denní hry
      if (data.daily) {
        if (data.daily.date === todayStr) {
          this.rooms.daily.activeDate = data.daily.date;
          if (data.daily.targetWord) {
            this.rooms.daily.targetWordObj = wordService.getDailyWord(todayStr);
          }
          if (Array.isArray(data.daily.guesses)) {
            this.rooms.daily.guesses = data.daily.guesses;
          }
          if (data.daily.playerProfiles && typeof data.daily.playerProfiles === 'object') {
            this.rooms.daily.playerProfiles = data.daily.playerProfiles;
          }
          if (Array.isArray(data.daily.chatHistory)) {
            this.rooms.daily.chatHistory = data.daily.chatHistory;
          }
          if (data.daily.currentMusic) {
            this.rooms.daily.currentMusic = data.daily.currentMusic;
          }
          if (Array.isArray(data.daily.musicQueue)) {
            this.rooms.daily.musicQueue = data.daily.musicQueue;
          }
          console.log(`[STATE] Úspěšně obnoven denní stav (${todayStr}): ${this.rooms.daily.guesses.length} tipů, ${Object.keys(this.rooms.daily.playerProfiles).length} hráčů.`);
        } else {
          console.log(`[STATE] Uložený stav je ze dne ${data.daily.date} (dnes je ${todayStr}). Promazávám stará data pro uvolnění místa.`);
          this.clearSavedStateFile();
        }
      }

      // Obnovení unlimited módu
      if (data.unlimited) {
        if (data.unlimited.targetWord) {
          const restoredWordObj = wordService.getSpecificWord(data.unlimited.dayNumber, data.unlimited.targetWord);
          if (restoredWordObj) {
            this.rooms.unlimited.targetWordObj = restoredWordObj;
          }
        }
        if (Array.isArray(data.unlimited.recentWords)) {
          this.rooms.unlimited.recentWords = data.unlimited.recentWords;
        }
        if (Array.isArray(data.unlimited.guesses)) {
          this.rooms.unlimited.guesses = data.unlimited.guesses;
        }
        if (data.unlimited.playerProfiles && typeof data.unlimited.playerProfiles === 'object') {
          this.rooms.unlimited.playerProfiles = data.unlimited.playerProfiles;
        }
        if (Array.isArray(data.unlimited.chatHistory)) {
          this.rooms.unlimited.chatHistory = data.unlimited.chatHistory;
        }
        if (data.unlimited.currentMusic) {
          this.rooms.unlimited.currentMusic = data.unlimited.currentMusic;
        }
        if (Array.isArray(data.unlimited.musicQueue)) {
          this.rooms.unlimited.musicQueue = data.unlimited.musicQueue;
        }
      }

      return true;
    } catch (err) {
      console.error('[STATE] Chyba při načítání stavu ze souboru:', err);
      return false;
    }
  }

  // Smazání souboru se stavem (o půlnoci nebo při expiraci)
  clearSavedStateFile() {
    try {
      if (fs.existsSync(STATE_FILE_PATH)) {
        fs.unlinkSync(STATE_FILE_PATH);
        console.log('[STATE] Uložený soubor se stavem byl smazán pro uvolnění místa na disku.');
      }
    } catch (err) {
      console.warn('[STATE] Nepodařilo se smazat uložený stav:', err);
    }
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

  getOnlineCounts() {
    const dailyCount = Object.keys(this.rooms.daily.players).length;
    const unlimitedCount = Object.keys(this.rooms.unlimited.players).length;
    return {
      daily: dailyCount,
      unlimited: unlimitedCount,
      total: dailyCount + unlimitedCount
    };
  }

  joinPlayer(socketId, playerName, mode = 'daily', color = null) {
    const validMode = mode === 'unlimited' ? 'unlimited' : 'daily';

    // Pokud byl hráč v jiné místnosti, odebereme ho
    const previousMode = this.socketToRoom.get(socketId);
    if (previousMode && previousMode !== validMode) {
      this.rooms[previousMode].removePlayer(socketId);
    }

    const room = this.rooms[validMode];
    const player = room.joinPlayer(socketId, playerName, color);
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
