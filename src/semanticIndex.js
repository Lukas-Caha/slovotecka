'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// Dictionary pages stay on disk. A bounded cache keeps the full paradigm list
// from becoming millions of JavaScript strings and objects at server startup.
class PagedWordIndex {
  constructor(directory, stem, vocabularySize, cacheLimit = 48) {
    const metadata = JSON.parse(fs.readFileSync(path.join(directory, `${stem}.pages.json`), 'utf8'));
    if (metadata.vocabularySize !== vocabularySize || !['WG-PAGES-1', 'WG-PAGES-2'].includes(metadata.format)) {
      throw new Error(`Invalid ${stem} dictionary metadata`);
    }
    this.count = metadata.count;
    this.pages = metadata.pages;
    const files = metadata.format === 'WG-PAGES-2' ? metadata.dataFiles : [metadata.dataFile];
    if (!Array.isArray(files) || files.length === 0) throw new Error(`Missing ${stem} dictionary files`);
    this.fds = [];
    try {
      for (const file of files) this.fds.push(fs.openSync(path.join(directory, file), 'r'));
    } catch (error) {
      for (const fd of this.fds) fs.closeSync(fd);
      throw error;
    }
    this.cache = new Map();
    this.cacheLimit = cacheLimit;
    this.vocabularySize = vocabularySize;
  }

  loadPage(number) {
    if (this.cache.has(number)) {
      const page = this.cache.get(number);
      this.cache.delete(number);
      this.cache.set(number, page);
      return page;
    }
    const descriptor = this.pages[number];
    const fd = this.fds[descriptor.file ?? 0];
    if (fd === undefined) throw new Error('Invalid semantic dictionary file');
    const packed = Buffer.allocUnsafe(descriptor.length);
    const bytes = fs.readSync(fd, packed, 0, packed.length, descriptor.offset);
    if (bytes !== packed.length) throw new Error('Truncated semantic dictionary page');
    const buffer = zlib.inflateSync(packed);
    if (buffer.toString('ascii', 0, 8) !== 'WGIDX001') throw new Error('Invalid semantic dictionary page');
    const count = buffer.readUInt32LE(8);
    const vocabularySize = buffer.readUInt32LE(12);
    if (count !== descriptor.count || vocabularySize !== this.vocabularySize) {
      throw new Error('Mismatched semantic dictionary page');
    }
    const valuesStart = 16 + 4 * (count + 1);
    const stringsStart = valuesStart + 4 * count;
    const finalOffset = buffer.readUInt32LE(16 + 4 * count);
    if (stringsStart + finalOffset !== buffer.length) throw new Error('Invalid semantic dictionary bounds');
    const page = { buffer, count, valuesStart, stringsStart };
    if (this.cache.size >= this.cacheLimit) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(number, page);
    return page;
  }

  lookup(word) {
    let low = 0;
    let high = this.pages.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.pages[middle].first <= word) low = middle + 1;
      else high = middle;
    }
    if (low === 0) return undefined;
    const page = this.loadPage(low - 1);
    const key = Buffer.from(word, 'utf8');
    low = 0;
    high = page.count - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const start = page.stringsStart + page.buffer.readUInt32LE(16 + middle * 4);
      const end = page.stringsStart + page.buffer.readUInt32LE(16 + (middle + 1) * 4);
      const comparison = key.compare(page.buffer, start, end);
      if (comparison === 0) {
        const value = page.buffer.readUInt32LE(page.valuesStart + middle * 4);
        if (value >= this.vocabularySize) throw new Error('Invalid semantic dictionary lemma ID');
        return value;
      }
      if (comparison < 0) high = middle - 1;
      else low = middle + 1;
    }
    return undefined;
  }
}

class RankedLexicon {
  constructor(store, ranks) {
    this.store = store;
    this.ranks = ranks;
    this.size = store.words.length;
  }
  has(word) { return this.store.wordIds.has(word); }
  get(word) {
    const id = this.store.wordIds.get(word);
    return id === undefined ? undefined : this.ranks[id];
  }
  *keys() { yield* this.store.words; }
  *values() { yield* this.ranks; }
  *entries() {
    for (let i = 0; i < this.size; i++) yield [this.store.words[i], this.ranks[i]];
  }
  [Symbol.iterator]() { return this.entries(); }
}

class SemanticStore {
  constructor(directory, manifest) {
    this.directory = directory;
    this.words = JSON.parse(fs.readFileSync(path.join(directory, 'lexicon.json'), 'utf8'));
    this.inputAliases = JSON.parse(fs.readFileSync(path.join(directory, 'input-aliases.json'), 'utf8'));
    if (this.words.length !== manifest.vocabularySize) throw new Error('Semantic vocabulary size mismatch');
    this.wordIds = new Map(this.words.map((word, id) => [word, id]));
    this.exact = new PagedWordIndex(directory, 'forms', this.words.length);
    this.accentless = new PagedWordIndex(directory, 'accentless', this.words.length);
  }

  loadDay(day, target, metadata) {
    const buffer = fs.readFileSync(path.join(this.directory, `den_${String(day).padStart(2, '0')}.ranks.bin`));
    const count = buffer.readUInt32LE(8);
    if (buffer.toString('ascii', 0, 8) !== 'WGRANK01' || count !== this.words.length || buffer.length !== 12 + 4 * count) {
      throw new Error(`Invalid semantic ranks for day ${day}`);
    }
    // An aligned copy avoids depending on a Buffer's allocation offset.
    const ranks = new Uint32Array(count);
    for (let i = 0; i < count; i++) ranks[i] = buffer.readUInt32LE(12 + 4 * i);
    const targetId = this.wordIds.get(target);
    if (targetId === undefined || ranks[targetId] !== 1) throw new Error(`Wrong semantic target for day ${day}`);
    const exactMap = new RankedLexicon(this, ranks);
    const top50 = [];
    const rankToWordMap = new Map();
    for (let id = 0; id < count; id++) {
      const rank = ranks[id];
      if (rank <= 50) top50.push({ rank, word: this.words[id] });
      if (rank <= 500) rankToWordMap.set(rank, this.words[id]);
    }
    top50.sort((a, b) => a.rank - b.rank);
    const radar = metadata?.radarWord;
    if (!radar || !exactMap.has(radar)) throw new Error(`Missing reviewed semantic hint for ${target}`);
    const normalizedMap = {
      has: word => this.accentless.lookup(word) !== undefined,
      get: word => {
        const id = this.accentless.lookup(word);
        return id === undefined ? undefined : { word: this.words[id], rank: ranks[id] };
      }
    };
    return {
      day, targetWord: target, exactMap, normalizedMap, top50, rankToWordMap,
      hintWords: new Set(metadata.hintWords),
      radarWord: { word: radar, rank: exactMap.get(radar) },
      maxRank: count, semanticStore: this, ranks
    };
  }
}

module.exports = { PagedWordIndex, RankedLexicon, SemanticStore };
