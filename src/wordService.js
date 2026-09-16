const fs = require('fs');
const path = require('path');

const wordsData = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'words.json'), 'utf-8')
);

// Pomocná funkce pro odstranění české diakritiky (háčků a čárek)
function removeDiacritics(str) {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Očištění a normalizace vstupu
function normalizeWord(word) {
  if (!word || typeof word !== 'string') return '';
  return word.trim().toLowerCase();
}

// Stabilní deterministický hash pro neměnné pořadí
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(hash);
}

// Denní slovo podle aktuálního data (kalendářní den)
function getDailyWord() {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const hash = hashString(dateStr);
  const index = hash % wordsData.dailyTargetWords.length;
  const targetKey = wordsData.dailyTargetWords[index];
  const target = wordsData.targets[targetKey] || {
    word: targetKey,
    hint: 'Denní slovo',
    category: 'priroda',
    ranks: {}
  };

  return {
    key: targetKey,
    date: dateStr,
    word: target.word,
    hint: target.hint,
    category: target.category || 'priroda',
    ranks: target.ranks || {}
  };
}

// Náhodné slovo pro rychlá další kola
function getRandomWord() {
  const keys = wordsData.dailyTargetWords;
  const index = Math.floor(Math.random() * keys.length);
  const targetKey = keys[index];
  const target = wordsData.targets[targetKey];
  return {
    key: targetKey,
    date: 'náhodná hra',
    word: target.word,
    hint: target.hint,
    category: target.category || 'priroda',
    ranks: target.ranks || {}
  };
}

// Vyhledání sémantické kategorie slova v databázi
function findWordCategory(cleanGuess, guessNorm) {
  const clusters = wordsData.semanticClusters || {};
  for (const [category, words] of Object.entries(clusters)) {
    for (const w of words) {
      if (normalizeWord(w) === cleanGuess || removeDiacritics(w) === guessNorm) {
        return category;
      }
    }
  }

  // Zkontrolujeme také, zda slovo není přímo jedním z cílů
  for (const [targetKey, targetObj] of Object.entries(wordsData.targets)) {
    if (targetKey === cleanGuess || removeDiacritics(targetKey) === guessNorm) {
      return targetObj.category || null;
    }
  }

  return null;
}

// Hlavní výpočet sémantické blízkosti (1 = tajné slovo, menší číslo = větší významová blízkost)
function calculateRank(targetWordObj, userGuess) {
  const cleanGuess = normalizeWord(userGuess);
  if (!cleanGuess || cleanGuess.length < 2) {
    return { isValid: false, error: 'Slovo musí mít alespoň 2 písmena.' };
  }

  // Povolena pouze česká a latinská písmena
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

  // 2. Ručně kalibrované sémantické vazby pro dané slovo
  const ranks = targetWordObj.ranks || {};

  // Přesná shoda v ranku
  if (ranks[cleanGuess] !== undefined) {
    return {
      isValid: true,
      isWinner: false,
      rank: ranks[cleanGuess],
      word: cleanGuess
    };
  }

  // Shoda bez diakritiky v ranku (např. 'stene' najde 'štěně')
  for (const [rankedWord, rankValue] of Object.entries(ranks)) {
    if (removeDiacritics(rankedWord) === guessNorm) {
      return {
        isValid: true,
        isWinner: false,
        rank: rankValue,
        word: rankedWord
      };
    }
  }

  // 3. Kategoriální sémantické řazení (čistě podle významu, ŽÁDNÁ shoda písmen!)
  const targetCategory = targetWordObj.category || 'priroda';
  const guessCategory = findWordCategory(cleanGuess, guessNorm);

  const wordHash = hashString(targetNorm + ':' + guessNorm);

  if (guessCategory) {
    const affinities = wordsData.categoryAffinities?.[targetCategory] || {};
    const affinity = affinities[guessCategory] !== undefined ? affinities[guessCategory] : 3;

    let baseRank;
    let spread;

    switch (affinity) {
      case 0: // Stejná kategorie (např. jiné zvíře u psa, jiné jídlo u kávy)
        baseRank = 80;
        spread = 220; // 80 až 300
        break;
      case 1: // Velmi úzce související kategorie (např. příroda vs zvíře)
        baseRank = 350;
        spread = 450; // 350 až 800
        break;
      case 2: // Středně související kategorie
        baseRank = 850;
        spread = 700; // 850 až 1550
        break;
      case 3: // Vzdálenější kategorie
        baseRank = 1600;
        spread = 1000; // 1600 až 2600
        break;
      default: // Úplně nesouvisející kategorie (např. traktor u psa)
        baseRank = 2800;
        spread = 1500; // 2800 až 4300
        break;
    }

    const calculatedRank = baseRank + (wordHash % spread);
    return {
      isValid: true,
      isWinner: false,
      rank: calculatedRank,
      word: cleanGuess
    };
  }

  // 4. Ostatní slova v češtině (výrazně vzdálená, žádné náhodné skoky podle písmenek)
  const fallbackRank = 4500 + (wordHash % 4500); // 4500 až 9000
  return {
    isValid: true,
    isWinner: false,
    rank: fallbackRank,
    word: cleanGuess
  };
}

module.exports = {
  getDailyWord,
  getRandomWord,
  calculateRank,
  normalizeWord,
  removeDiacritics
};
