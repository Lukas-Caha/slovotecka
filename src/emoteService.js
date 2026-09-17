const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'data', '7tv_emotes.json');

// Vernaton999 IDs
const KICK_USER_ID = '93773597';
const SEVENTV_USER_ID = '01KFR6H2V83R0JE5H14JXS9PFM';

class EmoteService {
  constructor() {
    this.emotes = [];
    this.emoteMap = new Map();
  }

  async init() {
    // 1. Zkusíme načíst z lokální cache pro okamžitý start
    this.loadFromCache();

    // 2. V pozadí nebo při startu zkusíme stáhnout čerstvá data z 7TV API
    try {
      await this.refreshEmotes();
    } catch (err) {
      console.warn('Upozornění: Nepodařilo se stáhnout čerstvé 7TV emoty, používá se cache:', err.message);
    }
  }

  loadFromCache() {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
        const data = JSON.parse(raw);
        if (Array.isArray(data) && data.length > 0) {
          this.setEmotes(data);
          console.log(`[7TV] Načteno ${this.emotes.length} emotů z lokální cache.`);
        }
      }
    } catch (err) {
      console.error('[7TV] Chyba při čtení lokální cache emotů:', err.message);
    }
  }

  saveToCache(data) {
    try {
      const dir = path.dirname(CACHE_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf-8');
      console.log(`[7TV] Uloženo ${data.length} emotů do lokální cache.`);
    } catch (err) {
      console.error('[7TV] Chyba při ukládání cache emotů:', err.message);
    }
  }

  setEmotes(list) {
    this.emotes = list;
    this.emoteMap.clear();
    for (const emote of list) {
      this.emoteMap.set(emote.name, emote);
    }
  }

  async refreshEmotes() {
    console.log('[7TV] Stahuji emoty z 7TV API pro Vernaton999 (Kick i 7TV) a Globální sady...');

    const headers = { 'User-Agent': 'CeskyContextoGame/1.0' };
    const emoteMap = new Map();

    // 1. Globální 7TV emoty
    try {
      const res = await fetch('https://7tv.io/v3/emote-sets/global', { headers });
      if (res.ok) {
        const globalData = await res.json();
        for (const emote of (globalData.emotes || [])) {
          this.processEmoteItem(emote, emoteMap);
        }
      }
    } catch (err) {
      console.warn('[7TV] Chyba stahování globálních emotů:', err.message);
    }

    // 2. Vernaton999 z Kicku a 7TV profilu
    const setIds = new Set();

    // Kick profil
    try {
      const kickRes = await fetch(`https://7tv.io/v3/users/kick/${KICK_USER_ID}`, { headers });
      if (kickRes.ok) {
        const kickData = await kickRes.json();
        if (kickData.emote_set_id) setIds.add(kickData.emote_set_id);
        if (kickData.emote_set && kickData.emote_set.emotes) {
          for (const emote of kickData.emote_set.emotes) {
            this.processEmoteItem(emote, emoteMap);
          }
        }
      }
    } catch (err) {
      console.warn('[7TV] Chyba stahování Kick profilu Vernaton999:', err.message);
    }

    // 7TV uživatelský profil
    try {
      const tvRes = await fetch(`https://7tv.io/v3/users/${SEVENTV_USER_ID}`, { headers });
      if (tvRes.ok) {
        const tvData = await tvRes.json();
        if (Array.isArray(tvData.emote_sets)) {
          for (const s of tvData.emote_sets) {
            if (s.id) setIds.add(s.id);
          }
        }
      }
    } catch (err) {
      console.warn('[7TV] Chyba stahování 7TV profilu Vernaton999:', err.message);
    }

    // Stáhnout chybějící emote sety
    for (const setId of setIds) {
      try {
        const setRes = await fetch(`https://7tv.io/v3/emote-sets/${setId}`, { headers });
        if (setRes.ok) {
          const setData = await setRes.json();
          for (const emote of (setData.emotes || [])) {
            this.processEmoteItem(emote, emoteMap);
          }
        }
      } catch (err) {
        console.warn(`[7TV] Chyba stahování emote sady ${setId}:`, err.message);
      }
    }

    const mergedList = Array.from(emoteMap.values());
    if (mergedList.length > 0) {
      this.setEmotes(mergedList);
      this.saveToCache(mergedList);
      console.log(`[7TV] Úspěšně načteno celkem ${mergedList.length} unikátních 7TV emotů.`);
    }
  }

  processEmoteItem(item, map) {
    if (!item || !item.name) return;
    const name = item.name.trim();
    const id = item.id;
    if (!id || !name) return;

    // 7TV formát URL: https://cdn.7tv.app/emote/<id>/2x.webp
    const url = `https://cdn.7tv.app/emote/${id}/2x.webp`;
    const url1x = `https://cdn.7tv.app/emote/${id}/1x.webp`;
    const flags = item.flags || (item.data && item.data.flags) || 0;
    const isZeroWidth = (flags & 1) !== 0;

    map.set(name, {
      name,
      id,
      url,
      url1x,
      zeroWidth: isZeroWidth
    });
  }

  getEmotes() {
    return this.emotes;
  }
}

module.exports = new EmoteService();
