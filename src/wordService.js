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
const DATA_VERSION = 'czech-lemmas-2026-10-05';

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

// Nová sada: 5. října 2026 = Den #1, další slovo o české půlnoci.
const START_DATE_STR = '2026-10-05';

// Tvary slov odkazují na jediný základní tvar, nezabírají další pořadí.
const aliasesPath = path.join(VYSTUP_DIR, 'aliases.json');
const wordAliases = fs.existsSync(aliasesPath)
  ? JSON.parse(fs.readFileSync(aliasesPath, 'utf8')) : {};
const accentlessAliases = new Map();
for (const form of Object.keys(wordAliases)) {
  const key = removeDiacritics(form);
  // Nejednoznačné zápisy bez diakritiky mají pevné, na cíli nezávislé rozlišení.
  if (key !== form && !Object.hasOwn(wordAliases, key) && !accentlessAliases.has(key)) {
    accentlessAliases.set(key, wordAliases[form]);
  }
}

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

// Výpočet pořadového čísla dne od začátku nové sady.
function getDayNumber(dateStr) {
  const targetDateStr = dateStr || getCzechDateStr();
  const [sy, sm, sd] = START_DATE_STR.split('-').map(Number);
  const [ty, tm, td] = targetDateStr.split('-').map(Number);

  const utc1 = Date.UTC(sy, sm - 1, sd);
  const utc2 = Date.UTC(ty, tm - 1, td);
  const diffDays = Math.max(0, Math.floor((utc2 - utc1) / (1000 * 60 * 60 * 24)));
  return diffDays + 1;
}

// Slovník gramatických rodů pro 93 cílových slov v harmonogramu
const WORD_GENDERS = {
  'léto': 'střední', 'zboží': 'střední', 'licence': 'ženský', 'pěstování': 'střední',
  'růst': 'mužský', 'vůz': 'mužský', 'orgán': 'mužský', 'snaha': 'ženský',
  'server': 'mužský', 'počítač': 'mužský', 'organizace': 'ženský', 'výzkum': 'mužský',
  'kněz': 'mužský', 'prvek': 'mužský', 'pomoc': 'ženský', 'televize': 'ženský',
  'řešení': 'střední', 'průkaz': 'mužský', 'detail': 'mužský', 'těhotenství': 'střední',
  'vůně': 'ženský', 'prostředek': 'mužský', 'knihovna': 'ženský', 'prohlášení': 'střední',
  'stanovení': 'střední', 'region': 'mužský', 'klášter': 'mužský', 'památka': 'ženský',
  'test': 'mužský', 'snížení': 'střední', 'hudebník': 'mužský', 'analýza': 'ženský',
  'smysl': 'mužský', 'kód': 'mužský', 'cena': 'ženský', 'stanice': 'ženský',
  'manželka': 'ženský', 'ulice': 'ženský', 'prezident': 'mužský', 'hvězda': 'ženský',
  'tričko': 'střední', 'vzor': 'mužský', 'vazba': 'ženský', 'kus': 'mužský',
  'republika': 'ženský', 'skupina': 'ženský', 'instalace': 'ženský', 'příkaz': 'mužský',
  'obal': 'mužský', 'informace': 'ženský', 'orientace': 'ženský', 'kniha': 'ženský',
  'maso': 'střední', 'osoba': 'ženský', 'dvojice': 'ženský', 'program': 'mužský',
  'poslanec': 'mužský', 'vlak': 'mužský', 'soud': 'mužský', 'odpad': 'mužský',
  'kolo': 'střední', 'odpoledne': 'střední', 'předseda': 'mužský', 'rodina': 'ženský',
  'režisér': 'mužský', 'rekord': 'mužský', 'časopis': 'mužský', 'odpověď': 'ženský',
  'baterie': 'ženský', 'recenze': 'ženský', 'vesnice': 'ženský', 'slunce': 'střední',
  'průběh': 'mužský', 'úvěr': 'mužský', 'věc': 'ženský', 'herečka': 'ženský',
  'postup': 'mužský', 'krev': 'ženský', 'fotograf': 'mužský', 'říjen': 'mužský',
  'revize': 'ženský', 'člověk': 'mužský', 'tlačítko': 'střední', 'motor': 'mužský',
  'poměr': 'mužský', 'dítě': 'střední', 'ústav': 'mužský', 'látka': 'ženský',
  'disk': 'mužský', 'inzerát': 'mužský', 'jeskyně': 'ženský', 'značka': 'ženský',
  'duše': 'ženský'
};

