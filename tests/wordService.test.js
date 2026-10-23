const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const word = require('../src/wordService');
const root = path.join(__dirname, '..', 'vystup');

test('denní hry odpovídají datům a počtu dnů v manifestu', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, word.DATA_VERSION);
  const start = Date.parse(`${manifest.startDate}T00:00:00Z`);
  assert.equal(word.getDayNumber(manifest.startDate), 1);
  assert.equal(word.getDayNumber(new Date(start + 86400000).toISOString().slice(0, 10)), 2);
  assert.equal(word.getDayNumber(manifest.endDate), manifest.days);
  assert.equal(word.getCzechDateStr(new Date('2026-10-04T22:01:00Z')), '2026-10-05');
  assert.equal(word.getCzechDateStr(new Date('2026-10-25T23:01:00Z')), '2026-10-26');
  const targets = new Set();
  for (let day = 1; day <= manifest.days; day++) {
    const date = new Date(start + (day - 1) * 86400000).toISOString().slice(0, 10);
    const daily = word.getDailyWord(date);
    assert.equal(daily.dayNumber, day);
    assert.ok(!targets.has(daily.word));
    targets.add(daily.word);
    assert.equal(daily.dayData.exactMap.size, manifest.vocabularySize);
    assert.equal(daily.dayData.maxRank, manifest.vocabularySize);
    assert.equal(new Set(daily.dayData.exactMap.values()).size, manifest.vocabularySize);
    assert.equal(word.calculateRank(daily, daily.word).rank, 1);
    assert.equal(word.getTop50(daily).length, 50);
    assert.ok(daily.radarWord.rank >= 50 && daily.radarWord.rank <= 400);
    assert.equal(daily.dayData.exactMap.get(daily.radarWord.word), daily.radarWord.rank);
    assert.equal(word.getTop50(daily).filter(w => w.rank === 1).length, 1);
    for (const common of ['běžec', 'jídlo', 'motorka', 'tužka', 'brambor', 'kamarád', 'mrkev', 'počasí', 'ponožka', 'radost', 'ahoj', 'ano', 'běhat']) {
      assert.equal(word.calculateRank(daily, common).isValid, true, `${daily.word}: ${common}`);
    }
  }
});

test('skloňování a tipy bez diakritiky sdílejí jeden základní tvar', () => {
  const daily = word.getDailyWord(JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).startDate);
  for (const [lemma, forms] of [
    ['pes', ['psa', 'psovi', 'psem', 'psi']],
    ['běžec', ['běžci', 'běžcem', 'bezcem']],
    ['škola', ['školy', 'školou', 'skolou']],
    ['kočka', ['kočkou', 'kockou']]
  ]) {
    const canonical = word.calculateRank(daily, lemma);
    assert.equal(canonical.isValid, true);
    for (const form of forms) {
      assert.deepEqual(word.calculateRank(daily, form), canonical, form);
      assert.ok(!daily.dayData.exactMap.has(form), `${form} nesmí mít vlastní rank`);
    }
  }
});

test('významová blízkost, nápovědy a odmítání náhodných řetězců', () => {
  for (const [target, near, far] of [
    ['pes', 'kočka', 'parlament'],
    ['káva', 'čaj', 'lokomotiva'],
    ['vlak', 'lokomotiva', 'jahoda'],
    ['les', 'strom', 'klávesnice'],
    ['kniha', 'román', 'brzda']
  ]) {
    const daily = word.getSpecificWord(null, target);
    const close = word.calculateRank(daily, near);
    const distant = word.calculateRank(daily, far);
    assert.equal(close.isValid, true);
    assert.equal(distant.isValid, true);
    assert.ok(close.rank < distant.rank, `${target}: ${near} musí být blíž než ${far}`);
    const hint = word.getBetterHintWord(daily.dayData, 100, [daily.word]);
    assert.ok(hint.rank > 1 && hint.rank < 100);
  }
  const daily = word.getDailyWord(JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).startDate);
  assert.equal(word.calculateRank(daily, 'qzxqzxqzx').isValid, false);
  assert.equal(word.calculateRank(daily, 'abc123').isValid, false);
  assert.equal(word.getSpecificWord(1, 'obhospořodáváný'), null);
});

test('časté homonymní tvary mají smysluplný, na cíli nezávislý výklad', () => {
  const daily = word.getDailyWord(JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).startDate);
  for (const [guess, expected] of [['jeden', 'jeden'], ['tři', 'tři'], ['domu', 'dům'], ['nejlepší', 'dobrý']]) {
    assert.equal(word.calculateRank(daily, guess).word, expected, guess);
  }
  for (const guess of ['kafe', 'barista', 'čištění', 'karton', 'mozzarella']) {
    assert.equal(word.calculateRank(daily, guess).isValid, true, guess);
  }
  assert.deepEqual(word.calculateRank(daily, 'školou'.normalize('NFD')), word.calculateRank(daily, 'škola'));
  const coffee = word.getSpecificWord(null, 'káva');
  assert.equal(word.calculateRank(daily, 'stat').word, word.calculateRank(coffee, 'stat').word);
});

