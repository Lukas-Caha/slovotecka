const fs = require('fs');
const path = require('path');

const wordsData = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'words.json'), 'utf-8')
);

// Helper to remove Czech diacritics (háčky, čárky) for flexible matching
function removeDiacritics(str) {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Clean and normalize input
function normalizeWord(word) {
  if (!word || typeof word !== 'string') return '';
  return word.trim().toLowerCase();
}

// Simple deterministic hash for string
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) & 0xffffffff;
  }
  return Math.abs(hash);
}

// Trigram similarity for fallback ranking (0.0 to 1.0)
function getTrigramSimilarity(a, b) {
  const normA = removeDiacritics(a);
  const normB = removeDiacritics(b);
  if (normA === normB) return 1.0;
  if (normA.length < 2 || normB.length < 2) return 0.0;

  const getTrigrams = (s) => {
    const padded = ` ${s} `;
    const trigrams = new Set();
    for (let i = 0; i < padded.length - 1; i++) {
      trigrams.add(padded.slice(i, i + 2));
    }
    return trigrams;
  };

  const setA = getTrigrams(normA);
  const setB = getTrigrams(normB);
  let matches = 0;
  for (const t of setA) {
    if (setB.has(t)) matches++;
  }
  return (2.0 * matches) / (setA.size + setB.size);
}

// Get the daily word based on current date
function getDailyWord() {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const hash = hashString(dateStr);
  const index = hash % wordsData.dailyTargetWords.length;
  const targetKey = wordsData.dailyTargetWords[index];
  const target = wordsData.targets[targetKey] || {
    word: targetKey,
    hint: 'Denní slovo',
    ranks: {}
  };

  return {
    key: targetKey,
    date: dateStr,
    word: target.word,
    hint: target.hint,
    ranks: target.ranks || {}
  };
}

// Get a random word for casual room rounds
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
    ranks: target.ranks || {}
  };
}

// Calculate the proximity rank of a guess relative to the target word
function calculateRank(targetWordObj, userGuess) {
  const cleanGuess = normalizeWord(userGuess);
  if (!cleanGuess || cleanGuess.length < 2) {
    return { isValid: false, error: 'Slovo musí mít alespoň 2 písmena.' };
  }

  // Check if string contains invalid characters (allow only Czech/Latin letters)
  const czechLetterRegex = /^[a-záčďéěíňóřšťúůýž]+$/i;
  if (!czechLetterRegex.test(cleanGuess)) {
    return { isValid: false, error: 'Slovo smí obsahovat pouze písmena.' };
  }

  const targetWord = normalizeWord(targetWordObj.word);
  const targetNorm = removeDiacritics(targetWord);
  const guessNorm = removeDiacritics(cleanGuess);

  // 1. Is it the winning target word?
  if (cleanGuess === targetWord || guessNorm === targetNorm) {
    return {
      isValid: true,
      isWinner: true,
      rank: 1,
      word: targetWordObj.word
    };
  }

  // 2. Is it in the precomputed semantic ranks for this target?
  const ranks = targetWordObj.ranks || {};
  // Check exact
  if (ranks[cleanGuess] !== undefined) {
    return {
      isValid: true,
      isWinner: false,
      rank: ranks[cleanGuess],
      word: cleanGuess
    };
  }

  // Check unaccented match in precomputed ranks
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

  // 3. Check if it's in the common Czech dictionary or known targets
  const isCommonWord = wordsData.commonCzechWords.some(
    (w) => normalizeWord(w) === cleanGuess || removeDiacritics(w) === guessNorm
  );

  const isOtherTarget = Object.keys(wordsData.targets).some(
    (t) => t === cleanGuess || removeDiacritics(t) === guessNorm
  );

  // Calculate stable deterministic fallback rank
  const similarity = getTrigramSimilarity(targetWord, cleanGuess);
  const pairHash = hashString(targetNorm + ':' + guessNorm) % 2000;

  let computedRank;
  if (isCommonWord || isOtherTarget) {
    // Known Czech word, ranks from 350 to 3500 based on similarity
    const baseRank = Math.round(350 + (1.0 - similarity) * 2000 + (pairHash % 500));
    computedRank = Math.max(350, baseRank);
  } else {
    // Other valid words, ranks from 1500 to 9500
    const baseRank = Math.round(1500 + (1.0 - similarity) * 5000 + pairHash);
    computedRank = Math.max(1200, baseRank);
  }

  return {
    isValid: true,
    isWinner: false,
    rank: computedRank,
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