function getWordGender(word) {
  const w = normalizeWord(word);
  if (wordsData.targets?.[w]?.gender) return wordsData.targets[w].gender;
  if (WORD_GENDERS[w]) return WORD_GENDERS[w];
  if (w.endsWith('o') || w.endsWith('í') || (w.endsWith('e') && (w.endsWith('če') || w.endsWith('ště') || w.endsWith('tě')))) return 'střední';
  if (w.endsWith('a') || w.endsWith('e') || w.endsWith('ost')) return 'ženský';
  return 'mužský';
}

function getMaskedWord(word) {
  if (!word || word.length <= 1) return (word || '').toUpperCase();
  const upper = word.toUpperCase();
  const first = upper[0];
  const last = upper[upper.length - 1];
  if (word.length === 2) {
    return `${first} ${last}`;
  }
  const middles = Array(word.length - 2).fill('_').join(' ');
  return `${first} ${middles} ${last}`;
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
  const rankToWordMap = new Map();
  let maxRank = 1;
  let radarCandidate = null;
  let bestRadarDiff = 999999;

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

    if (rank <= 500 && !rankToWordMap.has(rank)) {
      rankToWordMap.set(rank, word);
    }

    // Vyhledání radarového slova v pásmu okolo ranku 150 (v rozmezí 120-250)
    if (rank >= 100 && rank <= 300) {
      const diff = Math.abs(rank - 150);
      if (diff < bestRadarDiff) {
        bestRadarDiff = diff;
        radarCandidate = { word, rank };
      }
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
  rankToWordMap.set(1, cleanTarget);
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
    rankToWordMap,
    radarWord: radarCandidate || { word: 'vzdálené', rank: 150 },
    maxRank
  };

  // Každý den obsahuje celý slovník; při dlouhém běhu držíme jen několik dnů.
  if (dayCache.size >= 4) dayCache.delete(dayCache.keys().next().value);
  dayCache.set(day, dayData);
  return dayData;
}

// Získání slova pro 3. nápovědu, které je striktně lepší než dosavadní nejlepší rank hráče
function getBetterHintWord(dayData, bestRank = 999999, excludedWords = []) {
  if (!dayData || !dayData.rankToWordMap) {
    return { word: 'neznámé', rank: 150 };
  }

  const excluded = new Set(
    (Array.isArray(excludedWords) ? excludedWords : [])
      .map((w) => normalizeWord(w))
      .concat([normalizeWord(dayData.targetWord)])
  );

  let targetRank = 150;
  let maxRankLimit = 300;

  if (typeof bestRank === 'number' && bestRank <= 300 && bestRank > 1) {
    if (bestRank === 2) {
      return { word: null, rank: 2, isAtRankTwo: true };
    }
    // Cílíme na rank přibližně v polovině mezi 1 a hráčovým dosavadním nejlepším rankem
    targetRank = Math.max(2, Math.floor(bestRank * 0.5));
    maxRankLimit = bestRank - 1; // Musí být striktně lepší než hráčovo dosud nejlepší slovo!
  }

  let bestCandidate = null;
  let bestDiff = 999999;

  for (let r = 2; r <= maxRankLimit; r++) {
    if (dayData.rankToWordMap.has(r)) {
      const w = dayData.rankToWordMap.get(r);
      if (!excluded.has(w)) {
        const diff = Math.abs(r - targetRank);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestCandidate = { word: w, rank: r };
        }
      }
    }
  }

  if (bestCandidate) {
    return bestCandidate;
  }

  for (let r = maxRankLimit; r >= 2; r--) {
    if (dayData.rankToWordMap.has(r)) {
      const w = dayData.rankToWordMap.get(r);
      if (!excluded.has(w)) {
        return { word: w, rank: r };
      }
    }
  }

  return dayData.radarWord || { word: 'vzdálené', rank: 150 };
}

function buildWordPayload(dayNumber, word, dayData, dateStr) {
  const cleanWord = normalizeWord(word);
  const firstLetter = cleanWord[0].toUpperCase();
  const length = cleanWord.length;
  const gender = getWordGender(cleanWord);
  const mask = getMaskedWord(cleanWord);
  const radar = dayData.radarWord || { word: 'vzdálené', rank: 150 };

  const countWord = length === 1 ? 'písmeno' : (length >= 2 && length <= 4 ? 'písmena' : 'písmen');
  const hint1 = `Slovo začíná na písmeno "${firstLetter}" a má ${length} ${countWord}.`;
  const hint2 = `Tvar slova: ${mask} (rod ${gender}).`;
  const hint3 = `Blízké tématické slovo: "${radar.word}" (pořadí #${radar.rank}).`;

  let legacyHint = wordsData.targets?.[cleanWord]?.hint;
  if (!legacyHint) {
    legacyHint = hint1;
  }

  return {
    key: cleanWord,
    date: dateStr || getCzechDateStr(),
    dayNumber: dayNumber,
    word: cleanWord,
    hint: legacyHint,
    category: wordsData.targets?.[cleanWord]?.category || 'obecné',
    hints: {
      level1: hint1,
      level2: hint2,
      level3: hint3
    },
    radarWord: radar,
    dayData: dayData
  };
}

