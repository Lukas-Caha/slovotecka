const fs = require('fs');
const path = require('path');
const wordService = require('./wordService');

const STATE_FILE_PATH = path.join(__dirname, 'data', 'savedState.json');

// Tajný token pro získání administrátorských práv v přezdívce (např. Lukas /admin-perms-456)
const ADMIN_SECRET = process.env.ADMIN_SECRET || '/admin-perms-456';
if (process.env.NODE_ENV === 'production' && ADMIN_SECRET === '/admin-perms-456') {
  console.warn('\x1b[33m%s\x1b[0m', '⚠️  [BEZPEČNOSTNÍ VAROVÁNÍ] V produkčním režimu používáte výchozí ADMIN_SECRET! Nastavte bezpečnou proměnnou prostředí ADMIN_SECRET.');
}

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
    this.currentPoll = null; // { id, question, options: [{ text, voters }], createdBy, createdAt, expiresAt, active }
    this.lastPollCreatedAt = 0;
    this.onStateChange = null;
    this.currentRoundId = Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 6);
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

  // Připojení hráče do místnosti (s podporou rychlého reconnectu a zamezení řetězení (2))
  joinPlayer(socketId, playerName, playerColor = null, sessionId = null, clientIp = null) {
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

    // Očistit případné dříve zřetězené suffixy jako " (2)", " (2) (2)"
    const baseCleanName = cleanName.replace(/(\s*\(\d+\))+$/, '').trim() || cleanName;

    // 1. Zjistíme, zda v této místnosti již neexistuje stejný hráč
    // (např. při rychlém obnovení stránky F5, kdy se starý socket ještě nestihl odpojit)
    let existingPlayer = null;
    let oldSocketId = null;

    for (const [sId, p] of Object.entries(this.players)) {
      if (sId === socketId) continue;

      const sameSession = Boolean(sessionId && p.sessionId && p.sessionId === sessionId);
      const pBaseName = p.name ? p.name.replace(/(\s*\(\d+\))+$/, '').trim().toLowerCase() : '';
      const targetBaseName = baseCleanName.toLowerCase();
      const sameName = Boolean(pBaseName && pBaseName === targetBaseName);
      const sameNameAndSession = Boolean(sameName && sessionId && p.sessionId && p.sessionId === sessionId);
      const sameNameAndIp = Boolean(
        sameName &&
        (!sessionId || !p.sessionId) &&
        clientIp &&
        p.clientIp &&
        p.clientIp === clientIp
      );

      if (sameSession || sameNameAndSession || sameNameAndIp) {
        existingPlayer = p;
        oldSocketId = sId;
        break;
      }
    }

    if (existingPlayer) {
      // Jde o rychlý reconnect stejného hráče
      if (this.gameManager && oldSocketId) {
        this.gameManager.markSocketReplaced(oldSocketId);
        this.gameManager.socketToRoom.delete(oldSocketId);
        this.gameManager.socketToRoom.set(socketId, this.mode);
      }
      if (oldSocketId) {
        delete this.players[oldSocketId];
      }

      existingPlayer.id = socketId;
      if (sessionId) existingPlayer.sessionId = sessionId;
      if (clientIp) existingPlayer.clientIp = clientIp;
      if (isAdmin) existingPlayer.isAdmin = true;
      if (playerColor) existingPlayer.color = sanitizeColor(playerColor);
      existingPlayer.name = baseCleanName;

      // Přenesení hlasů a čekajících potvrzení
      if (this.musicSkipVotes && oldSocketId && this.musicSkipVotes.has(oldSocketId)) {
        this.musicSkipVotes.delete(oldSocketId);
        this.musicSkipVotes.add(socketId);
      }
      if (this.pendingSongConfirmations && oldSocketId && this.pendingSongConfirmations[oldSocketId]) {
        this.pendingSongConfirmations[socketId] = this.pendingSongConfirmations[oldSocketId];
        delete this.pendingSongConfirmations[oldSocketId];
      }

      // Aktualizujeme socketId a jméno v předchozích tipech v této místnosti
      const normBaseName = baseCleanName.toLowerCase();
      for (const g of this.guesses) {
        if (g.socketId === oldSocketId || (g.player && g.player.replace(/(\s*\(\d+\))+$/, '').trim().toLowerCase() === normBaseName)) {
          g.socketId = socketId;
          g.player = existingPlayer.name;
          g.playerColor = existingPlayer.color;
        }
      }

      this.players[socketId] = existingPlayer;
      this.savePlayerProfile(existingPlayer);

      return {
        player: existingPlayer,
        isReconnect: true,
        oldSocketId
      };
    }

    // 2. Nový hráč v místnosti
    let finalName = baseCleanName;
    const existingNames = Object.values(this.players)
      .filter((p) => p.id !== socketId)
      .map((p) => p.name.toLowerCase());

    if (existingNames.includes(finalName.toLowerCase())) {
      let counter = 2;
      while (existingNames.includes(`${baseCleanName} (${counter})`.toLowerCase())) {
        counter++;
      }
      finalName = `${baseCleanName} (${counter})`;
    }

    // Obnovení předchozího profilu hráče (upřednostníme profil s více tipy nebo čisté jméno)
    let existingProfile = this.playerProfiles[finalName.toLowerCase()];
    const cleanProfile = this.playerProfiles[baseCleanName.toLowerCase()];
    if (!existingProfile || (cleanProfile && (cleanProfile.guessCount || 0) > (existingProfile.guessCount || 0))) {
      existingProfile = cleanProfile || existingProfile;
    }
    const chosenColor = sanitizeColor(playerColor || (existingProfile ? existingProfile.color : null));

    const player = {
      id: socketId,
      sessionId: sessionId || null,
      clientIp: clientIp || null,
      name: finalName,
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
    const normBaseName = baseCleanName.toLowerCase();
    for (const g of this.guesses) {
      if (g.player && g.player.replace(/(\s*\(\d+\))+$/, '').trim().toLowerCase() === normBaseName) {
        g.socketId = socketId;
        g.player = player.name;
        g.playerColor = player.color;
      }
    }

    this.players[socketId] = player;
    this.savePlayerProfile(player);
    return {
      player,
      isReconnect: false,
      oldSocketId: null
    };
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

  // ── ANKETY V CHATU (!poll) ──────────────────────────────────
  createPoll(question, options, createdBy, isAdmin = false) {
    if (!isAdmin) {
      return { error: 'Anketu v chatu může vyhlásit pouze administrátor.' };
    }
    const now = Date.now();
    if (this.currentPoll && this.currentPoll.active && now < this.currentPoll.expiresAt) {
      if (!isAdmin) {
        return { error: 'V aréně právě probíhá jiná anketa. Počkej, až skončí.' };
      }
    }

    const cleanQuestion = (question || '').trim().slice(0, 120);
    if (!cleanQuestion) {
      return { error: 'Zadej otázku ankety. Např.: !poll Dáme těžké slovo? | Ano | Ne' };
    }

    const cleanOptions = (options || [])
      .map(o => (o || '').trim().slice(0, 50))
      .filter(o => o.length > 0);

    if (cleanOptions.length < 2) {
      return { error: 'Anketa musí mít alespoň 2 možnosti oddělené svislicí |.' };
    }
    if (cleanOptions.length > 5) {
      return { error: 'Anketa může mít maximálně 5 možností.' };
    }

    this.lastPollCreatedAt = now;
    this.currentPoll = {
      id: 'poll-' + now + '-' + Math.random().toString(36).substr(2, 4),
      question: cleanQuestion,
      options: cleanOptions.map(text => ({ text, voters: new Set() })),
      createdBy: createdBy || 'Neznámý',
      createdAt: now,
      expiresAt: now + 60000,
      active: true
    };

    return {
      success: true,
      poll: this.getPollPublicState()
    };
  }

  votePoll(socketId, optionIndex) {
    if (!this.currentPoll || !this.currentPoll.active) {
      return { error: 'Právě neprobíhá žádná aktivní anketa.' };
    }
    if (Date.now() > this.currentPoll.expiresAt) {
      this.currentPoll.active = false;
      return { error: 'Tato anketa již skončila.' };
    }
    const idx = parseInt(optionIndex, 10);
    if (isNaN(idx) || idx < 0 || idx >= this.currentPoll.options.length) {
      return { error: 'Neplatná možnost ankety.' };
    }

    // Odstranění předchozího hlasu tohoto hráče ze všech možností
    for (const opt of this.currentPoll.options) {
      opt.voters.delete(socketId);
    }

    // Započtení nového hlasu
    this.currentPoll.options[idx].voters.add(socketId);

    return {
      success: true,
      poll: this.getPollPublicState(socketId),
      optionIndex: idx
    };
  }

  endPoll() {
    if (!this.currentPoll) return null;
    this.currentPoll.active = false;
    const finalState = this.getPollPublicState();

    let winner = null;
    let maxVotes = -1;
    let isTie = false;
    for (const opt of finalState.options) {
      if (opt.votesCount > maxVotes) {
        maxVotes = opt.votesCount;
        winner = opt;
        isTie = false;
      } else if (opt.votesCount === maxVotes && maxVotes > 0) {
        isTie = true;
      }
    }

    return {
      ...finalState,
      winner: isTie ? null : (winner && maxVotes > 0 ? winner.text : null),
      isTie: isTie && maxVotes > 0
    };
  }

  getPollPublicState(forSocketId = null) {
    if (!this.currentPoll) return null;
    const totalVotes = this.currentPoll.options.reduce((sum, opt) => sum + opt.voters.size, 0);

    let myVotedOption = null;
    const options = this.currentPoll.options.map((opt, idx) => {
      const votesCount = opt.voters.size;
      const percent = totalVotes > 0 ? Math.round((votesCount / totalVotes) * 100) : 0;
      if (forSocketId && opt.voters.has(forSocketId)) {
        myVotedOption = idx;
      }
      return {
        index: idx,
        text: opt.text,
        votesCount,
        percent
      };
    });

    const timeLeft = Math.max(0, Math.ceil((this.currentPoll.expiresAt - Date.now()) / 1000));

    return {
      id: this.currentPoll.id,
      question: this.currentPoll.question,
      options,
      totalVotes,
      createdBy: this.currentPoll.createdBy,
      active: this.currentPoll.active && timeLeft > 0,
      timeLeft,
      myVotedOption
    };
  }

  // ── BOT KOMENTÁTOR NA KONCI KOLA ────────────────────────────
  generateRoundCommentary(winnerPlayer) {
    if (!winnerPlayer) return [];

    const lines = [];

    // 1. 🏆 Vítěz kola
    const count = winnerPlayer.guessCount || 1;
    if (count < 25) {
      lines.push(`🏆 Kolo vyhrál ${winnerPlayer.name} na pouhých ${count} pokusů! Čistá telepatie, nebo cheatoval? monkaS`);
    } else if (count <= 70) {
      lines.push(`🏆 Vítězem kola je ${winnerPlayer.name} na ${count}. pokus! EZ Clap`);
    } else {
      lines.push(`🏆 ${winnerPlayer.name} to konečně po těžkém boji dotáhl na ${count}. pokus! Pot a slzy. Sadge`);
    }

    // 2. 💀 Největší bloudění kola (hledá se tip s nejvyšším rankem >= 5 000)
    let worstGuess = null;
    for (const g of this.guesses) {
      if (g.rank && g.word && (!worstGuess || g.rank > worstGuess.rank)) {
        worstGuess = g;
      }
    }
    if (worstGuess && worstGuess.rank >= 5000) {
      lines.push(`💀 Největší bloudění předvedl ${worstGuess.player}, který zkusil slovo "${worstGuess.word}" (rank #${worstGuess.rank})! Co to mělo jako bejt?! xdd`);
    }

    // 4. 🤡 Klaun kola (použil nápovědu)
    const allProfiles = Object.values(this.playerProfiles);
    const clownPlayer = allProfiles.find(p => p.usedHint);
    if (clownPlayer) {
      lines.push(`🤡 Ocenění Klaun kola získává ${clownPlayer.name}, protože nevydržel tlak a zobrazil si nápovědu! clown`);
    }

    // 5. ⌨️ Stroj na slova (ADHD)
    let maxGuesser = null;
    for (const p of allProfiles) {
      if (!maxGuesser || (p.guessCount || 0) > (maxGuesser.guessCount || 0)) {
        maxGuesser = p;
      }
    }
    if (maxGuesser && (maxGuesser.guessCount || 0) >= 30) {
      lines.push(`⌨️ Klávesnici nejvíc zavařil ${maxGuesser.name} s celkem ${maxGuesser.guessCount} tipy. ADHD`);
    }

    // 6. 🏳️ Bílý prapor (vzdal se)
    const surrenderedPlayer = allProfiles.find(p => p.gaveUp);
    if (surrenderedPlayer) {
      lines.push(`🏳️ ${surrenderedPlayer.name} to psychicky neunesl a vzdal se. F v chatu pro padlého bratra.`);
    }

    return lines;
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

const YESTERDAY_RECAP_PATH = path.join(__dirname, 'data', 'yesterdayRecap.json');

// ─────────────────────────────────────────────────────────────
// Denní společná hra (půlnoční reset, pevné slovo dle kalendáře)
// ─────────────────────────────────────────────────────────────
class DailyGameRoom extends BaseGameRoom {
  constructor() {
    super('daily');
    this.activeDate = wordService.getCzechDateStr();
    this.targetWordObj = wordService.getDailyWord();
    this.yesterdayRecap = this.loadYesterdayRecap();
  }

  loadYesterdayRecap() {
    try {
      if (fs.existsSync(YESTERDAY_RECAP_PATH)) {
        return JSON.parse(fs.readFileSync(YESTERDAY_RECAP_PATH, 'utf-8'));
      }
    } catch (e) {
      console.warn('[DailyGameRoom] Nepodařilo se načíst yesterdayRecap.json:', e.message);
    }
    return null;
  }

  saveYesterdayRecap(recap) {
    this.yesterdayRecap = recap;
    try {
      const dir = path.dirname(YESTERDAY_RECAP_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(YESTERDAY_RECAP_PATH, JSON.stringify(recap, null, 2), 'utf-8');
    } catch (e) {
      console.warn('[DailyGameRoom] Nepodařilo se uložit yesterdayRecap.json:', e.message);
    }
  }

  generateYesterdayRecap(customData = null) {
    const targetWord = customData && customData.targetWord ? customData.targetWord : (this.targetWordObj ? this.targetWordObj.word : '');
    const dayNumber = customData && customData.dayNumber !== undefined ? customData.dayNumber : (this.targetWordObj ? this.targetWordObj.dayNumber : null);
    const hint = customData && customData.hint ? customData.hint : (this.targetWordObj ? this.targetWordObj.hint : '');
    if (!targetWord) return null;

    const allProfiles = Object.values(customData && customData.playerProfiles ? customData.playerProfiles : this.playerProfiles);
    const solvedProfiles = allProfiles.filter(p => p.solved);
    const guessesList = customData && Array.isArray(customData.guesses) ? customData.guesses : this.guesses;
    const activeDate = customData && customData.date ? customData.date : this.activeDate;

    // 1. Vítěz (nejméně tipů)
    let winner = null;
    for (const p of solvedProfiles) {
      if (!winner || (p.guessCount || 999) < (winner.guessCount || 999)) {
        winner = { name: p.name, guessCount: p.guessCount || 1, color: p.color || null };
      }
    }

    // 2. Klaun (použil nápovědu)
    const clownPlayer = allProfiles.find(p => p.usedHint);
    const clown = clownPlayer ? { name: clownPlayer.name } : null;

    // 3. Stroj na slova (nejvíce tipů, alespoň 15)
    let maxGuesser = null;
    for (const p of allProfiles) {
      if (!maxGuesser || (p.guessCount || 0) > (maxGuesser.guessCount || 0)) {
        maxGuesser = { name: p.name, guessCount: p.guessCount || 0 };
      }
    }
    if (maxGuesser && maxGuesser.guessCount < 15) maxGuesser = null;

    // 4. Největší bloudění (tip s nejvyšším rankem >= 5000)
    let worstGuess = null;
    for (const g of guessesList) {
      if (g.rank && g.word && (!worstGuess || g.rank > worstGuess.rank)) {
        worstGuess = { player: g.player, word: g.word, rank: g.rank };
      }
    }
    if (worstGuess && worstGuess.rank < 5000) worstGuess = null;

    const surrenderedCount = allProfiles.filter(p => p.gaveUp).length;

    return {
      date: activeDate,
      dayNumber: dayNumber,
      word: targetWord,
      hint: hint || '',
      playersCount: allProfiles.length,
      guessesCount: guessesList.length,
      solvedCount: solvedProfiles.length,
      winner,
      clown,
      maxGuesser,
      worstGuess,
      surrenderedCount,
      commentaryLines: this.generateRoundCommentary(winner ? { name: winner.name, guessCount: winner.guessCount } : null)
    };
  }

  checkMidnightRoll() {
    const todayStr = wordService.getCzechDateStr();
    if (todayStr !== this.activeDate) {
      console.log(`[PŮLNOC] Půlnoční reset denní hry: ${this.activeDate} -> ${todayStr}`);

      // Spočítáme a trvale uložíme včerejší výsledky pro Lobby
      const recap = this.generateYesterdayRecap();
      if (recap) {
        this.saveYesterdayRecap(recap);
      }

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

  joinPlayer(socketId, playerName, playerColor = null, sessionId = null, clientIp = null) {
    this.checkMidnightRoll();
    return super.joinPlayer(socketId, playerName, playerColor, sessionId, clientIp);
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
      roundId: `daily_${this.activeDate}`,
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
      top50: canSeeSecret ? wordService.getTop50(this.targetWordObj) : null,
      poll: this.getPollPublicState(socketId),
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
    this.currentRoundId = Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 6);
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
      roundId: `unlimited_${this.currentRoundId}`,
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
      top50: canSeeSecret ? wordService.getTop50(this.targetWordObj) : null,
      poll: this.getPollPublicState(socketId),
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
// Custom mód (Soukromé místnosti přátel, kód místnosti, volba slova)
// ─────────────────────────────────────────────────────────────
class CustomGameRoom extends BaseGameRoom {
  constructor(roomCode, hostName = '', wordSource = 'daily') {
    const upperCode = roomCode.toUpperCase();
    super(`custom_${upperCode}`);
    this.roomCode = upperCode;
    this.mode = `custom_${upperCode}`;
    this.isCustomRoom = true;
    this.hostName = hostName;
    this.wordSource = wordSource === 'archive' ? 'archive' : 'daily';
    this.isDailyEligible = (this.wordSource === 'daily');
    this.recentWords = [];
    this.targetWordObj = this.selectWord();
    this.votes = new Set();
    this.createdAt = Date.now();
  }

  selectWord() {
    if (this.wordSource === 'daily') {
      return wordService.getDailyWord();
    } else {
      const pastPool = wordService.getPastWordsPool();
      if (this.recentWords.length >= pastPool.length) {
        this.recentWords = [];
      }
      const wObj = wordService.getUnlimitedWord(this.recentWords);
      this.recentWords.push(wObj.word);
      return wObj;
    }
  }

  setWordSource(newSource) {
    this.wordSource = newSource === 'archive' ? 'archive' : 'daily';
    this.isDailyEligible = (this.wordSource === 'daily');
    return this.resetWithNewWord();
  }

  getRequiredVotes() {
    const totalPlayers = Object.keys(this.players).length;
    if (totalPlayers <= 0) return 0;
    return Math.floor(totalPlayers / 2) + 1;
  }

  resetWithNewWord() {
    this.currentRoundId = Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 6);
    const oldWord = this.targetWordObj ? this.targetWordObj.word : '';
    this.targetWordObj = this.selectWord();
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

    if (votesCount >= requiredVotes && requiredVotes > 0) {
      const resetResult = this.resetWithNewWord();
      return {
        newWordTriggered: true,
        oldWord: resetResult.oldWord,
        newWord: resetResult.newWord,
        dayNumber: resetResult.dayNumber,
        votesCount: 0,
        requiredVotes: this.getRequiredVotes(),
        hasVoted: false
      };
    }

    return {
      newWordTriggered: false,
      votesCount,
      requiredVotes,
      hasVoted
    };
  }

  getGameStateForPlayer(socketId) {
    const player = this.players[socketId];
    const canSeeSecret = player && (player.solved || player.gaveUp);
    const requiredVotes = this.getRequiredVotes();
    const roundId = this.wordSource === 'daily'
      ? `custom_daily_${wordService.getCzechDateStr()}`
      : `custom_${this.roomCode}_${this.currentRoundId}`;

    return {
      mode: 'custom',
      roundId: roundId,
      isCustomRoom: true,
      roomCode: this.roomCode,
      wordSource: this.wordSource,
      isDailyEligible: this.wordSource === 'daily',
      hostName: this.hostName,
      date: this.wordSource === 'daily' ? wordService.getCzechDateStr() : `Archivní slovo`,
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
      top50: canSeeSecret ? wordService.getTop50(this.targetWordObj) : null,
      poll: this.getPollPublicState(socketId),
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
    this.rooms.daily.gameManager = this;
    this.rooms.unlimited.gameManager = this;
    this.customRooms = new Map(); // roomCode (uppercase) -> CustomGameRoom
    this.socketToRoom = new Map(); // socketId -> mode string
    this.replacedSockets = new Set(); // socketIds nahrazených při rychlém reconnectu
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

  markSocketReplaced(socketId) {
    if (!socketId) return;
    this.replacedSockets.add(socketId);
    setTimeout(() => {
      this.replacedSockets.delete(socketId);
    }, 30000);
  }

  isSocketReplaced(socketId) {
    return this.replacedSockets.has(socketId);
  }

  clearReplacedSocket(socketId) {
    this.replacedSockets.delete(socketId);
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
          try {
            if (!this.rooms.daily.yesterdayRecap || this.rooms.daily.yesterdayRecap.date !== data.daily.date) {
              const recap = this.rooms.daily.generateYesterdayRecap(data.daily);
              if (recap) {
                this.rooms.daily.saveYesterdayRecap(recap);
                console.log(`[STATE] Úspěšně vygenerována a uložena včerejší rekapitulace ze dne ${data.daily.date}.`);
              }
            }
          } catch (recErr) {
            console.warn('[STATE] Nepodařilo se vygenerovat včerejší rekapitulaci při startu:', recErr.message);
          }
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

  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    do {
      code = '';
      for (let i = 0; i < 5; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    } while (this.customRooms.has(code));
    return code;
  }

  createCustomRoom(wordSource = 'daily', customCode = null, hostName = '') {
    const code = (customCode || this.generateRoomCode()).toUpperCase().trim();
    if (this.customRooms.has(code)) {
      return this.customRooms.get(code);
    }
    const room = new CustomGameRoom(code, hostName, wordSource);
    room.gameManager = this;
    this.customRooms.set(code, room);
    return room;
  }

  getCustomRoom(roomCode) {
    if (!roomCode) return null;
    return this.customRooms.get(roomCode.toUpperCase().trim()) || null;
  }

  getRoom(mode) {
    if (!mode) return this.rooms.daily;
    if (mode === 'unlimited') return this.rooms.unlimited;
    if (mode === 'daily') return this.rooms.daily;
    if (mode.startsWith('custom_')) {
      const code = mode.slice(7).toUpperCase();
      return this.customRooms.get(code) || null;
    }
    if (this.customRooms.has(mode.toUpperCase())) {
      return this.customRooms.get(mode.toUpperCase());
    }
    return this.rooms.daily;
  }

  getRoomForSocket(socketId) {
    const mode = this.socketToRoom.get(socketId) || 'daily';
    return this.getRoom(mode);
  }

  getModeForSocket(socketId) {
    return this.socketToRoom.get(socketId) || 'daily';
  }

  getAllActiveModes() {
    const modes = ['daily', 'unlimited'];
    for (const code of this.customRooms.keys()) {
      modes.push(`custom_${code}`);
    }
    return modes;
  }

  getOnlineCounts() {
    const formatPlayer = (p, modeKey, modeTitle) => ({
      name: p.name,
      color: p.color || '#3b82f6',
      mode: modeKey,
      roomTitle: modeTitle,
      guessCount: p.guessCount || 0,
      solved: !!p.solved,
      gaveUp: !!p.gaveUp,
      usedHint: !!p.usedHint,
      isAdmin: !!p.isAdmin
    });

    const dailyPlayers = Object.values(this.rooms.daily.players).map(p => formatPlayer(p, 'daily', 'Denní výzva'));
    const unlimitedPlayers = Object.values(this.rooms.unlimited.players).map(p => formatPlayer(p, 'unlimited', 'Archiv'));
    const customPlayers = [];
    for (const [code, r] of this.customRooms.entries()) {
      for (const p of Object.values(r.players)) {
        customPlayers.push(formatPlayer(p, `custom_${code}`, `Aréna #${code}`));
      }
    }

    const allPlayers = [...dailyPlayers, ...unlimitedPlayers, ...customPlayers];

    return {
      daily: dailyPlayers.length,
      unlimited: unlimitedPlayers.length,
      custom: customPlayers.length,
      customPlayers: customPlayers.length,
      customRooms: this.customRooms.size,
      total: allPlayers.length,
      players: allPlayers
    };
  }

  joinPlayer(socketId, playerName, mode = 'daily', color = null, customCode = null, wordSource = 'daily', sessionId = null, clientIp = null) {
    let validMode = 'daily';
    let room = null;

    if (mode === 'unlimited') {
      validMode = 'unlimited';
      room = this.rooms.unlimited;
    } else if (mode === 'custom' || customCode || mode.startsWith('custom_')) {
      let code = (customCode || (mode.startsWith('custom_') ? mode.slice(7) : '')).toUpperCase().trim();
      if (!code) {
        code = this.generateRoomCode();
      }
      let cRoom = this.getCustomRoom(code);
      if (!cRoom) {
        cRoom = new CustomGameRoom(code, playerName, wordSource);
        cRoom.gameManager = this;
        this.customRooms.set(code, cRoom);
      }
      validMode = `custom_${cRoom.roomCode}`;
      room = cRoom;
    } else {
      validMode = 'daily';
      room = this.rooms.daily;
    }

    // Pokud byl hráč v jiné místnosti, odebereme ho
    const previousMode = this.socketToRoom.get(socketId);
    if (previousMode && previousMode !== validMode) {
      const prevRoom = this.getRoom(previousMode);
      if (prevRoom) prevRoom.removePlayer(socketId);
    }

    const joinResult = room.joinPlayer(socketId, playerName, color, sessionId, clientIp);
    const player = joinResult.player || joinResult;
    this.socketToRoom.set(socketId, validMode);

    return {
      player,
      room,
      mode: validMode,
      isReconnect: !!joinResult.isReconnect,
      oldSocketId: joinResult.oldSocketId || null
    };
  }

  removePlayer(socketId) {
    if (this.isSocketReplaced(socketId)) {
      this.clearReplacedSocket(socketId);
      this.socketToRoom.delete(socketId);
      return null;
    }

    const mode = this.socketToRoom.get(socketId);
    if (!mode) return null;

    this.socketToRoom.delete(socketId);
    const room = this.getRoom(mode);
    if (!room) return null;

    const removeResult = room.removePlayer(socketId);

    if (mode.startsWith('custom_') && Object.keys(room.players).length === 0) {
      setTimeout(() => {
        if (room && Object.keys(room.players).length === 0) {
          const code = mode.slice(7).toUpperCase();
          this.customRooms.delete(code);
        }
      }, 15 * 60 * 1000);
    }

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

  getYesterdayRecap() {
    return this.rooms.daily.yesterdayRecap || null;
  }
}

module.exports = new RoomManager();
