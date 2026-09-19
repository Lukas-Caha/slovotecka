const fs = require('fs');
const path = require('path');

// Načtení případných doplňkových dat (nápovědy, kategorie)
let wordsData = { targets: {} };
try {
  const jsonPath = path.join(__dirname, 'data', 'words.json');
  if (fs.existsSync(jsonPath)) {
    wordsData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  }
} catch (err) {
  console.warn('[wordService] words.json se nepodařilo načíst:', err.message);
}

// Cesty ke složce s vygenerovanými slovy na dny
const VYSTUP_DIR = path.join(__dirname, '..', 'vystup');
const HARMONOGRAM_PATH = path.join(VYSTUP_DIR, 'harmonogram.csv');

// Pomocná funkce pro odstranění české diakritiky (háčků a čárek)
function removeDiacritics(str) {
  if (!str || typeof str !== 'string') return '';
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Očištění a normalizace vstupu
function normalizeWord(word) {
  if (!word || typeof word !== 'string') return '';
  return word.trim().toLowerCase();
}

// Získání aktuálního data v českém časovém pásmu (Europe/Prague) ve formátu YYYY-MM-DD
function getCzechDateStr(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

// Pevné výchozí datum (1. září 2026 = Den #1)
// 17. září 2026 = Den #17, po půlnoci 18. září 2026 = Den #18
const START_DATE_STR = '2026-09-01';

// Načtení harmonogramu dnů a tajných slov z vystup/harmonogram.csv
function loadSchedule() {
  if (!fs.existsSync(HARMONOGRAM_PATH)) {
    throw new Error(`Harmonogram nenalezen na cestě: ${HARMONOGRAM_PATH}`);
  }
  const content = fs.readFileSync(HARMONOGRAM_PATH, 'utf-8');
  const lines = content.split(/\r?\n/);
  const schedule = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const [dayStr, word] = line.split(',');
    if (!dayStr || !word) continue;
    schedule.push({
      day: parseInt(dayStr.trim(), 10),
      word: word.trim().toLowerCase()
    });
  }
  if (schedule.length === 0) {
    throw new Error('Harmonogram je prázdný.');
  }
  return schedule;
}

const schedule = loadSchedule();

// Výpočet pořadového čísla dne od 1. září 2026
function getDayNumber(dateStr) {
  const targetDateStr = dateStr || getCzechDateStr();
  const [sy, sm, sd] = START_DATE_STR.split('-').map(Number);
  const [ty, tm, td] = targetDateStr.split('-').map(Number);

  const utc1 = Date.UTC(sy, sm - 1, sd);
  const utc2 = Date.UTC(ty, tm - 1, td);
  const diffDays = Math.max(0, Math.floor((utc2 - utc1) / (1000 * 60 * 60 * 24)));
  return diffDays + 1;
}

// Vyrovnávací paměť načtených dnů pro okamžitý lookup
const dayCache = new Map();

// Načtení a zaindexování CSV souboru pro konkrétní den
function loadDayData(day, targetWord) {
  if (dayCache.has(day)) {
    return dayCache.get(day);
  }

  const numStr = String(day).padStart(2, '0');
  let fileName = `den_${numStr}_${targetWord}.csv`;
  let filePath = path.join(VYSTUP_DIR, fileName);

  if (!fs.existsSync(filePath)) {
    const allFiles = fs.readdirSync(VYSTUP_DIR);
    const cleanTarget = normalizeWord(targetWord);
    const match = allFiles.find((f) => f.toLowerCase().endsWith(`_${cleanTarget}.csv`)) ||
                  allFiles.find((f) => f.startsWith(`den_${numStr}_`));
    if (match) {
      filePath = path.join(VYSTUP_DIR, match);
    }
  }

  if (!fs.existsSync(filePath)) {
    throw new Error(`Soubor s herními daty pro den ${day} nebyl nalezen (${filePath})`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);

  const exactMap = new Map();
  const normalizedMap = new Map();
  const top50Map = new Map();
  let maxRank = 1;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const commaIdx = line.lastIndexOf(',');
    if (commaIdx === -1) continue;

    const word = line.substring(0, commaIdx).trim().toLowerCase();
    const rank = parseInt(line.substring(commaIdx + 1), 10);
    if (isNaN(rank)) continue;

    if (rank > maxRank) maxRank = rank;

    if (!exactMap.has(word)) {
      exactMap.set(word, rank);
    }

    if (rank <= 50 && !top50Map.has(rank)) {
      top50Map.set(rank, word);
    }

    const norm = removeDiacritics(word);
    const existing = normalizedMap.get(norm);
    if (!existing || existing.rank > rank) {
      normalizedMap.set(norm, { word, rank });
    }
  }

  // Garantujeme, že cílové slovo má rank 1
  const cleanTarget = normalizeWord(targetWord);
  exactMap.set(cleanTarget, 1);
  top50Map.set(1, cleanTarget);
  normalizedMap.set(removeDiacritics(cleanTarget), { word: cleanTarget, rank: 1 });

  const top50 = [];
  for (let r = 1; r <= 50; r++) {
    if (top50Map.has(r)) {
      top50.push({ rank: r, word: top50Map.get(r) });
    }
  }

  const dayData = {
    day,
    targetWord: cleanTarget,
    exactMap,
    normalizedMap,
    top50,
    maxRank
  };

  dayCache.set(day, dayData);
  return dayData;
}

// Získání denního slova a herního balíčku pro daný kalendářní den
function getDailyWord(dateStr) {
  const currentDateStr = dateStr || getCzechDateStr();
  const dayNumber = getDayNumber(currentDateStr);
  const scheduleIndex = (dayNumber - 1) % schedule.length;
  const scheduleEntry = schedule[scheduleIndex];

  const dayData = loadDayData(scheduleEntry.day, scheduleEntry.word);

  let hint = wordsData.targets?.[scheduleEntry.word]?.hint;
  if (!hint) {
    hint = `Slovo má ${scheduleEntry.word.length} písmen a začíná na písmeno "${scheduleEntry.word[0].toUpperCase()}".`;
  }

  return {
    key: scheduleEntry.word,
    date: currentDateStr,
    dayNumber: dayNumber,
    word: scheduleEntry.word,
    hint: hint,
    category: wordsData.targets?.[scheduleEntry.word]?.category || 'obecné',
    dayData: dayData
  };
}

// Náhodná archivní hra (ze starších dnů)
function getRandomWord() {
  const currentDateStr = getCzechDateStr();
  const dayNumber = getDayNumber(currentDateStr);
  const pastDaysCount = Math.max(1, Math.min(dayNumber - 1, schedule.length));
  const randomIndex = Math.floor(Math.random() * pastDaysCount);
  const entry = schedule[randomIndex];

  const dayData = loadDayData(entry.day, entry.word);
  let hint = wordsData.targets?.[entry.word]?.hint;
  if (!hint) {
    hint = `Slovo má ${entry.word.length} písmen a začíná na písmeno "${entry.word[0].toUpperCase()}".`;
  }

  return {
    key: entry.word,
    date: 'archivní náhodná hra',
    dayNumber: entry.day,
    word: entry.word,
    hint: hint,
    category: wordsData.targets?.[entry.word]?.category || 'obecné',
    dayData: dayData
  };
}

// Získání fondu archivních slov (dny předcházející dnešnímu dni)
function getPastWordsPool(maxDay) {
  const currentDay = maxDay || getDayNumber();
  const past = schedule.filter((s) => s.day < currentDay);
  return past.length > 0 ? past : schedule.slice(0, 1);
}

// Získání slova pro Unlimited mód z fondu archivních slov
function getUnlimitedWord(excludeWords = []) {
  const pool = getPastWordsPool();
  let available = pool.filter((p) => !excludeWords.includes(p.word));
  if (available.length === 0) {
    available = pool;
  }
  const entry = available[Math.floor(Math.random() * available.length)];
  const dayData = loadDayData(entry.day, entry.word);
  let hint = wordsData.targets?.[entry.word]?.hint;
  if (!hint) {
    hint = `Slovo má ${entry.word.length} písmen a začíná na písmeno "${entry.word[0].toUpperCase()}".`;
  }

  return {
    key: entry.word,
    date: `Archiv (Den #${entry.day})`,
    dayNumber: entry.day,
    word: entry.word,
    hint: hint,
    category: wordsData.targets?.[entry.word]?.category || 'obecné',
    dayData: dayData
  };
}

// Získání konkrétního slova (např. při obnově stavu z disku)
function getSpecificWord(dayNumber, word) {
  if (!word) return null;
  const cleanWord = word.trim().toLowerCase();
  const scheduleEntry = schedule.find((s) => (dayNumber ? s.day === dayNumber : false) && s.word === cleanWord) || schedule.find((s) => s.word === cleanWord);
  const useDay = scheduleEntry ? scheduleEntry.day : (dayNumber || 1);
  const useWord = scheduleEntry ? scheduleEntry.word : cleanWord;
  const dayData = loadDayData(useDay, useWord);
  let hint = wordsData.targets?.[useWord]?.hint;
  if (!hint) {
    hint = `Slovo má ${useWord.length} písmen a začíná na písmeno "${useWord[0].toUpperCase()}".`;
  }
  return {
    key: useWord,
    date: `Archiv (Den #${useDay})`,
    dayNumber: useDay,
    word: useWord,
    hint: hint,
    category: wordsData.targets?.[useWord]?.category || 'obecné',
    dayData: dayData
  };
}

// Výpočet sémantické blízkosti podle vygenerovaných embedding dat
function calculateRank(targetWordObj, userGuess) {
  const cleanGuess = normalizeWord(userGuess);
  if (!cleanGuess || cleanGuess.length < 2) {
    return { isValid: false, error: 'Slovo musí mít alespoň 2 písmena.' };
  }

  // Povolena pouze písmena české a latinské abecedy
  const czechLetterRegex = /^[a-záčďéěíňóřšťúůýž]+$/i;
  if (!czechLetterRegex.test(cleanGuess)) {
    return { isValid: false, error: 'Slovo smí obsahovat pouze písmena bez čísel a znaků.' };
  }

  const targetWord = normalizeWord(targetWordObj.word);
  const targetNorm = removeDiacritics(targetWord);
  const guessNorm = removeDiacritics(cleanGuess);

  // 1. Uhodnuto vítězné slovo!
  if (cleanGuess === targetWord || guessNorm === targetNorm) {
    return {
      isValid: true,
      isWinner: true,
      rank: 1,
      word: targetWordObj.word
    };
  }

  const dayData = targetWordObj.dayData;
  if (!dayData) {
    return { isValid: false, error: 'Chyba herních dat pro dnešní den.' };
  }

  // 2. Přesná shoda v herním slovníku daného dne
  if (dayData.exactMap.has(cleanGuess)) {
    const rank = dayData.exactMap.get(cleanGuess);
    const isWinner = rank === 1;
    return {
      isValid: true,
      isWinner: isWinner,
      rank: rank,
      word: isWinner ? targetWordObj.word : cleanGuess
    };
  }

  // 3. Shoda bez diakritiky (např. 'aktualne' -> 'aktuálně')
  if (dayData.normalizedMap.has(guessNorm)) {
    const match = dayData.normalizedMap.get(guessNorm);
    const isWinner = match.rank === 1;
    return {
      isValid: true,
      isWinner: isWinner,
      rank: match.rank,
      word: isWinner ? targetWordObj.word : match.word
    };
  }

  // 4. Slovo není ve slovníku
  return {
    isValid: false,
    error: `Slovo "${cleanGuess}" není v herním slovníku.`
  };
}

// Získání TOP 50 nejbližších slov
function getTop50(targetWordObj) {
  if (!targetWordObj || !targetWordObj.dayData) return [];
  return targetWordObj.dayData.top50 || [];
}

module.exports = {
  getDailyWord,
  getRandomWord,
  getPastWordsPool,
  getUnlimitedWord,
  getSpecificWord,
  calculateRank,
  getTop50,
  normalizeWord,
  removeDiacritics,
  getCzechDateStr,
  getDayNumber
};