// Získání denního slova a herního balíčku pro daný kalendářní den
function getDailyWord(dateStr) {
  const currentDateStr = dateStr || getCzechDateStr();
  const dayNumber = getDayNumber(currentDateStr);
  const scheduleIndex = (dayNumber - 1) % schedule.length;
  const scheduleEntry = schedule[scheduleIndex];

  const dayData = loadDayData(scheduleEntry.day, scheduleEntry.word);
  return buildWordPayload(dayNumber, scheduleEntry.word, dayData, currentDateStr);
}

// Náhodná archivní hra (ze starších dnů)
function getRandomWord() {
  const currentDateStr = getCzechDateStr();
  const dayNumber = getDayNumber(currentDateStr);
  const pastDaysCount = Math.max(1, Math.min(dayNumber - 1, schedule.length));
  const randomIndex = Math.floor(Math.random() * pastDaysCount);
  const entry = schedule[randomIndex];

  const dayData = loadDayData(entry.day, entry.word);
  return buildWordPayload(entry.day, entry.word, dayData, 'archivní náhodná hra');
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
  return buildWordPayload(entry.day, entry.word, dayData, `Archiv (Den #${entry.day})`);
}

// Získání slova pro mód Rychlovka
function getSpeedrunWord(excludeWords = []) {
  // Pro rychlovku vybíráme ze všech slov v harmonogramu
  let available = schedule.filter((s) => !excludeWords.includes(s.word));
  if (available.length === 0) {
    available = schedule;
  }
  const entry = available[Math.floor(Math.random() * available.length)];
  const dayData = loadDayData(entry.day, entry.word);
  return buildWordPayload(entry.day, entry.word, dayData, `Rychlovka (Slovo #${entry.day})`);
}

// Generování 3-5 náhodných minových slov pro dané kolo Rychlovky
function generateMineWords(targetWord, count = 4) {
  const commonMinePool = [
    'člověk', 'život', 'čas', 'rok', 'den', 'práce', 'cesta', 'oko', 'místo', 'svět',
    'voda', 'hlava', 'dům', 'stůl', 'auto', 'kniha', 'škola', 'peníze', 'město', 'slovo',
    'strom', 'země', 'ruka', 'noha', 'láska', 'tělo', 'dveře', 'okno', 'chléb', 'pes'
  ];
  const targetNorm = normalizeWord(targetWord);
  const candidates = commonMinePool.filter((w) => normalizeWord(w) !== targetNorm);
  const shuffled = [...candidates].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

// Získání konkrétního slova (např. při obnově stavu z disku)
function getSpecificWord(dayNumber, word) {
  if (!word) return null;
  const cleanWord = word.trim().toLowerCase();
  const scheduleEntry = schedule.find((s) => (dayNumber ? s.day === dayNumber : false) && s.word === cleanWord) || schedule.find((s) => s.word === cleanWord);
  if (!scheduleEntry) return null;
  const useDay = scheduleEntry.day;
  const useWord = scheduleEntry.word;
  const dayData = loadDayData(useDay, useWord);
  return buildWordPayload(useDay, useWord, dayData, `Archiv (Den #${useDay})`);
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
  const guessNorm = removeDiacritics(cleanGuess);

  // Přesný základní tvar má přednost před shodou bez diakritiky.
  if (cleanGuess === targetWord) {
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

  // Skloňování i časování sdílí rank a zobrazený základní tvar.
  const lemma = wordAliases[cleanGuess];
  if (lemma && dayData.exactMap.has(lemma)) {
    const rank = dayData.exactMap.get(lemma);
    return { isValid: true, isWinner: rank === 1, rank, word: lemma };
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

  const accentlessLemma = accentlessAliases.get(guessNorm);
  if (accentlessLemma && dayData.exactMap.has(accentlessLemma)) {
    const rank = dayData.exactMap.get(accentlessLemma);
    return { isValid: true, isWinner: rank === 1, rank, word: accentlessLemma };
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
  DATA_VERSION,
  getDailyWord,
  getRandomWord,
  getPastWordsPool,
  getUnlimitedWord,
  getSpeedrunWord,
  generateMineWords,
  getSpecificWord,
  calculateRank,
  getTop50,
  getBetterHintWord,
  normalizeWord,
  removeDiacritics,
  getCzechDateStr,
  getDayNumber
};