test('kontrolované nápovědy zachovávají pravdivé pořadí a zlepšují hráčův výsledek', () => {
  const schedule = fs.readFileSync(path.join(root, 'harmonogram.csv'), 'utf8').trim().split('\n').slice(1);
  for (const row of schedule) {
    const [day, target] = row.split(',');
    const daily = word.getSpecificWord(Number(day), target);
    for (const best of [3, 10, 30, 100, 300, 1000]) {
      const hint = word.getBetterHintWord(daily.dayData, best, [target]);
      assert.ok(hint.rank > 1 && hint.rank < best, `${target}/${best}: ${JSON.stringify(hint)}`);
      assert.equal(daily.dayData.exactMap.get(hint.word), hint.rank);
      assert.ok(daily.dayData.hintWords.has(hint.word));
    }
    assert.equal(word.getBetterHintWord(daily.dayData, 2).isAtRankTwo, true);
  }
});

test('všech 30 odpovědí lze zadat také bez diakritiky', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.days, 30);
  assert.equal(word.getDayNumber(manifest.startDate), 1);
  assert.equal(word.getDayNumber(manifest.endDate), 30);
  const targets = JSON.parse(fs.readFileSync(path.join(root, 'words.json'), 'utf8')).dailyTargetWords;
  for (const target of targets) {
    const daily = word.getSpecificWord(null, target);
    assert.equal(word.calculateRank(daily, word.removeDiacritics(target)).isWinner, true, target);
  }
});

test('široký slovník přijímá běžná slova, gramatické tvary a kontrolované nové výrazy', () => {
  const daily = word.getDailyWord('2026-10-23');
  const guesses = fs.readFileSync(path.join(__dirname, '../tools/semantic/common-guesses.txt'), 'utf8').trim().split('\n');
  for (const guess of [...guesses, 'covid', 'covidu', 'covidem', 'covidový', 'covidového', 'chatbot', 'chatbotem', 'chatgpt', 'chatgptu']) {
    const result = word.calculateRank(daily, guess);
    assert.equal(result.isValid, true, guess);
    assert.ok(result.rank >= 1 && result.rank <= daily.dayData.maxRank, guess);
  }
  for (const [form, lemma] of [['kočky', 'kočka'], ['králíky', 'králík'], ['psi', 'pes'], ['byt', 'byt'], ['být', 'být'], ['školou', 'škola']]) {
    assert.equal(word.calculateRank(daily, form).word, lemma, form);
  }
  for (const garbage of ['qzxqzxqzx', 'abc123', '<script>', '😀', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']) {
    assert.equal(word.calculateRank(daily, garbage).isValid, false, garbage);
  }
});

test('velké slovníkové indexy udržují omezenou cache stránek', () => {
  const daily = word.getDailyWord('2026-10-23');
  const store = daily.dayData.semanticStore;
  assert.ok(store.exact.count > 5000000);
  for (const index of [store.exact, store.accentless]) {
    for (let i = 0; i < index.pages.length; i += 11) {
      assert.notEqual(index.lookup(index.pages[i].first), undefined);
    }
    assert.ok(index.cache.size <= index.cacheLimit);
    assert.equal(index.lookup('qzxqzxqzx'), undefined);
  }
});

test('slovník načítá krajní stránky všech částí a zachovává jejich ID', () => {
  const store = word.getDailyWord('2026-10-23').dayData.semanticStore;
  for (const [stem, index] of [['forms', store.exact], ['accentless', store.accentless]]) {
    const metadata = JSON.parse(fs.readFileSync(path.join(root, `${stem}.pages.json`), 'utf8'));
    assert.equal(metadata.format, 'WG-PAGES-2');
    assert.ok(metadata.dataFiles.length > 1);
    for (let file = 0; file < metadata.dataFiles.length; file++) {
      assert.ok(fs.statSync(path.join(root, metadata.dataFiles[file])).size <= 6000000);
      const numbers = index.pages.flatMap((page, number) => page.file === file ? [number] : []);
      assert.ok(numbers.length > 0);
      for (const number of new Set([numbers[0], numbers[numbers.length - 1]])) {
        const page = index.loadPage(number);
        for (const row of [0, page.count - 1]) {
          const start = page.stringsStart + page.buffer.readUInt32LE(16 + row * 4);
          const end = page.stringsStart + page.buffer.readUInt32LE(16 + (row + 1) * 4);
          const spelling = page.buffer.toString('utf8', start, end);
          assert.equal(index.lookup(spelling), page.buffer.readUInt32LE(page.valuesStart + row * 4), spelling);
        }
      }
    }
  }
});
