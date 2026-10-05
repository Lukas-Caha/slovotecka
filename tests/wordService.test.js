const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const word = require('../src/wordService');
const root = path.join(__dirname, '..', 'vystup');

test('60 českých denních her začíná 5. října a končí 3. prosince', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, word.DATA_VERSION);
  assert.equal(manifest.days, 60);
  assert.equal(word.getDayNumber('2026-10-05'), 1);
  assert.equal(word.getDayNumber('2026-10-06'), 2);
  assert.equal(word.getDayNumber('2026-12-03'), 60);
  assert.equal(word.getCzechDateStr(new Date('2026-10-04T22:01:00Z')), '2026-10-05');
  assert.equal(word.getCzechDateStr(new Date('2026-10-25T23:01:00Z')), '2026-10-26');
  const targets = new Set();
  for (let day = 1; day <= 60; day++) {
    const date = new Date(Date.UTC(2026, 9, 5 + day - 1)).toISOString().slice(0, 10);
    const daily = word.getDailyWord(date);
    assert.equal(daily.dayNumber, day);
    assert.ok(!targets.has(daily.word));
    targets.add(daily.word);
    assert.equal(daily.dayData.exactMap.size, manifest.vocabularySize);
    assert.equal(daily.dayData.maxRank, manifest.vocabularySize);
    assert.equal(new Set(daily.dayData.exactMap.values()).size, manifest.vocabularySize);
    assert.equal(word.calculateRank(daily, daily.word).rank, 1);
    assert.equal(word.getTop50(daily).length, 50);
    assert.equal(daily.radarWord.rank, 150);
    assert.equal(word.getTop50(daily).filter(w => w.rank === 1).length, 1);
    for (const common of ['běžec', 'jídlo', 'motorka', 'tužka', 'brambor', 'kamarád', 'mrkev', 'počasí', 'ponožka', 'radost', 'ahoj', 'ano', 'běhat']) {
      assert.equal(word.calculateRank(daily, common).isValid, true, `${daily.word}: ${common}`);
    }
  }
});

test('skloňování a tipy bez diakritiky sdílejí jeden základní tvar', () => {
  const daily = word.getDailyWord('2026-10-05');
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
  const daily = word.getDailyWord('2026-10-05');
  assert.equal(word.calculateRank(daily, 'qzxqzxqzx').isValid, false);
  assert.equal(word.calculateRank(daily, 'abc123').isValid, false);
  assert.equal(word.getSpecificWord(1, 'obhospořodáváný'), null);
});
