const fs = require('fs');
const path = require('path');
const wordService = require('./wordService');
let authService = null;
try {
  authService = require('./authService');
} catch (e) {}

const PROFILES_FILE_PATH = path.join(__dirname, 'data', 'playerProfiles.json');
const INACTIVITY_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000; // 7 dní neaktivity

class PlayerProfileManager {
  constructor() {
    this.profiles = new Map(); // key (lowercase) -> profile object
    this.saveTimeout = null;
    this.cleanupInterval = null;
    this.loadProfiles();
    this.startCleanupInterval();
  }

  normalizeKey(name) {
    if (!name || typeof name !== 'string') return '';
    return name.replace(/(\s*\(\d+\))+$/, '').trim().toLowerCase();
  }

  sanitizeStats(stats) {
    const s = stats || {};
    return {
      gamesPlayed: typeof s.gamesPlayed === 'number' ? s.gamesPlayed : 0,
      gamesWon: typeof s.gamesWon === 'number' ? s.gamesWon : 0,
      currentStreak: typeof s.currentStreak === 'number' ? s.currentStreak : 0,
      maxStreak: typeof s.maxStreak === 'number' ? s.maxStreak : 0,
      lastWinDate: typeof s.lastWinDate === 'string' ? s.lastWinDate : null,
      totalWinningGuesses: typeof s.totalWinningGuesses === 'number' ? s.totalWinningGuesses : 0,
      bestScore: typeof s.bestScore === 'number' ? s.bestScore : null,
      recordedPlayedGames: Array.isArray(s.recordedPlayedGames) ? s.recordedPlayedGames.slice(-200) : [],
      recordedWonGames: Array.isArray(s.recordedWonGames) ? s.recordedWonGames.slice(-200) : []
    };
  }

  loadProfiles() {
    try {
      if (!fs.existsSync(PROFILES_FILE_PATH)) {
        this.profiles = new Map();
        return;
      }
      const raw = fs.readFileSync(PROFILES_FILE_PATH, 'utf-8');
      if (!raw || !raw.trim()) {
        this.profiles = new Map();
        return;
      }
      const data = JSON.parse(raw);
      this.profiles = new Map();
      const now = Date.now();
      let purgedOnLoad = 0;

      for (const [key, prof] of Object.entries(data)) {
        if (prof && typeof prof === 'object') {
          const lastActive = prof.lastActive || prof.updatedAt || now;
          const isRegistered = Boolean(prof.isRegistered);
          // Kontrola expirace po 7 dnech neaktivity (pouze pro hosty; registrované účty mají retenci dle DB)
          if (isRegistered || now - lastActive <= INACTIVITY_TIMEOUT_MS) {
            this.profiles.set(key.toLowerCase(), {
              name: prof.name || key,
              color: prof.color || '#3b82f6',
              emote: prof.emote || null,
              isRegistered: isRegistered,
              lastActive: lastActive,
              stats: this.sanitizeStats(prof.stats)
            });
          } else {
            purgedOnLoad++;
          }
        }
      }
      console.log(`[PROFILES] Načteno ${this.profiles.size} aktivních profilů.${purgedOnLoad > 0 ? ` (Promazáno ${purgedOnLoad} neaktivních guest profilů)` : ''}`);
    } catch (err) {
      console.error('[PROFILES] Chyba při načítání souboru profilů:', err);
      this.profiles = new Map();
    }
  }

  scheduleSave() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      this.saveProfiles(false);
    }, 1500);
  }

  saveProfiles(sync = false) {
    try {
      const obj = {};
      for (const [k, p] of this.profiles.entries()) {
        obj[k] = p;
      }
      const dataDir = path.dirname(PROFILES_FILE_PATH);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      const jsonStr = JSON.stringify(obj, null, 2);
      if (sync) {
        fs.writeFileSync(PROFILES_FILE_PATH, jsonStr, 'utf-8');
      } else {
        const tmpPath = `${PROFILES_FILE_PATH}.tmp`;
        fs.writeFile(tmpPath, jsonStr, 'utf-8', (err) => {
          if (!err) {
            try {
              if (process.platform === 'win32' && fs.existsSync(PROFILES_FILE_PATH)) {
                fs.copyFileSync(tmpPath, PROFILES_FILE_PATH);
                fs.unlinkSync(tmpPath);
              } else {
                fs.rename(tmpPath, PROFILES_FILE_PATH, () => {});
              }
            } catch (e) {
              fs.writeFileSync(PROFILES_FILE_PATH, jsonStr, 'utf-8');
            }
          }
        });
      }

      // Synchronizace profilů registrovaných uživatelů do PostgreSQL
      if (authService && typeof authService.saveUserProfile === 'function') {
        for (const p of this.profiles.values()) {
          if (p && p.isRegistered) {
            authService.saveUserProfile(p.name, {
              color: p.color,
              emote: p.emote,
              stats: p.stats
            });
          }
        }
      }
    } catch (err) {
      console.error('[PROFILES] Chyba při ukládání profilů:', err);
    }
  }

  touchActivity(name) {
    const key = this.normalizeKey(name);
    if (!key) return;
    const prof = this.profiles.get(key);
    if (prof) {
      prof.lastActive = Date.now();
      this.scheduleSave();
    }
  }

  getProfile(name) {
    const key = this.normalizeKey(name);
    if (!key) return null;
    return this.profiles.get(key) || null;
  }

  deleteProfile(name) {
    const key = this.normalizeKey(name);
    if (!key || !this.profiles.delete(key)) return false;
    this.saveProfiles(false);
    return true;
  }

  getOrCreateProfile(name, preferredColor = null, clientStats = null, preferredEmote = null, isRegistered = false) {
    const key = this.normalizeKey(name);
    if (!key) return null;

    let prof = this.profiles.get(key);
    const now = Date.now();

    if (!prof) {
      prof = {
        name: name.replace(/(\s*\(\d+\))+$/, '').trim(),
        color: preferredColor || '#3b82f6',
        emote: preferredEmote || null,
        isRegistered: Boolean(isRegistered),
        lastActive: now,
        stats: this.sanitizeStats(clientStats)
      };
      this.profiles.set(key, prof);
      this.scheduleSave();
    } else {
      if (isRegistered) prof.isRegistered = true;
      prof.lastActive = now;
      // Migrace / sloučení dat z klienta (např. když poprvé přechází z LocalStorage a server má 0 her)
      if (clientStats && (!prof.stats || prof.stats.gamesPlayed === 0)) {
        prof.stats = this.mergeStats(prof.stats, clientStats);
      }
      if (preferredColor && preferredColor !== '#3b82f6' && prof.color !== preferredColor) {
        prof.color = preferredColor;
      }
      if (preferredEmote !== null && preferredEmote !== undefined && prof.emote !== preferredEmote) {
        prof.emote = preferredEmote || null;
      }
      this.scheduleSave();
    }
    return prof;
  }

  markAsRegistered(name, dbData = null) {
    const key = this.normalizeKey(name);
    if (!key) return null;
    let prof = this.profiles.get(key);
    if (prof) {
      prof.isRegistered = true;
      if (dbData) {
        if (dbData.color) prof.color = dbData.color;
        if (dbData.emote !== undefined) prof.emote = dbData.emote;
        if (dbData.stats) prof.stats = this.mergeStats(prof.stats, dbData.stats);
      }
      this.scheduleSave();
    } else {
      prof = this.getOrCreateProfile(
        name,
        dbData?.color || null,
        dbData?.stats || null,
        dbData?.emote || null,
        true
      );
    }
    return prof;
  }

  updateColor(name, color) {
    const key = this.normalizeKey(name);
    if (!key) return;
    const prof = this.profiles.get(key);
    if (prof) {
      prof.color = color;
      prof.lastActive = Date.now();
      this.scheduleSave();
    }
  }

  updateEmote(name, emote) {
    const key = this.normalizeKey(name);
    if (!key) return;
    const prof = this.profiles.get(key);
    if (prof) {
      prof.emote = emote || null;
      prof.lastActive = Date.now();
      this.scheduleSave();
    }
  }

  recordGameEntry(name, gameId) {
    if (!gameId) return;
    const key = this.normalizeKey(name);
    if (!key) return;
    const prof = this.getOrCreateProfile(name);
    if (!prof) return;

    prof.lastActive = Date.now();
    if (!prof.stats.recordedPlayedGames.includes(gameId)) {
      prof.stats.recordedPlayedGames.push(gameId);
      if (prof.stats.recordedPlayedGames.length > 200) prof.stats.recordedPlayedGames.shift();
      prof.stats.gamesPlayed = (prof.stats.gamesPlayed || 0) + 1;
      this.scheduleSave();
    }
  }

  recordGameWin(name, gameId, guessesCount, isDaily = false) {
    if (!gameId) return;
    const key = this.normalizeKey(name);
    if (!key) return;
    const prof = this.getOrCreateProfile(name);
    if (!prof) return;

    prof.lastActive = Date.now();
    if (prof.stats.recordedWonGames.includes(gameId)) {
      return; // Výhra v této konkrétní hře již byla započtena
    }
    prof.stats.recordedWonGames.push(gameId);
    if (prof.stats.recordedWonGames.length > 200) prof.stats.recordedWonGames.shift();
    prof.stats.gamesWon = (prof.stats.gamesWon || 0) + 1;

    // Denní série (streak) podle kalendářních dnů v ČR
    if (isDaily) {
      const today = wordService.getCzechDateStr();
      if (prof.stats.lastWinDate) {
        const diffDays = this.getCalendarDayDiff(prof.stats.lastWinDate, today);
        if (diffDays === 1) {
          prof.stats.currentStreak = (prof.stats.currentStreak || 0) + 1;
        } else if (diffDays === 0) {
          // Více výher v jeden kalendářní den zachovává sérii
        } else {
          prof.stats.currentStreak = 1;
        }
      } else {
        prof.stats.currentStreak = 1;
      }
      prof.stats.lastWinDate = today;
      prof.stats.maxStreak = Math.max(prof.stats.maxStreak || 0, prof.stats.currentStreak);
    }

    if (typeof guessesCount === 'number' && guessesCount > 0) {
      prof.stats.totalWinningGuesses = (Number(prof.stats.totalWinningGuesses) || 0) + guessesCount;
      if (prof.stats.bestScore === null || guessesCount < prof.stats.bestScore) {
        prof.stats.bestScore = guessesCount;
      }
    }

    this.scheduleSave();
  }

  getCalendarDayDiff(dateStr1, dateStr2) {
    if (!dateStr1 || !dateStr2) return 999;
    const p1 = dateStr1.split('-').map(Number);
    const p2 = dateStr2.split('-').map(Number);
    if (p1.length < 3 || p2.length < 3 || isNaN(p1[0]) || isNaN(p2[0])) return 999;
    const t1 = Date.UTC(p1[0], p1[1] - 1, p1[2]);
    const t2 = Date.UTC(p2[0], p2[1] - 1, p2[2]);
    return Math.round((t2 - t1) / (1000 * 60 * 60 * 24));
  }

  mergeStats(existing, incoming) {
    if (!incoming) return existing;
    const s = existing || this.sanitizeStats({});
    return {
      gamesPlayed: Math.max(s.gamesPlayed || 0, incoming.gamesPlayed || 0),
      gamesWon: Math.max(s.gamesWon || 0, incoming.gamesWon || 0),
      currentStreak: Math.max(s.currentStreak || 0, incoming.currentStreak || 0),
      maxStreak: Math.max(s.maxStreak || 0, incoming.maxStreak || 0),
      lastWinDate: incoming.lastWinDate && (!s.lastWinDate || incoming.lastWinDate > s.lastWinDate) ? incoming.lastWinDate : s.lastWinDate,
      totalWinningGuesses: Math.max(s.totalWinningGuesses || 0, incoming.totalWinningGuesses || 0),
      bestScore: (s.bestScore === null) ? incoming.bestScore : (incoming.bestScore !== null ? Math.min(s.bestScore, incoming.bestScore) : s.bestScore),
      recordedPlayedGames: Array.from(new Set([...(s.recordedPlayedGames || []), ...(incoming.recordedPlayedGames || [])])).slice(-200),
      recordedWonGames: Array.from(new Set([...(s.recordedWonGames || []), ...(incoming.recordedWonGames || [])])).slice(-200)
    };
  }

  cleanupInactiveProfiles() {
    const now = Date.now();
    let deletedCount = 0;
    for (const [key, prof] of this.profiles.entries()) {
      // Registrované profily nemažeme po 7 dnech – ty se mažou až po 21 dnech neaktivity v PostgreSQL
      if (prof.isRegistered) continue;

      if (now - (prof.lastActive || 0) > INACTIVITY_TIMEOUT_MS) {
        this.profiles.delete(key);
        deletedCount++;
      }
    }
    if (deletedCount > 0) {
      console.log(`[PROFILES] Automaticky smazáno ${deletedCount} neaktivních guest profilů (> 7 dní neaktivity).`);
      this.saveProfiles(false);
    }
  }

  startCleanupInterval() {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    // Pravidelná kontrola a promazání každou hodinu
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveProfiles();
    }, 60 * 60 * 1000);
    if (this.cleanupInterval && typeof this.cleanupInterval.unref === 'function') {
      this.cleanupInterval.unref();
    }
  }
}

module.exports = new PlayerProfileManager();
