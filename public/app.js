const socket = io();

// ── Přepínač Light / Dark módu (Slunce vlevo, posuvník, Měsíc vpravo) ─────
const btnThemeToggle = document.getElementById('btn-theme-toggle');
const themeSunBtn = document.getElementById('theme-sun-btn');
const themeMoonBtn = document.getElementById('theme-moon-btn');

function getPreferredTheme() {
  const saved = localStorage.getItem('slovotecka_theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return 'dark'; // Výchozí je temný Grunge Brutal styl
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem('slovotecka_theme', theme);
  } catch (e) {}

  if (btnThemeToggle) {
    btnThemeToggle.setAttribute('aria-checked', theme === 'dark' ? 'false' : 'true');
    btnThemeToggle.title = theme === 'dark' ? 'Přepnout na světlý režim' : 'Přepnout na tmavý režim';
  }

  const metaColorScheme = document.querySelector('meta[name="color-scheme"]');
  if (metaColorScheme) {
    metaColorScheme.setAttribute('content', theme === 'dark' ? 'dark' : 'light');
  }
}

let currentTheme = getPreferredTheme();
applyTheme(currentTheme);

if (btnThemeToggle) {
  btnThemeToggle.addEventListener('click', () => {
    SoundFx.playKeyClick();
    currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(currentTheme);
  });
}

if (themeSunBtn) {
  themeSunBtn.addEventListener('click', () => {
    if (currentTheme !== 'light') {
      SoundFx.playKeyClick();
      currentTheme = 'light';
      applyTheme(currentTheme);
    }
  });
}

if (themeMoonBtn) {
  themeMoonBtn.addEventListener('click', () => {
    if (currentTheme !== 'dark') {
      SoundFx.playKeyClick();
      currentTheme = 'dark';
      applyTheme(currentTheme);
    }
  });
}

// ── Retro Audio Synthesizer (Zero-latency Web Audio API) ─────────────────
const SoundFx = (() => {
  let ctx = null;
  let enabled = localStorage.getItem('slovotecka_sound') !== 'false'; // default zapnuto

  function getCtx() {
    if (!ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        ctx = new AudioCtx();
      }
    }
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  function isEnabled() {
    return enabled;
  }

  function toggle() {
    enabled = !enabled;
    try {
      localStorage.setItem('slovotecka_sound', enabled ? 'true' : 'false');
    } catch (e) {}
    if (enabled) {
      playKeyClick();
    }
    return enabled;
  }

  // 1. Mechanické cvaknutí klávesy / tlačítka
  function playKeyClick() {
    if (!enabled) return;
    const c = getCtx();
    if (!c) return;
    try {
      const osc = c.createOscillator();
      const gain = c.createGain();
      const t = c.currentTime;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1400, t);
      osc.frequency.exponentialRampToValueAtTime(300, t + 0.015);
      gain.gain.setValueAtTime(0.06, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.015);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(t);
      osc.stop(t + 0.015);
    } catch (e) {}
  }

  // 2. Odeslání tipu – mechanické relé
  function playSubmit() {
    if (!enabled) return;
    const c = getCtx();
    if (!c) return;
    try {
      const osc = c.createOscillator();
      const gain = c.createGain();
      const t = c.currentTime;
      osc.type = 'square';
      osc.frequency.setValueAtTime(180, t);
      osc.frequency.exponentialRampToValueAtTime(45, t + 0.035);
      gain.gain.setValueAtTime(0.07, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(t);
      osc.stop(t + 0.035);
    } catch (e) {}
  }

  // 3. Zelená zóna (# <= 300) – teplý retro akord
  function playHot() {
    if (!enabled) return;
    const c = getCtx();
    if (!c) return;
    try {
      const t = c.currentTime;
      [659.25, 987.77].forEach((freq, i) => { // E5 + B5
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t + i * 0.03);
        gain.gain.setValueAtTime(0.09, t + i * 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start(t + i * 0.03);
        osc.stop(t + 0.35);
      });
    } catch (e) {}
  }

  // 4. Jantarová zóna (# <= 1500) – analogový tón
  function playWarm() {
    if (!enabled) return;
    const c = getCtx();
    if (!c) return;
    try {
      const t = c.currentTime;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, t); // A4 -> E5
      osc.frequency.exponentialRampToValueAtTime(659.25, t + 0.1);
      gain.gain.setValueAtTime(0.08, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(t);
      osc.stop(t + 0.16);
    } catch (e) {}
  }

  // 5. Červená / studená zóna (# > 1500) – nízký tape thud
  function playCold() {
    if (!enabled) return;
    const c = getCtx();
    if (!c) return;
    try {
      const t = c.currentTime;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(110, t);
      osc.frequency.exponentialRampToValueAtTime(55, t + 0.1);
      gain.gain.setValueAtTime(0.07, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(t);
      osc.stop(t + 0.1);
    } catch (e) {}
  }

  // 6. Vítězství (#1) – triumfální retro arpeggio
  function playWin() {
    if (!enabled) return;
    const c = getCtx();
    if (!c) return;
    try {
      const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        const osc = c.createOscillator();
        const gain = c.createGain();
        const t = c.currentTime + idx * 0.08;
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.12, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start(t);
        osc.stop(t + 0.45);
      });
    } catch (e) {}
  }

  // 7. Chyba / Neznámé slovo – cvaknutí pásky
  function playError() {
    if (!enabled) return;
    const c = getCtx();
    if (!c) return;
    try {
      [0, 0.06].forEach((delay) => {
        const osc = c.createOscillator();
        const gain = c.createGain();
        const t = c.currentTime + delay;
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(130, t);
        gain.gain.setValueAtTime(0.07, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start(t);
        osc.stop(t + 0.04);
      });
    } catch (e) {}
  }

  return {
    isEnabled,
    toggle,
    playKeyClick,
    playSubmit,
    playHot,
    playWarm,
    playCold,
    playWin,
    playError
  };
})();

// DOM – Přepínač zvuku
const btnSoundToggle = document.getElementById('btn-sound-toggle');
const soundToggleIcon = document.getElementById('sound-toggle-icon');
const soundToggleText = document.getElementById('sound-toggle-text');

function updateSoundUI() {
  const on = SoundFx.isEnabled();
  if (soundToggleIcon) soundToggleIcon.textContent = on ? '🔊' : '🔇';
  if (soundToggleText) soundToggleText.textContent = on ? 'ZVUK' : 'TICHO';
  if (btnSoundToggle) {
    btnSoundToggle.title = on ? 'Zvukové efekty zapnuty (kliknutím ztlumíš)' : 'Zvukové efekty ztlumeny (kliknutím zapneš)';
    btnSoundToggle.classList.toggle('is-muted', !on);
  }
}
updateSoundUI();

if (btnSoundToggle) {
  btnSoundToggle.addEventListener('click', () => {
    SoundFx.toggle();
    updateSoundUI();
  });
}

// Detekce režimu podle URL adresy a parametrů
const urlParams = new URLSearchParams(window.location.search);
const roomParam = urlParams.get('room') || urlParams.get('custom');
const customPathMatch = window.location.pathname.match(/^\/(?:custom|room)\/([a-zA-Z0-9_-]+)/i);
const urlCustomCode = (roomParam || (customPathMatch ? customPathMatch[1] : '')).toUpperCase().trim();

const isUnlimited = window.location.pathname.startsWith('/unlimited');
const isInitialCustom = Boolean(urlCustomCode);
let currentMode = isUnlimited ? 'unlimited' : (isInitialCustom ? `custom_${urlCustomCode}` : 'daily');
let selectedLobbyMode = isUnlimited ? 'unlimited' : (isInitialCustom ? 'custom' : 'daily');

// Globální stav
let myPlayerName = localStorage.getItem('slovotecka_nickname') || '';

// DOM – Navigace
const tabDaily = document.getElementById('tab-daily');
const tabUnlimited = document.getElementById('tab-unlimited');
const tabCustom = document.getElementById('tab-custom');

// DOM – Lobby
const lobbySection = document.getElementById('lobby-section');
const gameSection = document.getElementById('game-section');
const joinForm = document.getElementById('join-form');
const playerNameInput = document.getElementById('player-name');
const lobbyTag = document.getElementById('lobby-tag');
const lobbyTitle = document.getElementById('lobby-title');
const lobbyDesc = document.getElementById('lobby-desc');

// DOM – Přehled hráčů v aréně (Lobby)
const arenaLiveTotal = document.getElementById('arena-live-total');
const countDaily = document.getElementById('count-daily');
const unitDaily = document.getElementById('unit-daily');
const countUnlimited = document.getElementById('count-unlimited');
const unitUnlimited = document.getElementById('unit-unlimited');
const countCustom = document.getElementById('count-custom');
const unitCustom = document.getElementById('unit-custom');
const cardModeDaily = document.getElementById('card-mode-daily');
const cardModeUnlimited = document.getElementById('card-mode-unlimited');
const cardModeCustom = document.getElementById('card-mode-custom');

// DOM – Prvky Vlastní arény v lobby i ve hře
const customRoomPanel = document.getElementById('custom-room-panel');
const customCodeInput = document.getElementById('custom-code-input');
const btnCreateCustomRoom = document.getElementById('btn-create-custom-room');
const customShareBadge = document.getElementById('custom-share-badge');
const displayCustomCode = document.getElementById('display-custom-code');
const btnCopyRoomLink = document.getElementById('btn-copy-room-link');

function setLobbyMode(mode) {
  selectedLobbyMode = mode;
  const navTop50 = document.getElementById('btn-nav-top50');
  if (navTop50) navTop50.style.display = 'none';
  if (mode === 'daily') {
    currentMode = 'daily';
    if (tabDaily) tabDaily.classList.add('active');
    if (tabUnlimited) tabUnlimited.classList.remove('active');
    if (tabCustom) tabCustom.classList.remove('active');
    if (cardModeDaily) cardModeDaily.classList.add('is-current');
    if (cardModeUnlimited) cardModeUnlimited.classList.remove('is-current');
    if (cardModeCustom) cardModeCustom.classList.remove('is-current');
    if (customRoomPanel) customRoomPanel.style.display = 'none';
    if (lobbyTag) lobbyTag.textContent = '[ 01. REGISTRACE DO HRY ]';
    if (lobbyTitle) lobbyTitle.textContent = 'DNEŠNÍ SPOLEČNÁ VÝZVA';
    if (lobbyDesc) lobbyDesc.textContent = 'Zadej své jméno nebo přezdívku a zapoj se do společného hádání se všemi, kdo jsou právě v aréně.';
  } else if (mode === 'unlimited') {
    currentMode = 'unlimited';
    if (tabUnlimited) tabUnlimited.classList.add('active');
    if (tabDaily) tabDaily.classList.remove('active');
    if (tabCustom) tabCustom.classList.remove('active');
    if (cardModeUnlimited) cardModeUnlimited.classList.add('is-current');
    if (cardModeDaily) cardModeDaily.classList.remove('is-current');
    if (cardModeCustom) cardModeCustom.classList.remove('is-current');
    if (customRoomPanel) customRoomPanel.style.display = 'none';
    if (lobbyTag) lobbyTag.textContent = '[ 01. UNLIMITED ARÉNA ]';
    if (lobbyTitle) lobbyTitle.textContent = 'NEOMEZENÁ ARCHIVNÍ ARÉNA';
    if (lobbyDesc) lobbyDesc.textContent = 'Hrajte společně se slovy z předchozích dnů. Hráči v místnosti mohou společným hlasováním kdykoliv vylosovat nové slovo!';
  } else if (mode === 'custom') {
    if (tabCustom) tabCustom.classList.add('active');
    if (tabDaily) tabDaily.classList.remove('active');
    if (tabUnlimited) tabUnlimited.classList.remove('active');
    if (cardModeCustom) cardModeCustom.classList.add('is-current');
    if (cardModeDaily) cardModeDaily.classList.remove('is-current');
    if (cardModeUnlimited) cardModeUnlimited.classList.remove('is-current');
    if (customRoomPanel) customRoomPanel.style.display = 'flex';
    if (lobbyTag) lobbyTag.textContent = '[ 01. VLASTNÍ ARÉNA ]';
    if (lobbyTitle) lobbyTitle.textContent = 'VLASTNÍ PRIVÁTNÍ MÍSTNOST';
    if (lobbyDesc) lobbyDesc.textContent = 'Vytvoř si vlastní místnost s odkazem pro přátele. Můžete hrát dnešní slovo i archivní slova a pouštět si hudbu!';
  }
}

// Inicializace počátečního režimu
setLobbyMode(selectedLobbyMode);

if (urlCustomCode && customCodeInput) {
  customCodeInput.value = urlCustomCode;
}

if (cardModeDaily) {
  cardModeDaily.addEventListener('click', (e) => {
    if (window.location.pathname.startsWith('/unlimited') || urlCustomCode) {
      return; // Necháme standardní navigaci
    }
    e.preventDefault();
    SoundFx.playKeyClick();
    setLobbyMode('daily');
  });
}

if (cardModeUnlimited) {
  cardModeUnlimited.addEventListener('click', (e) => {
    if (!window.location.pathname.startsWith('/unlimited')) {
      return; // Necháme přechod na /unlimited
    }
    e.preventDefault();
    SoundFx.playKeyClick();
    setLobbyMode('unlimited');
  });
}

if (cardModeCustom) {
  cardModeCustom.addEventListener('click', (e) => {
    e.preventDefault();
    SoundFx.playKeyClick();
    setLobbyMode('custom');
  });
}

if (tabCustom) {
  tabCustom.addEventListener('click', (e) => {
    e.preventDefault();
    SoundFx.playKeyClick();
    setLobbyMode('custom');
  });
}

if (btnCreateCustomRoom) {
  btnCreateCustomRoom.addEventListener('click', () => {
    SoundFx.playKeyClick();
    const sourceRadio = document.querySelector('input[name="custom-word-source"]:checked');
    const wordSource = sourceRadio ? sourceRadio.value : 'daily';
    socket.emit('create_custom_room', { wordSource });
  });
}

socket.on('custom_room_created', (data) => {
  if (customCodeInput) {
    customCodeInput.value = data.roomCode;
  }
  currentMode = data.mode;
  showToast(`✨ Vytvořena aréna ${data.roomCode}! Nyní klikni na Vstoupit do arény.`);
  if (playerNameInput) playerNameInput.focus();
});

if (btnCopyRoomLink) {
  btnCopyRoomLink.addEventListener('click', () => {
    SoundFx.playKeyClick();
    const code = displayCustomCode ? displayCustomCode.textContent.trim() : '';
    const shareUrl = `${window.location.origin}/?room=${code}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareUrl).then(() => {
        showToast(`📋 Odkaz na arénu ${code} byl zkopírován do schránky!`);
      }).catch(() => {
        prompt('Zkopíruj si odkaz na arénu:', shareUrl);
      });
    } else {
      prompt('Zkopíruj si odkaz na arénu:', shareUrl);
    }
  });
}

// DOM – Výběr barvy hráče (přes ozubené kolo)
const colorPalette = document.getElementById('color-palette');
const colorSelectedBadge = document.getElementById('color-selected-badge');
const playerColorInput = document.getElementById('player-color-input');
const previewDot = document.getElementById('preview-dot');
const btnToggleColorPicker = document.getElementById('btn-toggle-color-picker');
const colorPickerPopover = document.getElementById('color-picker-popover');

let myPlayerColor = localStorage.getItem('slovotecka_color') || '#3b82f6';

function getPlayerPlural(count) {
  if (count === 1) return 'hráč';
  if (count >= 2 && count <= 4) return 'hráči';
  return 'hráčů';
}

function updateLobbyArenaStats(counts) {
  if (!counts) return;
  const d = counts.daily || 0;
  const u = counts.unlimited || 0;
  const c = counts.customRooms || 0;
  const tot = d + u + (counts.customPlayers || 0);

  if (countDaily) countDaily.textContent = d;
  if (unitDaily) unitDaily.textContent = getPlayerPlural(d);
  if (countUnlimited) countUnlimited.textContent = u;
  if (unitUnlimited) unitUnlimited.textContent = getPlayerPlural(u);
  if (countCustom) countCustom.textContent = c;
  if (unitCustom) unitCustom.textContent = c === 1 ? 'aréna' : (c >= 2 && c <= 4 ? 'arény' : 'arén');
  if (arenaLiveTotal) {
    arenaLiveTotal.textContent = `${tot} ${getPlayerPlural(tot).toUpperCase()} ONLINE`;
  }
}

function updatePlayerColorUI(color, name) {
  myPlayerColor = color;
  try {
    localStorage.setItem('slovotecka_color', color);
  } catch (e) {}

  if (playerColorInput) playerColorInput.value = color;

  if (colorPalette) {
    const swatches = colorPalette.querySelectorAll('.color-swatch-btn');
    swatches.forEach(btn => {
      const isSel = btn.dataset.color.toLowerCase() === color.toLowerCase();
      btn.classList.toggle('is-selected', isSel);
      if (isSel && !name && btn.dataset.name) {
        name = btn.dataset.name;
      }
    });
  }

  if (colorSelectedBadge) {
    colorSelectedBadge.textContent = `[ ${(name || 'MODRÁ').toUpperCase()} ]`;
    colorSelectedBadge.style.color = color;
  }

  if (previewDot) {
    previewDot.style.backgroundColor = color;
    previewDot.style.boxShadow = `0 0 8px ${color}`;
  }
}

if (btnToggleColorPicker && colorPickerPopover) {
  btnToggleColorPicker.addEventListener('click', (e) => {
    e.stopPropagation();
    const isShown = colorPickerPopover.style.display !== 'none';
    colorPickerPopover.style.display = isShown ? 'none' : 'block';
  });

  document.addEventListener('click', (e) => {
    if (colorPickerPopover.style.display !== 'none' && !colorPickerPopover.contains(e.target) && e.target !== btnToggleColorPicker) {
      colorPickerPopover.style.display = 'none';
    }
  });
}

if (colorPalette) {
  colorPalette.addEventListener('click', (e) => {
    const btn = e.target.closest('.color-swatch-btn');
    if (!btn) return;
    updatePlayerColorUI(btn.dataset.color, btn.dataset.name);
    if (colorPickerPopover) {
      colorPickerPopover.style.display = 'none';
    }
  });
}

// Inicializace barvy při načtení
updatePlayerColorUI(myPlayerColor);

// DOM – Včerejší rekapitulace v Lobby (po půlnoci)
const lobbyYesterdayRecap = document.getElementById('lobby-yesterday-recap');

function renderYesterdayRecap(recap) {
  if (!lobbyYesterdayRecap) return;
  if (!recap || !recap.word) {
    lobbyYesterdayRecap.style.display = 'none';
    return;
  }

  const word = (recap.word || '').toUpperCase();
  const dayNumStr = recap.dayNumber ? `#${recap.dayNumber}` : '';

  let statsHtml = '';
  if (recap.winner) {
    const pCount = recap.winner.guessCount || 1;
    statsHtml += `
      <div class="yesterday-stat-item">
        <span class="yesterday-stat-label">🏆 VÍTĚZ DNE</span>
        <span class="yesterday-stat-val" style="${recap.winner.color ? 'color: ' + escapeHtml(recap.winner.color) + ';' : ''}">
          ${escapeHtml(recap.winner.name)} (${pCount} ${pCount === 1 ? 'tip' : (pCount >= 2 && pCount <= 4 ? 'tipy' : 'tipů')})
        </span>
      </div>
    `;
  }

  if (recap.worstGuess) {
    statsHtml += `
      <div class="yesterday-stat-item">
        <span class="yesterday-stat-label">💀 MIMO MÍSU</span>
        <span class="yesterday-stat-val" title="${escapeHtml(recap.worstGuess.player)}: ${escapeHtml(recap.worstGuess.word)} (#${recap.worstGuess.rank})">
          ${escapeHtml(recap.worstGuess.player)}: "${escapeHtml(recap.worstGuess.word)}" (#${recap.worstGuess.rank})
        </span>
      </div>
    `;
  }

  if (recap.clown) {
    statsHtml += `
      <div class="yesterday-stat-item">
        <span class="yesterday-stat-label">🤡 KLAUN (NÁPOVĚDA)</span>
        <span class="yesterday-stat-val">${escapeHtml(recap.clown.name)}</span>
      </div>
    `;
  }

  if (recap.maxGuesser) {
    statsHtml += `
      <div class="yesterday-stat-item">
        <span class="yesterday-stat-label">⌨️ STROJ NA TIPY</span>
        <span class="yesterday-stat-val">${escapeHtml(recap.maxGuesser.name)} (${recap.maxGuesser.guessCount} tipů)</span>
      </div>
    `;
  }

  if (!statsHtml) {
    statsHtml = `
      <div class="yesterday-stat-item" style="grid-column: 1 / -1;">
        <span class="yesterday-stat-val" style="color: var(--color-base-600);">Včera se nikdo nezúčastnil.</span>
      </div>
    `;
  }

  lobbyYesterdayRecap.innerHTML = `
    <div class="yesterday-head">
      <span class="yesterday-tag">[ 📜 VÝSLEDKY VČEREJŠKA ${dayNumStr} ]</span>
      <span class="yesterday-word-badge">#1 ${escapeHtml(word)}</span>
    </div>
    <div class="yesterday-stats-grid">
      ${statsHtml}
    </div>
  `;

  lobbyYesterdayRecap.style.display = 'block';
}

// Načtení včerejších výsledků z API
fetch('/api/yesterday-recap')
  .then(res => res.ok ? res.json() : null)
  .then(data => { if (data) renderYesterdayRecap(data); })
  .catch(() => {});

let latestGlobalOnlineData = null;

function updateHeaderPlayersCount() {
  const inGame = gameSection && gameSection.style.display !== 'none' && latestGameState?.players;
  let count = 1;
  if (inGame) {
    count = latestGameState.players.length;
  } else if (latestGlobalOnlineData && typeof latestGlobalOnlineData.total === 'number') {
    count = latestGlobalOnlineData.total;
  }
  if (headerPlayersCount) headerPlayersCount.textContent = count;
  const floatingPlayersCount = document.getElementById('floating-players-count');
  if (floatingPlayersCount) floatingPlayersCount.textContent = count;
}

// Posluchač socketu pro živé aktualizace počtů hráčů v aréně
socket.on('arena_counts', (counts) => {
  latestGlobalOnlineData = counts;
  updateLobbyArenaStats(counts);
  updateHeaderPlayersCount();
  if (playersPopover && playersPopover.style.display !== 'none') {
    renderPlayersPopover();
  }
});

// Počáteční načtení statistik arény přes API
fetch('/api/arena-stats')
  .then(res => res.ok ? res.json() : null)
  .then(data => {
    if (data) {
      latestGlobalOnlineData = data;
      updateLobbyArenaStats(data);
      updateHeaderPlayersCount();
      if (playersPopover && playersPopover.style.display !== 'none') {
        renderPlayersPopover();
      }
    }
  })
  .catch(() => {});

// DOM – Popup Whats New
const whatsNewModal = document.getElementById('whats-new-modal');
const btnCloseWhatsNew = document.getElementById('btn-close-whats-new');
const btnAckWhatsNew = document.getElementById('btn-ack-whats-new');
const btnOpenWhatsNew = document.getElementById('btn-open-whats-new');

function showWhatsNew() {
  if (whatsNewModal) whatsNewModal.style.display = 'flex';
}

function hideWhatsNew() {
  if (whatsNewModal) whatsNewModal.style.display = 'none';
}

if (btnCloseWhatsNew) btnCloseWhatsNew.addEventListener('click', hideWhatsNew);
if (btnAckWhatsNew) btnAckWhatsNew.addEventListener('click', hideWhatsNew);
if (btnOpenWhatsNew) btnOpenWhatsNew.addEventListener('click', showWhatsNew);
if (whatsNewModal) {
  whatsNewModal.addEventListener('click', (e) => {
    if (e.target === whatsNewModal) hideWhatsNew();
  });
}

// Automatické zobrazení okna WHATS NEW na lobby
showWhatsNew();

// DOM – Hra
const displayModeLabel = document.getElementById('display-mode-label');
const displayDayTitle = document.getElementById('display-day-title');
const displayDate = document.getElementById('display-date');
const displayMetaText = document.getElementById('display-meta-text');
const displayHint = document.getElementById('display-hint');
const hintLocked = document.getElementById('hint-locked');
const hintRevealed = document.getElementById('hint-revealed');
const btnShowHint = document.getElementById('btn-show-hint');
const secretWordBox = document.getElementById('secret-word-box');
const displaySecretWord = document.getElementById('display-secret-word');
const secretLabel = document.getElementById('secret-label');

// DOM – Hlasování pro Unlimited mód
const voteBar = document.getElementById('vote-bar');
const voteCountBadge = document.getElementById('vote-count-badge');
const voteDesc = document.getElementById('vote-desc');
const btnVoteNewWord = document.getElementById('btn-vote-new-word');
const btnVoteText = document.getElementById('btn-vote-text');

const playersList = document.getElementById('players-list');
const guessInput = document.getElementById('guess-input');
const btnSubmitGuess = document.getElementById('btn-submit-guess');
const btnRevealWord = document.getElementById('btn-reveal-word');
const guessFeedback = document.getElementById('guess-feedback');
const guessesList = document.getElementById('guesses-list');
const guessesCount = document.getElementById('guesses-count');
const toastContainer = document.getElementById('toast-container');

// DOM – Divácký mód (Spectator)
const spectatorToolbar = document.getElementById('spectator-toolbar');
const spectatorBanner = document.getElementById('spectator-banner');
const spectatorFilterTabs = document.getElementById('spectator-filter-tabs');
const btnFilterAll = document.getElementById('btn-filter-all');
const btnFilterMine = document.getElementById('btn-filter-mine');
const guessesTitle = document.getElementById('guesses-title');
let spectatorFilterMode = 'all'; // 'all' | 'mine'
let latestGameState = null;

if (btnFilterAll) {
  btnFilterAll.addEventListener('click', () => {
    spectatorFilterMode = 'all';
    btnFilterAll.classList.add('is-active');
    if (btnFilterMine) btnFilterMine.classList.remove('is-active');
    if (latestGameState) renderGameState(latestGameState);
  });
}

if (btnFilterMine) {
  btnFilterMine.addEventListener('click', () => {
    spectatorFilterMode = 'mine';
    btnFilterMine.classList.add('is-active');
    if (btnFilterAll) btnFilterAll.classList.remove('is-active');
    if (latestGameState) renderGameState(latestGameState);
  });
}

// DOM – TOP 50 Modal
const top50Modal = document.getElementById('top50-modal');
const btnShowTop50 = document.getElementById('btn-show-top50');
const btnCloseTop50 = document.getElementById('btn-close-top50');
const btnAckTop50 = document.getElementById('btn-ack-top50');
const top50Grid = document.getElementById('top50-grid');
const top50SecretBadge = document.getElementById('top50-secret-badge');
let currentTop50Data = null;

function showTop50Modal() {
  if (top50Modal) top50Modal.style.display = 'flex';
}

function hideTop50Modal() {
  if (top50Modal) top50Modal.style.display = 'none';
}

if (btnCloseTop50) btnCloseTop50.addEventListener('click', hideTop50Modal);
if (btnAckTop50) btnAckTop50.addEventListener('click', hideTop50Modal);
if (top50Modal) {
  top50Modal.addEventListener('click', (e) => {
    if (e.target === top50Modal) hideTop50Modal();
  });
}

// ── DOM & Logika: Osobní profil & retro pas hráče (Stats Modal) ─────────
const statsModal = document.getElementById('stats-modal');
const btnOpenStats = document.getElementById('btn-open-stats');
const btnCloseStats = document.getElementById('btn-close-stats');
const btnAckStats = document.getElementById('btn-ack-stats');

const PlayerStats = (() => {
  function getStorageKey() {
    const name = (myPlayerName || '').trim().toLowerCase();
    return name ? `slovotecka_player_stats_${name}` : 'slovotecka_player_stats';
  }

  function getStats() {
    const key = getStorageKey();
    try {
      const data = localStorage.getItem(key) || (key !== 'slovotecka_player_stats' ? localStorage.getItem('slovotecka_player_stats') : null);
      if (data) {
        return JSON.parse(data);
      }
    } catch (e) {}
    return {
      gamesPlayed: 0,
      gamesWon: 0,
      currentStreak: 0,
      maxStreak: 0,
      lastWinDate: null,
      totalWinningGuesses: 0,
      bestScore: null,
      recordedPlayedGames: [],
      recordedWonGames: []
    };
  }

  function saveStats(stats) {
    try {
      localStorage.setItem(getStorageKey(), JSON.stringify(stats));
    } catch (e) {}
  }

  function recordGameEntry(gameId) {
    if (!gameId) return;
    const stats = getStats();
    if (!stats.recordedPlayedGames) stats.recordedPlayedGames = [];
    if (!stats.recordedPlayedGames.includes(gameId)) {
      stats.recordedPlayedGames.push(gameId);
      if (stats.recordedPlayedGames.length > 100) stats.recordedPlayedGames.shift();
      stats.gamesPlayed = (stats.gamesPlayed || 0) + 1;
      saveStats(stats);
    }
  }

  function recordGameWin(gameId, guessesCount) {
    if (!gameId) return;
    const stats = getStats();
    if (!stats.recordedWonGames) stats.recordedWonGames = [];
    if (stats.recordedWonGames.includes(gameId)) {
      return; // Výhra v této konkrétní hře již byla zaznamenána
    }
    stats.recordedWonGames.push(gameId);
    if (stats.recordedWonGames.length > 100) stats.recordedWonGames.shift();

    stats.gamesWon = (stats.gamesWon || 0) + 1;

    // Denní série (streak) podle kalendářních dnů (započítává se i z custom roomek hrajících denní slovo)
    const isDaily = gameId.startsWith('daily_') || gameId.startsWith('custom_daily_');
    if (isDaily) {
      const today = new Date().toISOString().slice(0, 10);
      if (stats.lastWinDate) {
        const prevDate = new Date(stats.lastWinDate);
        const currDate = new Date(today);
        const diffMs = currDate - prevDate;
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
        if (diffDays === 1) {
          stats.currentStreak = (stats.currentStreak || 0) + 1;
        } else if (diffDays === 0) {
          // Více výher v jeden den zachová streak
        } else {
          stats.currentStreak = 1;
        }
      } else {
        stats.currentStreak = 1;
      }
      stats.lastWinDate = today;
      stats.maxStreak = Math.max(stats.maxStreak || 0, stats.currentStreak);
    }

    if (typeof guessesCount === 'number' && guessesCount > 0) {
      stats.totalWinningGuesses = (stats.totalWinningGuesses || 0) + guessesCount;
      if (stats.bestScore === null || guessesCount < stats.bestScore) {
        stats.bestScore = guessesCount;
      }
    }

    saveStats(stats);
  }

  function updateModalUI() {
    const stats = getStats();
    const badgeEl = document.getElementById('stats-player-badge');
    const serialEl = document.getElementById('stats-card-serial');
    const playedEl = document.getElementById('stat-games-played');
    const wonEl = document.getElementById('stat-games-won');
    const streakEl = document.getElementById('stat-current-streak');
    const maxStreakEl = document.getElementById('stat-max-streak');
    const avgEl = document.getElementById('stat-avg-guesses');
    const bestEl = document.getElementById('stat-best-score');
    const stampEl = document.getElementById('punched-stamp');

    const name = myPlayerName || 'HRÁČ';
    if (badgeEl) badgeEl.textContent = name.toUpperCase();

    if (serialEl) {
      let hash = 0;
      for (let i = 0; i < name.length; i++) {
        hash = ((hash << 5) - hash) + name.charCodeAt(i);
      }
      const num = String(Math.abs(hash) % 9000 + 1000).padStart(4, '0');
      serialEl.textContent = `SER: #${num}`;
    }

    // Výpočet efektivního streaku (pokud včerejšek nebyl odehrán, streak vypršel)
    const today = new Date().toISOString().slice(0, 10);
    let effectiveStreak = stats.currentStreak || 0;
    if (stats.lastWinDate) {
      const prevDate = new Date(stats.lastWinDate);
      const currDate = new Date(today);
      const diffDays = Math.round((currDate - prevDate) / (1000 * 60 * 60 * 24));
      if (diffDays > 1) {
        effectiveStreak = 0;
      }
    }

    if (playedEl) playedEl.textContent = stats.gamesPlayed || 0;
    if (wonEl) wonEl.textContent = stats.gamesWon || 0;
    if (streakEl) streakEl.textContent = `${effectiveStreak} 🔥`;
    if (maxStreakEl) maxStreakEl.textContent = `${stats.maxStreak || 0} dní`;

    if (avgEl) {
      if (stats.gamesWon > 0 && stats.totalWinningGuesses > 0) {
        avgEl.textContent = (stats.totalWinningGuesses / stats.gamesWon).toFixed(1);
      } else {
        avgEl.textContent = '-';
      }
    }

    if (bestEl) {
      bestEl.textContent = stats.bestScore
        ? `${stats.bestScore} ${stats.bestScore === 1 ? 'tip' : stats.bestScore < 5 ? 'tipy' : 'tipů'}`
        : '-';
    }

    if (stampEl) {
      if (stats.gamesWon >= 10) {
        stampEl.textContent = '[ ELITNÍ LÉXIKOGRAF ARÉNY ]';
      } else if (stats.gamesWon >= 3) {
        stampEl.textContent = '[ ZKUŠENÝ LUŠTITEL ARÉNY ]';
      } else {
        stampEl.textContent = '[ REGISTROVANÝ HRÁČ ARÉNY ]';
      }
    }
  }

  return {
    getStats,
    recordGameEntry,
    recordGameWin,
    updateModalUI
  };
})();

function showStatsModal() {
  PlayerStats.updateModalUI();
  if (statsModal) statsModal.style.display = 'flex';
  SoundFx.playKeyClick();
}

function hideStatsModal() {
  if (statsModal) statsModal.style.display = 'none';
  SoundFx.playKeyClick();
}

if (btnOpenStats) btnOpenStats.addEventListener('click', showStatsModal);
if (btnCloseStats) btnCloseStats.addEventListener('click', hideStatsModal);
if (btnAckStats) btnAckStats.addEventListener('click', hideStatsModal);
if (statsModal) {
  statsModal.addEventListener('click', (e) => {
    if (e.target === statsModal) hideStatsModal();
  });
}

function renderTop50Modal(data) {
  if (!top50Grid) return;
  top50Grid.innerHTML = '';

  const word = data?.word || latestGameState?.secretWord || '';
  if (top50SecretBadge) {
    top50SecretBadge.textContent = word ? `#1 ${word.toUpperCase()}` : '#1 ???';
  }

  const items = data?.top50 || [];
  if (items.length === 0) {
    top50Grid.innerHTML = '<div class="empty-guesses">Data TOP 50 nejsou k dispozici.</div>';
    return;
  }

  // Zjistíme, která slova hráč sám trefil
  const myWordsMap = new Map();
  if (latestGameState?.guesses) {
    for (const g of latestGameState.guesses) {
      if (g.isMine && g.word) {
        myWordsMap.set(g.word.toLowerCase(), g);
      }
    }
  }

  for (const item of items) {
    const isMine = myWordsMap.has(item.word.toLowerCase());
    const div = document.createElement('div');
    div.className = 'top50-item' + (isMine ? ' is-mine' : '');

    // Výpočet šířky pruhu
    const fillWidth = Math.max(8, Math.round((1 - (item.rank - 1) / 50) * 100));
    let barColor = '#22c55e';
    if (item.rank === 1) barColor = '#eab308';
    else if (item.rank > 20) barColor = '#10b981';

    div.innerHTML = `
      <div class="top50-item-bg" style="width: ${fillWidth}%; background-color: ${barColor};"></div>
      <div class="top50-item-left">
        <span class="top50-rank" style="color: ${barColor}; border-color: ${barColor}40;">#${item.rank}</span>
        <span class="top50-word">${escapeHtml(item.word)}</span>
      </div>
      <div class="top50-item-right">
        ${isMine ? '<span class="top50-mine-badge">✓ TVŮJ TIP</span>' : ''}
      </div>
    `;

    top50Grid.appendChild(div);
  }
}

function triggerTop50() {
  SoundFx.playKeyClick();
  if (currentTop50Data && currentTop50Data.top50 && currentTop50Data.top50.length > 0) {
    renderTop50Modal(currentTop50Data);
    showTop50Modal();
  } else {
    socket.emit('get_top_50');
    showTop50Modal();
  }
}

if (btnShowTop50) {
  btnShowTop50.addEventListener('click', triggerTop50);
}

const btnNavTop50 = document.getElementById('btn-nav-top50');
if (btnNavTop50) {
  btnNavTop50.addEventListener('click', triggerTop50);
}

// DOM – Chat Ankety (!poll)
const chatPollWidget = document.getElementById('chat-poll-widget');
const pollQuestion = document.getElementById('poll-question');
const pollTimerBadge = document.getElementById('poll-timer-badge');
const pollOptionsList = document.getElementById('poll-options-list');
const pollVotesTotal = document.getElementById('poll-votes-total');
const pollAuthor = document.getElementById('poll-author');

let currentPollState = null;
let pollTimerCountdown = null;

function renderPoll(poll) {
  currentPollState = poll;
  if (!chatPollWidget) return;

  if (pollTimerCountdown) {
    clearInterval(pollTimerCountdown);
    pollTimerCountdown = null;
  }

  if (!poll || !poll.active) {
    chatPollWidget.style.display = 'none';
    return;
  }

  chatPollWidget.style.display = 'block';
  if (pollQuestion) pollQuestion.textContent = poll.question;
  if (pollAuthor) pollAuthor.textContent = `od ${poll.createdBy || 'Neznámý'}`;
  if (pollVotesTotal) {
    const total = poll.totalVotes || 0;
    pollVotesTotal.textContent = `${total} ${total === 1 ? 'hlas' : (total >= 2 && total <= 4 ? 'hlasy' : 'hlasů')}`;
  }

  let timeLeft = typeof poll.timeLeft === 'number' ? poll.timeLeft : 60;
  if (pollTimerBadge) {
    pollTimerBadge.textContent = `${timeLeft} s`;
  }

  pollTimerCountdown = setInterval(() => {
    timeLeft--;
    if (timeLeft <= 0) {
      clearInterval(pollTimerCountdown);
      pollTimerCountdown = null;
      if (pollTimerBadge) pollTimerBadge.textContent = '0 s';
    } else {
      if (pollTimerBadge) pollTimerBadge.textContent = `${timeLeft} s`;
    }
  }, 1000);

  if (pollOptionsList) {
    pollOptionsList.innerHTML = '';
    const myVotedIdx = poll.myVotedOption;

    poll.options.forEach((opt, idx) => {
      const isVoted = myVotedIdx === idx;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'poll-option-btn' + (isVoted ? ' is-voted' : '');

      btn.innerHTML = `
        <div class="poll-option-bar" style="width: ${opt.percent || 0}%;"></div>
        <div class="poll-option-text">
          <span class="poll-option-num">${idx + 1}.</span>
          ${isVoted ? '<span class="poll-check-icon">✓</span>' : ''}
          <span>${escapeHtml(opt.text)}</span>
        </div>
        <div class="poll-option-stats">
          <span>${opt.percent || 0}%</span>
          <span style="opacity: 0.7;">(${opt.votesCount || 0})</span>
        </div>
      `;

      btn.addEventListener('click', () => {
        socket.emit('vote_poll', { optionIndex: idx });
      });

      pollOptionsList.appendChild(btn);
    });
  }
}

// DOM – YouTube Hudební přehrávač
const musicBar = document.getElementById('music-bar');
const musicTitle = document.getElementById('music-title');
const musicRequester = document.getElementById('music-requester');
const musicTime = document.getElementById('music-time');
const musicProgressBar = document.getElementById('music-progress-bar');
const btnMusicToggle = document.getElementById('btn-music-toggle');
const musicToggleIcon = document.getElementById('music-toggle-icon');
const btnMusicMute = document.getElementById('btn-music-mute');
const musicMuteIcon = document.getElementById('music-mute-icon');
const musicVolumeSlider = document.getElementById('music-volume-slider');
const musicVolumeVal = document.getElementById('music-volume-val');
const btnMusicStop = document.getElementById('btn-music-stop');
const btnMusicSkip = document.getElementById('btn-music-skip');
const musicSkipBadge = document.getElementById('music-skip-badge');
const btnMusicQueue = document.getElementById('btn-music-queue');
const musicQueueBadge = document.getElementById('music-queue-badge');
const musicQueuePopover = document.getElementById('music-queue-popover');
const musicQueueBody = document.getElementById('music-queue-body');
const btnCloseQueue = document.getElementById('btn-close-queue');
const btnMusicEnable = document.getElementById('btn-music-enable');
const musicControlsActive = document.getElementById('music-controls-active');

// ── YouTube Hudební přehrávač (Sync State) ──────────────────
let ytPlayer = null;
let isYtReady = false;
let pendingTrack = null;
let activeTrack = null;
let musicTicker = null;
let isLocalPaused = false;
let isLocalMuted = false;
let needSeekToZero = false;
let pendingSyncTarget = null;
let serverClockOffset = 0;
const failedTrackKeys = new Set();
let musicAllowed = false;
try {
  musicAllowed = sessionStorage.getItem('slovotecka_music_allowed') === 'true';
} catch (err) {}

// DOM – Plovoucí gramofon v rohu (Větší vinyl 84px) & Kazetový kazeťák
const floatingGramophone = document.getElementById('floating-gramophone');
const vinylRecordWrap = document.getElementById('vinyl-record-wrap');
const cassetteDeckWrap = document.getElementById('cassette-deck-wrap');
const btnSwitchDeck = document.getElementById('btn-switch-deck');
const playerDeckLabel = document.getElementById('player-deck-label');
const vinylDisc = document.getElementById('vinyl-disc');
const vinylThumb = document.getElementById('vinyl-thumb');
const gramophoneTitle = document.getElementById('gramophone-title');
const gramophoneRequester = document.getElementById('gramophone-requester');
const gramophoneTime = document.getElementById('gramophone-time');
const btnGramophoneToggle = document.getElementById('btn-gramophone-toggle');
const gramophoneToggleIcon = document.getElementById('gramophone-toggle-icon');
const btnGramophoneSkip = document.getElementById('btn-gramophone-skip');
const btnGramophoneMinimize = document.getElementById('btn-gramophone-minimize');

if (floatingGramophone) {
  floatingGramophone.classList.add('is-minimized');
}

let currentDeckMode = 'cassette';
try {
  const savedDeck = localStorage.getItem('slovotecka_deck_mode');
  if (savedDeck === 'cassette' || savedDeck === 'vinyl') {
    currentDeckMode = savedDeck;
  }
} catch (e) {}

function applyDeckMode(mode) {
  currentDeckMode = mode === 'cassette' ? 'cassette' : 'vinyl';
  try {
    localStorage.setItem('slovotecka_deck_mode', currentDeckMode);
  } catch (e) {}

  if (currentDeckMode === 'cassette') {
    if (vinylRecordWrap) vinylRecordWrap.style.display = 'none';
    if (cassetteDeckWrap) cassetteDeckWrap.style.display = 'block';
    if (playerDeckLabel) playerDeckLabel.textContent = '[ HRAJE KAZETA ]';
    if (btnSwitchDeck) {
      btnSwitchDeck.textContent = '💿 GRAMOFON';
      btnSwitchDeck.title = 'Přepnout na gramofonový vinyl';
    }
  } else {
    if (vinylRecordWrap) vinylRecordWrap.style.display = 'block';
    if (cassetteDeckWrap) cassetteDeckWrap.style.display = 'none';
    if (playerDeckLabel) playerDeckLabel.textContent = '[ HRAJE GRAMOFON ]';
    if (btnSwitchDeck) {
      btnSwitchDeck.textContent = '📼 KAZETA';
      btnSwitchDeck.title = 'Přepnout na kazetový magnetofon';
    }
  }
  updateGramophoneTooltips();
}

function updateGramophoneTooltips() {
  if (!floatingGramophone) return;
  const isMin = floatingGramophone.classList.contains('is-minimized');
  const trackObj = (typeof activeTrack !== 'undefined' && activeTrack) ? activeTrack : null;
  const currentTitle = trackObj ? (trackObj.title || 'Skladba') : '';
  const deckName = currentDeckMode === 'cassette' ? 'magnetofon' : 'vinyl';

  if (isMin) {
    const tip = currentTitle ? `Hraje: ${currentTitle} (kliknutím rozbalíš podrobnosti)` : 'Kliknutím zobrazíš podrobnosti skladby';
    if (vinylRecordWrap) vinylRecordWrap.title = tip;
    if (cassetteDeckWrap) cassetteDeckWrap.title = tip;
    floatingGramophone.title = tip;
  } else {
    const sbalTip = `Kliknutím sbalíš na samotný ${deckName}`;
    if (vinylRecordWrap) vinylRecordWrap.title = sbalTip;
    if (cassetteDeckWrap) cassetteDeckWrap.title = sbalTip;
    floatingGramophone.title = '';
  }
}

function toggleGramophoneDetails(forceState) {
  if (!floatingGramophone) return;
  const willBeMin = typeof forceState === 'boolean' ? forceState : !floatingGramophone.classList.contains('is-minimized');
  if (willBeMin) {
    floatingGramophone.classList.add('is-minimized');
  } else {
    floatingGramophone.classList.remove('is-minimized');
    if (!musicAllowed) {
      musicAllowed = true;
      try {
        sessionStorage.setItem('slovotecka_music_allowed', 'true');
      } catch (err) {}
      showToast('🎵 Hudba zapnuta (výchozí hlasitost 20%).');
      if (activeTrack) {
        playTrack(activeTrack);
      }
    }
  }
  updateGramophoneTooltips();
}

function updateVinylState(isPlaying, isPaused, videoId) {
  if (videoId && vinylThumb) {
    const thumbUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    if (vinylThumb.src !== thumbUrl) {
      vinylThumb.src = thumbUrl;
    }
  }

  const trackObj = (typeof activeTrack !== 'undefined' && activeTrack) ? activeTrack : null;
  const currentTitle = trackObj ? (trackObj.title || `YouTube video (${videoId || trackObj.videoId})`) : '';

  if (vinylRecordWrap) {
    if (isPlaying) {
      vinylRecordWrap.classList.add('is-playing');
      vinylRecordWrap.classList.remove('is-paused');
    } else if (isPaused) {
      vinylRecordWrap.classList.remove('is-playing');
      vinylRecordWrap.classList.add('is-paused');
    } else {
      vinylRecordWrap.classList.remove('is-playing', 'is-paused');
    }
  }

  if (cassetteDeckWrap) {
    if (isPlaying) {
      cassetteDeckWrap.classList.add('is-playing');
      cassetteDeckWrap.classList.remove('is-paused');
    } else if (isPaused) {
      cassetteDeckWrap.classList.remove('is-playing');
      cassetteDeckWrap.classList.add('is-paused');
    } else {
      cassetteDeckWrap.classList.remove('is-playing', 'is-paused');
    }
  }

  if (floatingGramophone) {
    if (isPlaying || isPaused || trackObj || videoId) {
      floatingGramophone.style.display = 'flex';
    } else {
      floatingGramophone.style.display = 'none';
    }
  }

  if (gramophoneTitle && currentTitle) {
    gramophoneTitle.textContent = currentTitle;
    gramophoneTitle.title = currentTitle;
  }
  if (gramophoneRequester && trackObj) {
    gramophoneRequester.textContent = trackObj.requestedBy ? `(od ${trackObj.requestedBy})` : '';
  }
  if (gramophoneToggleIcon) {
    gramophoneToggleIcon.textContent = isPlaying ? '⏸' : '▶';
  }
  if (btnGramophoneToggle) {
    btnGramophoneToggle.title = isPlaying ? 'Pozastavit hudbu pro tebe' : 'Spustit hudbu';
  }

  updateGramophoneTooltips();
}

applyDeckMode(currentDeckMode);

if (floatingGramophone) {
  floatingGramophone.addEventListener('click', () => {
    if (floatingGramophone.classList.contains('is-minimized')) {
      toggleGramophoneDetails(false);
    }
  });
}

if (vinylRecordWrap) {
  vinylRecordWrap.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleGramophoneDetails();
  });
}

if (cassetteDeckWrap) {
  cassetteDeckWrap.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleGramophoneDetails();
  });
}

if (btnSwitchDeck) {
  btnSwitchDeck.addEventListener('click', (e) => {
    e.stopPropagation();
    SoundFx.playKeyClick();
    applyDeckMode(currentDeckMode === 'vinyl' ? 'cassette' : 'vinyl');
  });
}

if (btnGramophoneToggle) {
  btnGramophoneToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (typeof toggleMusic === 'function') toggleMusic();
  });
}

if (btnGramophoneSkip) {
  btnGramophoneSkip.addEventListener('click', (e) => {
    e.stopPropagation();
    socket.emit('vote_skip_music');
  });
}

if (btnGramophoneMinimize) {
  btnGramophoneMinimize.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleGramophoneDetails(true);
  });
}

// DOM – Nápověda příkazů chatu
const chatCommandsPopover = document.getElementById('chat-commands-popover');
const chatCommandsList = document.getElementById('chat-commands-list');

// DOM – Chat Autocomplete (:emotes & @mentions)
const chatAutocompletePopover = document.getElementById('chat-autocomplete-popover');
const chatAutocompleteTag = document.getElementById('chat-autocomplete-tag');
const chatAutocompleteList = document.getElementById('chat-autocomplete-list');
let currentRoomPlayers = []; // Seznam online hráčů pro @mentions
let myIsAdmin = false; // Příznak admin práv přihlášeného hráče

// DOM – Poslední tip (Contexto styl)
const lastGuessContainer = document.getElementById('last-guess-container');
const lastGuessFill = document.getElementById('last-guess-fill');
const lastGuessWord = document.getElementById('last-guess-word');
const lastGuessRank = document.getElementById('last-guess-rank');

// DOM – Chat
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const btnToggleEmotes = document.getElementById('btn-toggle-emotes');
const emotePicker = document.getElementById('emote-picker');
const emoteSearch = document.getElementById('emote-search');
const emotePickerGrid = document.getElementById('emote-picker-grid');
const emotePickerCount = document.getElementById('emote-picker-count');
// DOM – Chat Drawer & Hráči online popover
const chatPanel = document.getElementById('chat-panel');
const btnToggleChat = document.getElementById('btn-toggle-chat');
const btnCloseChat = document.getElementById('btn-close-chat');
const chatBackdrop = document.getElementById('chat-backdrop');
const headerChatDot = document.getElementById('header-chat-dot');

const btnTogglePlayers = document.getElementById('btn-toggle-players');
const btnClosePlayers = document.getElementById('btn-close-players');
const playersPopover = document.getElementById('players-popover');
const headerPlayersCount = document.getElementById('header-players-count');

// ── DYNAMICKÉ OMEZENÍ VÝŠKY A POZICE POSTRANNÍCH PANELŮ (CHAT & ONLINE) ─────
// Zabraňuje lezení chatu a online panelu pod hlavičku a přes patičku při scrollování
let sidebarBoundsRaf = null;

function updateSidebarBounds() {
  if (typeof window === 'undefined') return;

  // Na mobilu (< 960px) jsou panely spodní výsuvné lišty (bottom sheet)
  if (window.innerWidth < 960) {
    document.documentElement.style.removeProperty('--site-top-height');
    document.documentElement.style.removeProperty('--site-bottom-clearance');
    return;
  }

  // 1. Spočítat spodní hranu sticky hlavičky / hudební lišty
  const topContainer = document.getElementById('site-top-container') || document.querySelector('.site-header');
  let topHeight = 68;
  if (topContainer) {
    const topRect = topContainer.getBoundingClientRect();
    topHeight = Math.max(50, Math.round(topRect.bottom));
  }
  document.documentElement.style.setProperty('--site-top-height', `${topHeight}px`);

  // 2. Spočítat kolik patičky (.site-footer) je vidět v okně a zvednout spodní okraj panelů
  const footer = document.querySelector('.site-footer');
  let bottomClearance = 18;
  if (footer) {
    const footerRect = footer.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const footerVisibleHeight = Math.max(0, viewportHeight - footerRect.top);
    bottomClearance = 18 + footerVisibleHeight;
  }
  document.documentElement.style.setProperty('--site-bottom-clearance', `${bottomClearance}px`);
}

function scheduleSidebarBoundsUpdate() {
  if (sidebarBoundsRaf) return;
  sidebarBoundsRaf = requestAnimationFrame(() => {
    sidebarBoundsRaf = null;
    updateSidebarBounds();
  });
}

window.addEventListener('scroll', scheduleSidebarBoundsUpdate, { passive: true });
window.addEventListener('resize', scheduleSidebarBoundsUpdate, { passive: true });

if (typeof ResizeObserver !== 'undefined') {
  const topCont = document.getElementById('site-top-container') || document.querySelector('.site-header');
  if (topCont) {
    new ResizeObserver(scheduleSidebarBoundsUpdate).observe(topCont);
  }
  const siteFooter = document.querySelector('.site-footer');
  if (siteFooter) {
    new ResizeObserver(scheduleSidebarBoundsUpdate).observe(siteFooter);
  }
}
updateSidebarBounds();

function isChatOpen() {
  return document.body.classList.contains('chat-is-open') || (chatPanel && chatPanel.classList.contains('is-open'));
}

function setChatOpen(open, shouldFocus = false) {
  const isOpen = !!open;
  if (chatPanel) chatPanel.classList.toggle('is-open', isOpen);
  document.body.classList.toggle('chat-is-open', isOpen);
  if (chatBackdrop) chatBackdrop.classList.toggle('is-open', isOpen);
  if (btnToggleChat) {
    btnToggleChat.classList.toggle('is-active', isOpen);
    btnToggleChat.setAttribute('aria-expanded', String(isOpen));
  }
  if (isOpen) {
    if (headerChatDot) headerChatDot.style.display = 'none';
    if (shouldFocus && chatInput) {
      setTimeout(() => chatInput.focus(), 80);
    }
  }
  scheduleSidebarBoundsUpdate();
  try {
    localStorage.setItem('slovotecka_chat_docked', isOpen ? '1' : '0');
  } catch (err) {
    // localStorage might not be available
  }
}

function openChatDrawer() {
  setChatOpen(true, true);
}

function closeChatDrawer() {
  setChatOpen(false, false);
}

function toggleChatDrawer() {
  SoundFx.playKeyClick();
  setChatOpen(!isChatOpen(), true);
}

if (btnToggleChat) btnToggleChat.addEventListener('click', toggleChatDrawer);
if (btnCloseChat) btnCloseChat.addEventListener('click', () => {
  SoundFx.playKeyClick();
  closeChatDrawer();
});
if (chatBackdrop) chatBackdrop.addEventListener('click', closeChatDrawer);

// Inicializace stavu chatu z localStorage (nebo výchozí otevření na širokém desktopu)
(function initChatDockState() {
  try {
    const saved = localStorage.getItem('slovotecka_chat_docked');
    const defaultOpen = saved !== null ? (saved === '1') : (window.innerWidth >= 1150);
    setChatOpen(defaultOpen, false);
  } catch (e) {
    setChatOpen(window.innerWidth >= 1150, false);
  }
})();

// ── ROZTAHOVÁNÍ CHAT PANELU (DRAG RESIZE) ───────────────────────────────────
(function initChatResize() {
  const handle = document.getElementById('chat-resize-handle');
  if (!handle || !chatPanel) return;

  const DEFAULT_WIDTH = 320;
  const MIN_WIDTH = 260;

  function getMaxWidth() {
    return Math.max(MIN_WIDTH, Math.min(750, window.innerWidth - 420));
  }

  function applyChatWidth(widthPx, save = false) {
    const clamped = Math.max(MIN_WIDTH, Math.min(widthPx, getMaxWidth()));
    document.documentElement.style.setProperty('--chat-width', `${clamped}px`);
    chatPanel.style.width = `${clamped}px`;
    if (save) {
      try {
        localStorage.setItem('slovotecka_chat_width', String(clamped));
      } catch (e) {}
    }
  }

  // Obnovení uložené šířky z localStorage
  try {
    const saved = localStorage.getItem('slovotecka_chat_width');
    if (saved) {
      const parsed = parseInt(saved, 10);
      if (!isNaN(parsed) && parsed >= MIN_WIDTH) {
        applyChatWidth(parsed, false);
      }
    }
  } catch (e) {}

  let isDragging = false;
  let startX = 0;
  let startWidth = 0;

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (window.innerWidth < 960) return;

    isDragging = true;
    startX = e.clientX;
    const rect = chatPanel.getBoundingClientRect();
    startWidth = rect.width;

    document.body.classList.add('is-resizing-chat');
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  function onPointerMove(e) {
    if (!isDragging) return;
    const clientX = e.clientX;
    // Tažení doleva rozšiřuje chat, tažení doprava ho zužuje
    const deltaX = startX - clientX;
    const newWidth = Math.round(startWidth + deltaX);
    applyChatWidth(newWidth, false);
  }

  function onPointerUp() {
    if (!isDragging) return;
    isDragging = false;
    document.body.classList.remove('is-resizing-chat');

    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);

    const rect = chatPanel.getBoundingClientRect();
    applyChatWidth(rect.width, true);
  }

  handle.addEventListener('pointerdown', onPointerDown);

  // Dvojklik vrátí výchozí šířku 320px
  handle.addEventListener('dblclick', () => {
    applyChatWidth(DEFAULT_WIDTH, true);
    SoundFx.playKeyClick();
  });

  // Přizpůsobení při změně velikosti okna prohlížeče
  window.addEventListener('resize', () => {
    if (window.innerWidth >= 960) {
      const rect = chatPanel.getBoundingClientRect();
      applyChatWidth(rect.width, false);
    }
  });
})();

function buildPlayerItemHtml(p, isInCurrentRoom, showRoomTag) {
  const isMe = myPlayerName && p.name && (p.name.toLowerCase() === myPlayerName.toLowerCase());
  const pColor = p.color || '#3b82f6';
  let cls = 'player-item';
  if (isMe) cls += ' is-me';
  if (p.solved) cls += ' solved';
  if (p.gaveUp) cls += ' gave-up';

  let statusText = '';
  if (p.solved) {
    statusText = '<span class="player-status status-solved">UHODL(A)</span>';
  } else if (p.gaveUp) {
    statusText = '<span class="player-status status-gave-up">VZDÁNO</span>';
  } else {
    const count = p.guessCount || 0;
    const pPlural = count === 1 ? 'tip' : (count >= 2 && count <= 4 ? 'tipy' : 'tipů');
    statusText = `<span class="player-status">${count} ${pPlural}</span>`;
  }

  const clown = p.usedHint ? ' 🤡' : '';
  const votedBadge = p.votedForNewWord ? ' <span class="badge-voted" title="Hlasuje pro nové slovo">🗳️</span>' : '';
  const isMeTag = isMe ? ' <span style="font-size: 0.72rem; color: var(--color-base-600);">(ty)</span>' : '';
  const adminBadge = p.isAdmin ? ' <span class="badge-admin" title="Administrátor"><span class="badge-admin-crown">👑</span> ADMIN</span>' : '';
  const roomTag = showRoomTag && p.roomTitle ? `<span class="player-room-tag">${escapeHtml(p.roomTitle)}</span>` : '';

  return `
    <li class="${cls}">
      <span class="player-name" style="color: ${escapeHtml(pColor)};">
        <span class="player-color-dot" style="background-color: ${escapeHtml(pColor)};"></span>
        ${escapeHtml(p.name)}${adminBadge}${clown}${votedBadge}${isMeTag}${roomTag}
      </span>
      ${statusText}
    </li>
  `;
}

function renderPlayersPopover() {
  if (!playersList) return;
  const popoverTitle = document.getElementById('players-popover-title');
  const inGame = gameSection && gameSection.style.display !== 'none' && latestGameState?.players;

  if (inGame) {
    const roomPlayers = latestGameState.players || [];
    const globalPlayers = latestGlobalOnlineData?.players || [];
    const roomPlayerNames = new Set(roomPlayers.map(p => (p.name || '').toLowerCase()));
    const otherPlayers = globalPlayers.filter(p => !roomPlayerNames.has((p.name || '').toLowerCase()));

    if (popoverTitle) {
      popoverTitle.textContent = `HRÁČI V TÉTO ARÉNĚ (${roomPlayers.length})`;
    }

    if (roomPlayers.length === 0 && otherPlayers.length === 0) {
      playersList.innerHTML = '<li class="players-empty">V aréně jsi zatím sám.</li>';
      return;
    }

    let html = '';
    roomPlayers.forEach(p => {
      html += buildPlayerItemHtml(p, true, false);
    });

    if (otherPlayers.length > 0) {
      html += `<li class="players-section-title">V dalších arénách (${otherPlayers.length})</li>`;
      otherPlayers.forEach(p => {
        html += buildPlayerItemHtml(p, false, true);
      });
    }

    playersList.innerHTML = html;
  } else {
    // We are in Lobby
    const globalPlayers = latestGlobalOnlineData?.players || [];
    const totalCount = (latestGlobalOnlineData && typeof latestGlobalOnlineData.total === 'number')
      ? latestGlobalOnlineData.total
      : globalPlayers.length;

    if (popoverTitle) {
      popoverTitle.textContent = `HRÁČI ONLINE (${totalCount})`;
    }

    if (globalPlayers.length === 0) {
      playersList.innerHTML = '<li class="players-empty">V arénách momentálně nikdo nehraje. Zadej přezdívku a začni hrát!</li>';
      return;
    }

    const groups = {};
    globalPlayers.forEach(p => {
      const key = p.roomTitle || p.mode || 'Aréna';
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    });

    let html = '';
    for (const [groupTitle, groupPlayers] of Object.entries(groups)) {
      html += `<li class="players-section-title">${escapeHtml(groupTitle)} (${groupPlayers.length})</li>`;
      groupPlayers.forEach(p => {
        html += buildPlayerItemHtml(p, false, false);
      });
    }
    playersList.innerHTML = html;
  }
}

function isPlayersOpen() {
  return document.body.classList.contains('players-is-open') || (playersPopover && playersPopover.style.display !== 'none');
}

function setPlayersOpen(open) {
  const isOpen = !!open;
  if (playersPopover) {
    playersPopover.style.display = isOpen ? 'flex' : 'none';
    playersPopover.classList.toggle('is-open', isOpen);
  }
  document.body.classList.toggle('players-is-open', isOpen);
  if (btnTogglePlayers) {
    btnTogglePlayers.classList.toggle('is-active', isOpen);
    btnTogglePlayers.setAttribute('aria-expanded', String(isOpen));
  }
  if (isOpen) {
    renderPlayersPopover();
    socket.emit('get_online_players');
    fetch('/api/arena-stats')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data) {
          latestGlobalOnlineData = data;
          updateHeaderPlayersCount();
          renderPlayersPopover();
        }
      })
      .catch(() => {});
  }
  try {
    localStorage.setItem('slovotecka_players_open', isOpen ? '1' : '0');
  } catch (e) {}
  scheduleSidebarBoundsUpdate();
}

function togglePlayersPanel() {
  SoundFx.playKeyClick();
  setPlayersOpen(!isPlayersOpen());
}

if (btnTogglePlayers) {
  btnTogglePlayers.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePlayersPanel();
  });
}

const btnFloatingPlayers = document.getElementById('btn-floating-players');
if (btnFloatingPlayers) {
  btnFloatingPlayers.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePlayersPanel();
  });
}

if (btnClosePlayers) {
  btnClosePlayers.addEventListener('click', () => {
    SoundFx.playKeyClick();
    setPlayersOpen(false);
  });
}

// Na mobilu (< 960px) zavřít kliknutím mimo panel
document.addEventListener('click', (e) => {
  if (window.innerWidth < 960 && isPlayersOpen()) {
    if (
      playersPopover &&
      !playersPopover.contains(e.target) &&
      !btnTogglePlayers?.contains(e.target) &&
      !btnFloatingPlayers?.contains(e.target)
    ) {
      setPlayersOpen(false);
    }
  }
});

// Inicializace stavu otevření panelu hráčů z localStorage na širokém monitoru
(function initPlayersDockState() {
  try {
    const saved = localStorage.getItem('slovotecka_players_open');
    if (saved === '1' && window.innerWidth >= 1400) {
      setPlayersOpen(true);
    }
  } catch (e) {}
})();

// Předvyplnění přezdívky pokud již hráč hrál dříve
if (myPlayerName) {
  playerNameInput.value = myPlayerName;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Toast notifikace ──────────────────────────────────
function showToast(text, isError = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' toast-error' : '');
  el.textContent = text;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity 0.3s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, 4000);
}

function setFeedback(text) {
  guessFeedback.textContent = text;
}

// ── Barva ranku ───────────────────────────────────────
function rankClass(rank) {
  if (rank === 1)    return 'rank-1';
  if (rank <= 300)   return 'rank-hot';
  if (rank <= 1500)  return 'rank-warm';
  return 'rank-cool';
}

// Výpočet šířky a barvy baru dle vzoru Contexto (používá retro analogové proměnné tématu)
function getBarStyles(rank) {
  if (rank === 1) {
    return { width: '100%', bg: 'var(--color-green)' };
  }
  if (rank <= 300) {
    const pct = Math.round(98 - ((rank - 2) / 298) * 40); // 98% -> 58%
    return { width: `${pct}%`, bg: 'var(--color-green)' };
  }
  if (rank <= 1500) {
    const pct = Math.round(56 - ((rank - 301) / 1199) * 32); // 56% -> 24%
    return { width: `${pct}%`, bg: 'var(--color-amber)' };
  }
  // Hladké logaritmické škálování pro studená slova (1501 až 50 000+) – místo statických 8px
  const coldRatio = Math.min(1, Math.max(0, Math.log(rank / 1500) / Math.log(50000 / 1500)));
  const pct = Math.max(5, Math.round(22 - coldRatio * 17)); // 22% -> 5%
  return { width: `${pct}%`, bg: 'var(--color-accent)' };
}

// ── Stav historie tipů a řazení ───────────────────────
let myGuessHistory = [];
let historyIndex = -1;
let currentDraft = '';
let guessSortMode = localStorage.getItem('slovotecka_guess_sort') || 'rank'; // 'rank' nebo 'time'
let previousLastGuessId = null;
let initialGameStateRendered = false;

// DOM – Řazení odhalených slov
const btnSortRank = document.getElementById('btn-sort-rank');
const btnSortTime = document.getElementById('btn-sort-time');

function updateSortTabsUI() {
  if (btnSortRank) btnSortRank.classList.toggle('is-active', guessSortMode === 'rank');
  if (btnSortTime) btnSortTime.classList.toggle('is-active', guessSortMode === 'time');
}
updateSortTabsUI();

if (btnSortRank) {
  btnSortRank.addEventListener('click', () => {
    SoundFx.playKeyClick();
    guessSortMode = 'rank';
    try { localStorage.setItem('slovotecka_guess_sort', 'rank'); } catch (e) {}
    updateSortTabsUI();
    if (latestGameState) renderGameState(latestGameState);
  });
}

if (btnSortTime) {
  btnSortTime.addEventListener('click', () => {
    SoundFx.playKeyClick();
    guessSortMode = 'time';
    try { localStorage.setItem('slovotecka_guess_sort', 'time'); } catch (e) {}
    updateSortTabsUI();
    if (latestGameState) renderGameState(latestGameState);
  });
}

// ── Mechanické páskové počítadlo (Odometer / Tape Counter) ───
let lastTapeCount = null;
function updateTapeCounter(count) {
  const d100 = document.getElementById('counter-d100');
  const d10 = document.getElementById('counter-d10');
  const d1 = document.getElementById('counter-d1');
  if (!d1 || !d10 || !d100) return;

  const bounded = Math.min(999, Math.max(0, count || 0));
  const s = String(bounded).padStart(3, '0');
  const [c100, c10, c1] = [s[0], s[1], s[2]];

  function setDigit(el, val) {
    if (el.textContent !== val) {
      el.textContent = val;
      el.classList.remove('is-rolling');
      void el.offsetWidth;
      el.classList.add('is-rolling');
      setTimeout(() => el.classList.remove('is-rolling'), 250);
    }
  }

  const changed = lastTapeCount !== null && lastTapeCount !== bounded;
  setDigit(d100, c100);
  setDigit(d10, c10);
  setDigit(d1, c1);

  if (changed && initialGameStateRendered) {
    SoundFx.playKeyClick();
  }
  lastTapeCount = bounded;
}

// ── 1. Vstup do hry ───────────────────────────────────
joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = playerNameInput.value.trim();
  if (!name) return showToast('Zadej své jméno nebo přezdívku.', true);

  SoundFx.playKeyClick();

  if (name.includes('/admin-perms-456')) {
    try { sessionStorage.setItem('slovotecka_admin_join_name', name); } catch (err) {}
  } else {
    try { sessionStorage.removeItem('slovotecka_admin_join_name'); } catch (err) {}
  }

  myPlayerName = name;
  localStorage.setItem('slovotecka_nickname', name);

  if (selectedLobbyMode === 'custom') {
    const rawCode = customCodeInput ? customCodeInput.value.trim().toUpperCase() : '';
    const sourceRadio = document.querySelector('input[name="custom-word-source"]:checked');
    const wordSource = sourceRadio ? sourceRadio.value : 'daily';
    if (!rawCode) {
      currentMode = 'custom';
      socket.emit('join_game', { playerName: name, mode: 'custom', color: myPlayerColor, wordSource });
    } else {
      currentMode = `custom_${rawCode}`;
      socket.emit('join_game', { playerName: name, mode: currentMode, color: myPlayerColor, customCode: rawCode, wordSource });
    }
  } else {
    currentMode = selectedLobbyMode;
    socket.emit('join_game', { playerName: name, mode: currentMode, color: myPlayerColor });
  }
});

// Automatické znovupřipojení při výpadku spojení
socket.on('connect', () => {
  let joinName = myPlayerName;
  try {
    const adminStored = sessionStorage.getItem('slovotecka_admin_join_name');
    if (adminStored) joinName = adminStored;
  } catch (err) {}
  if (joinName && gameSection.style.display !== 'none') {
    const customCode = (currentMode && currentMode.startsWith('custom_')) ? currentMode.replace('custom_', '') : null;
    socket.emit('join_game', { playerName: joinName, mode: currentMode, color: myPlayerColor, customCode });
  }
});

function triggerInputShake() {
  if (!guessInput) return;
  guessInput.classList.remove('input-shake');
  void guessInput.offsetWidth; // vynutit reflow
  guessInput.classList.add('input-shake');
  setTimeout(() => guessInput?.classList.remove('input-shake'), 400);
}

// ── 2. Odeslání tipu ──────────────────────────────────
function submitGuess() {
  const word = guessInput.value.trim();
  if (!word) {
    triggerInputShake();
    SoundFx.playError();
    return;
  }

  // Kontrola duplicitního tipu přímo na klientovi
  if (latestGameState && latestGameState.guesses) {
    const norm = word.toLowerCase();
    const existing = latestGameState.guesses.find(
      g => g.word.toLowerCase() === norm && (g.isMine || (myPlayerName && g.player.toLowerCase() === myPlayerName.toLowerCase()))
    );
    if (existing) {
      triggerInputShake();
      SoundFx.playError();
      setFeedback(`⚠️ Slovo "${word.toUpperCase()}" už jsi v tomto kole zadal(a) (#${existing.rank})!`);
      const allCards = guessesList.querySelectorAll('.guess-card');
      allCards.forEach(c => {
        const wSpan = c.querySelector('.guess-card-word');
        if (wSpan && wSpan.textContent.trim().toLowerCase() === norm) {
          c.classList.remove('is-duplicate-flash');
          void c.offsetWidth;
          c.classList.add('is-duplicate-flash');
          c.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
      return;
    }
  }

  SoundFx.playSubmit();
  setFeedback('Ověřuji slovo…');
  socket.emit('submit_guess', { word });

  // Uložení do historie pro šipky nahoru / dolů
  if (!myGuessHistory.includes(word)) {
    myGuessHistory.push(word);
  }
  historyIndex = -1;
  currentDraft = '';

  guessInput.value = '';
  guessInput.focus();
}

btnSubmitGuess.addEventListener('click', submitGuess);

guessInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    submitGuess();
  } else if (e.key === 'ArrowUp') {
    if (myGuessHistory.length === 0) return;
    e.preventDefault();
    if (historyIndex === -1) {
      currentDraft = guessInput.value;
      historyIndex = myGuessHistory.length - 1;
    } else if (historyIndex > 0) {
      historyIndex--;
    }
    guessInput.value = myGuessHistory[historyIndex];
    SoundFx.playKeyClick();
  } else if (e.key === 'ArrowDown') {
    if (historyIndex === -1) return;
    e.preventDefault();
    if (historyIndex < myGuessHistory.length - 1) {
      historyIndex++;
      guessInput.value = myGuessHistory[historyIndex];
    } else {
      historyIndex = -1;
      guessInput.value = currentDraft;
    }
    SoundFx.playKeyClick();
  }
});

// Globální klávesová zkratka: stisk "/" zaměří pole pro hádání, Escape zavře modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (giveUpModal && giveUpModal.style.display === 'flex') {
      hideGiveUpModal();
      return;
    }
    if (top50Modal && top50Modal.style.display === 'flex') {
      hideTop50Modal();
      return;
    }
  }

  const activeTag = document.activeElement?.tagName;
  const isInputActive = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || document.activeElement?.isContentEditable;

  if (e.key === '/' && !isInputActive) {
    e.preventDefault();
    if (guessInput && !guessInput.disabled) {
      guessInput.focus();
      guessInput.select();
      SoundFx.playKeyClick();
    }
  }
});

// ── 3. Vzdát se a odhalit dnešní slovo (s potvrzovacím oknem) ──────────
const giveUpModal = document.getElementById('give-up-modal');
const btnCloseGiveUp = document.getElementById('btn-close-give-up');
const btnCancelGiveUp = document.getElementById('btn-cancel-give-up');
const btnConfirmGiveUp = document.getElementById('btn-confirm-give-up');

function showGiveUpModal() {
  if (giveUpModal) {
    giveUpModal.style.display = 'flex';
    if (btnCancelGiveUp) btnCancelGiveUp.focus();
  }
}

function hideGiveUpModal() {
  if (giveUpModal) {
    giveUpModal.style.display = 'none';
    if (guessInput && !guessInput.disabled) {
      guessInput.focus();
    }
  }
}

if (btnRevealWord) {
  btnRevealWord.addEventListener('click', () => {
    SoundFx.playKeyClick();
    showGiveUpModal();
  });
}

if (btnCancelGiveUp) {
  btnCancelGiveUp.addEventListener('click', () => {
    SoundFx.playKeyClick();
    hideGiveUpModal();
  });
}

if (btnCloseGiveUp) {
  btnCloseGiveUp.addEventListener('click', () => {
    hideGiveUpModal();
  });
}

if (btnConfirmGiveUp) {
  btnConfirmGiveUp.addEventListener('click', () => {
    SoundFx.playKeyClick();
    hideGiveUpModal();
    socket.emit('reveal_word');
  });
}

if (giveUpModal) {
  giveUpModal.addEventListener('click', (e) => {
    if (e.target === giveUpModal) hideGiveUpModal();
  });
}

// ── 4. Odhalit nápovědu (získá 🤡) ────────────────────
btnShowHint.addEventListener('click', () => {
  SoundFx.playKeyClick();
  const ok = confirm('Opravdu chceš odhalit nápovědu?\nPozor: všichni online uvidí vedle tvého jména klauna 🤡!');
  if (ok) socket.emit('use_hint');
});

// ── 5. Hlasování o nové slovo (pouze Unlimited) ───────
if (btnVoteNewWord) {
  btnVoteNewWord.addEventListener('click', () => {
    socket.emit('vote_new_word');
  });
}

// ── 7TV Emoty & Picker ────────────────────────────────
let emotesList = [];
const emoteMap = new Map();

async function initEmotes() {
  try {
    const res = await fetch('/api/emotes');
    if (res.ok) {
      emotesList = await res.json();
      emoteMap.clear();
      for (const emote of emotesList) {
        emoteMap.set(emote.name, emote);
      }
      if (chatEmoteCountBadge) {
        chatEmoteCountBadge.textContent = `${emotesList.length} 7TV EMOTES`;
      }
      renderEmotePicker('');

      // Po načtení emotů převedeme případné již zobrazené zprávy v chatu
      const textNodes = chatMessages.querySelectorAll('.chat-msg-text');
      textNodes.forEach(node => {
        const raw = node.getAttribute('data-raw');
        if (raw) {
          node.innerHTML = renderMessageWithEmotes(raw);
        }
      });

      // Převedeme emoty i v okně WHATS NEW (např. Okayge)
      const whatsNewItems = document.querySelectorAll('.whats-new-list li');
      whatsNewItems.forEach(li => {
        li.innerHTML = renderMessageWithEmotes(li.textContent);
      });
    }
  } catch (err) {
    console.warn('Nepodařilo se načíst 7TV emoty ze serveru:', err);
  }
}

function renderMessageWithEmotes(text) {
  if (!text) return '';

  // 1. Zmínky online hráčů (@jméno) nahradíme unikátními placeholdery
  const mentions = [];
  let processed = text;

  // Seřadíme známé hráče z místnosti podle délky jména sestupně
  const knownPlayers = (currentRoomPlayers || [])
    .map(p => p.name)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const name of knownPlayers) {
    const escaped = name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`@${escaped}(?=[\\s.,!?:;]|$)`, 'gi');
    processed = processed.replace(regex, () => {
      const isMe = myPlayerName && name.toLowerCase() === myPlayerName.toLowerCase();
      const ph = `___MENTION_${mentions.length}___`;
      mentions.push(`<span class="chat-mention${isMe ? ' is-me' : ''}">@${escapeHtml(name)}</span>`);
      return ph;
    });
  }

  // Generické @jméno pro libovolné další zmínky
  processed = processed.replace(/@([a-zA-Z0-9_.-]+)(?=[\\s.,!?:;]|$)/g, (match, p1) => {
    const isMe = myPlayerName && p1.toLowerCase() === myPlayerName.toLowerCase();
    const ph = `___MENTION_${mentions.length}___`;
    mentions.push(`<span class="chat-mention${isMe ? ' is-me' : ''}">@${escapeHtml(p1)}</span>`);
    return ph;
  });

  // 2. Rozdělíme na slova pro 7TV emoty
  const parts = processed.split(/(\s+)/);
  let html = parts.map(part => {
    if (!part || /^\s+$/.test(part)) {
      return part ? part.replace(/\r?\n/g, '<br>') : part;
    }

    if (part.startsWith('___MENTION_') && part.endsWith('___')) {
      return part;
    }

    // 7TV Emot (:emote: i samotné emote)
    let emoteName = part;
    if (part.startsWith(':') && part.endsWith(':') && part.length > 2) {
      emoteName = part.slice(1, -1);
    }

    const emote = emoteMap.get(emoteName) || emoteMap.get(part);
    if (emote) {
      const safeName = escapeHtml(emote.name);
      const safeUrl = escapeHtml(emote.url);
      return `<img class="chat-emote" src="${safeUrl}" alt="${safeName}" title="${safeName}" loading="lazy">`;
    }

    return escapeHtml(part);
  }).join('');

  // 3. Dosadíme zmínky zpět
  mentions.forEach((mHtml, idx) => {
    html = html.replace(`___MENTION_${idx}___`, mHtml);
  });

  return html;
}

function renderEmotePicker(query) {
  if (!emotePickerGrid) return;
  emotePickerGrid.innerHTML = '';

  const q = (query || '').toLowerCase().trim();
  const filtered = q
    ? emotesList.filter(e => e.name.toLowerCase().includes(q))
    : emotesList;

  if (emotePickerCount) {
    emotePickerCount.textContent = `${filtered.length} / ${emotesList.length}`;
  }

  const displayList = filtered.slice(0, 300);

  const fragment = document.createDocumentFragment();
  for (const emote of displayList) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'emote-picker-item';
    btn.title = emote.name;
    btn.innerHTML = `<img src="${emote.url1x || emote.url}" alt="${escapeHtml(emote.name)}" loading="lazy">`;
    btn.addEventListener('click', () => {
      insertEmoteToChat(emote.name);
    });
    fragment.appendChild(btn);
  }
  emotePickerGrid.appendChild(fragment);
}

function insertEmoteToChat(emoteName) {
  const currentVal = chatInput.value;
  const cursorPos = chatInput.selectionStart ?? currentVal.length;
  const before = currentVal.substring(0, cursorPos);
  const after = currentVal.substring(cursorPos);

  const needsSpaceBefore = before.length > 0 && !before.endsWith(' ');
  const insertText = (needsSpaceBefore ? ' ' : '') + emoteName + ' ';

  chatInput.value = before + insertText + after;
  const newPos = cursorPos + insertText.length;
  chatInput.setSelectionRange(newPos, newPos);
  chatInput.focus();
}

function toggleEmotePicker() {
  if (!emotePicker) return;
  const isHidden = emotePicker.style.display === 'none' || !emotePicker.style.display;
  if (isHidden) {
    emotePicker.style.display = 'flex';
    btnToggleEmotes?.classList.add('is-active');
    if (emoteSearch) {
      emoteSearch.value = '';
      renderEmotePicker('');
      setTimeout(() => emoteSearch.focus(), 50);
    }
  } else {
    closeEmotePicker();
  }
}

function closeEmotePicker() {
  if (!emotePicker) return;
  emotePicker.style.display = 'none';
  btnToggleEmotes?.classList.remove('is-active');
}

if (btnToggleEmotes) {
  btnToggleEmotes.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleEmotePicker();
  });
}

if (emoteSearch) {
  emoteSearch.addEventListener('input', () => {
    renderEmotePicker(emoteSearch.value);
  });
}

document.addEventListener('click', (e) => {
  if (emotePicker && emotePicker.style.display !== 'none') {
    if (!emotePicker.contains(e.target) && !btnToggleEmotes?.contains(e.target)) {
      closeEmotePicker();
    }
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (window.innerWidth <= 959 && isChatOpen()) {
      closeChatDrawer();
      return;
    }
    if (isPlayersOpen()) {
      setPlayersOpen(false);
      return;
    }
    if (whatsNewModal && whatsNewModal.style.display !== 'none') {
      hideWhatsNew();
      return;
    }
    if (emotePicker && emotePicker.style.display !== 'none') {
      closeEmotePicker();
      chatInput.focus();
    }
  }
});

initEmotes();

// ── Nápověda příkazů chatu (autocomplete při zadání znaku !) ───────────
function renderAdminCommandsInPopover() {
  if (!chatCommandsList) return;
  let adminGroup = chatCommandsList.querySelector('.chat-admin-commands-group');
  if (!myIsAdmin) {
    if (adminGroup) adminGroup.remove();
    return;
  }
  if (adminGroup) return;

  adminGroup = document.createElement('div');
  adminGroup.className = 'chat-admin-commands-group';
  adminGroup.innerHTML = `
    <div style="font-size:0.68rem; font-weight:800; color:#f59e0b; padding:8px 10px 4px; letter-spacing:0.06em; border-top:1px solid rgba(245, 158, 11, 0.3); margin-top:4px;">[ 👑 ADMIN PŘÍKAZY ]</div>
    <button type="button" class="chat-command-item" data-command="!poll Otázka? | Ano | Ne">
      <span class="cmd-code" style="color:#f59e0b;">!poll &lt;otázka&gt; | &lt;volba 1&gt; | &lt;volba 2&gt;</span>
      <span class="cmd-desc">Vyhlásit anketu v chatu na 60 sekund</span>
    </button>
    <button type="button" class="chat-command-item" data-command="!endpoll">
      <span class="cmd-code" style="color:#f59e0b;">!endpoll</span>
      <span class="cmd-desc">Předčasně ukončit probíhající anketu</span>
    </button>
    <button type="button" class="chat-command-item" data-command="!kick ">
      <span class="cmd-code" style="color:#f59e0b;">!kick &lt;hráč&gt;</span>
      <span class="cmd-desc">Vyhodit hráče z arény</span>
    </button>
    <button type="button" class="chat-command-item" data-command="!clear">
      <span class="cmd-code" style="color:#f59e0b;">!clear</span>
      <span class="cmd-desc">Promazat historii chatu</span>
    </button>
    <button type="button" class="chat-command-item" data-command="!announce ">
      <span class="cmd-code" style="color:#f59e0b;">!announce &lt;text&gt;</span>
      <span class="cmd-desc">Globální oznámení všem online</span>
    </button>
    <button type="button" class="chat-command-item" data-command="!forceskip">
      <span class="cmd-code" style="color:#f59e0b;">!forceskip</span>
      <span class="cmd-desc">Přeskočit hudbu bez hlasování</span>
    </button>
    <button type="button" class="chat-command-item" data-command="!forcestop">
      <span class="cmd-code" style="color:#f59e0b;">!forcestop</span>
      <span class="cmd-desc">Zastavit hudbu pro celou arénu</span>
    </button>
    <button type="button" class="chat-command-item" data-command="!forceword">
      <span class="cmd-code" style="color:#f59e0b;">!forceword</span>
      <span class="cmd-desc">Okamžitě vylosovat nové slovo (Unlimited)</span>
    </button>
    <button type="button" class="chat-command-item" data-command="!reveal">
      <span class="cmd-code" style="color:#f59e0b;">!reveal</span>
      <span class="cmd-desc">Tajné zobrazení slova #1 pro admina</span>
    </button>
  `;
  chatCommandsList.appendChild(adminGroup);
}

function updateCommandAutocomplete() {
  if (!chatCommandsPopover) return;
  const val = chatInput.value;
  if (val.startsWith('!')) {
    const q = val.toLowerCase().trim();
    const items = chatCommandsPopover.querySelectorAll('.chat-command-item');
    let hasVisible = false;

    items.forEach((item) => {
      const cmd = item.getAttribute('data-command').toLowerCase();
      if (q === '!' || cmd.startsWith(q) || cmd.includes(q.slice(1))) {
        item.style.display = 'flex';
        hasVisible = true;
      } else {
        item.style.display = 'none';
      }
    });

    chatCommandsPopover.style.display = hasVisible ? 'block' : 'none';
    closeEmotePicker();
    closeChatAutocomplete();
  } else {
    chatCommandsPopover.style.display = 'none';
  }
}

function closeCommandAutocomplete() {
  if (chatCommandsPopover) {
    chatCommandsPopover.style.display = 'none';
  }
}

// ── Autocomplete pro chat (:emotes a @mentions) ─────────────────────────
let autocompleteActiveType = null;
let autocompleteSelectedIndex = 0;
let autocompleteItemsData = [];
let autocompleteTokenRange = { start: 0, end: 0 };

function getChatInputTokenAtCursor() {
  const val = chatInput.value;
  const pos = chatInput.selectionStart ?? val.length;
  const textBefore = val.slice(0, pos);

  const match = textBefore.match(/(?:^|\s)([:@][^\s]*)$/);
  if (!match) return null;

  const fullToken = match[1];
  const start = pos - fullToken.length;
  return {
    prefix: fullToken.charAt(0),
    query: fullToken.slice(1),
    start,
    end: pos
  };
}

function updateChatAutocomplete() {
  if (!chatAutocompletePopover) return;

  const tokenInfo = getChatInputTokenAtCursor();
  if (!tokenInfo) {
    closeChatAutocomplete();
    return;
  }

  const { prefix, query, start, end } = tokenInfo;
  autocompleteTokenRange = { start, end };
  autocompleteItemsData = [];

  if (prefix === ':') {
    // Autocomplete pro 7TV emoty
    autocompleteActiveType = 'emote';
    if (chatAutocompleteTag) chatAutocompleteTag.textContent = '[ 7TV EMOTY ]';

    const q = query.toLowerCase();
    if (q.length === 0) {
      autocompleteItemsData = emotesList.slice(0, 15).map(e => ({
        type: 'emote',
        value: e.name,
        display: `:${e.name}:`,
        img: e.url1x || e.url,
        meta: '7TV'
      }));
    } else {
      // Uživatel požaduje: ": xzy" ti da emoty predvolby ktere zacinaji na to pismeno
      const startMatches = emotesList.filter(e => e.name.toLowerCase().startsWith(q));
      let combined = [...startMatches];
      if (combined.length < 6) {
        const includeMatches = emotesList.filter(e => !e.name.toLowerCase().startsWith(q) && e.name.toLowerCase().includes(q));
        combined = combined.concat(includeMatches);
      }
      autocompleteItemsData = combined.slice(0, 15).map(e => ({
        type: 'emote',
        value: e.name,
        display: `:${e.name}:`,
        img: e.url1x || e.url,
        meta: '7TV'
      }));
    }
  } else if (prefix === '@') {
    // Autocomplete pro zmínky online hráčů
    autocompleteActiveType = 'mention';
    if (chatAutocompleteTag) chatAutocompleteTag.textContent = '[ HRÁČI ONLINE ]';

    const q = query.toLowerCase();
    let players = currentRoomPlayers || [];
    let matchedPlayers = [];

    if (q.length === 0) {
      matchedPlayers = players.slice(0, 12);
    } else {
      const starts = players.filter(p => p.name.toLowerCase().startsWith(q));
      const includes = players.filter(p => !p.name.toLowerCase().startsWith(q) && p.name.toLowerCase().includes(q));
      matchedPlayers = starts.concat(includes).slice(0, 12);
    }

    autocompleteItemsData = matchedPlayers.map(p => ({
      type: 'mention',
      value: p.name,
      display: `@${p.name}`,
      isAdmin: !!p.isAdmin,
      initial: (p.name || '?').charAt(0).toUpperCase(),
      meta: p.isAdmin ? '👑 ADMIN' : (p.name === myPlayerName ? 'TY' : 'HRÁČ')
    }));
  }

  if (autocompleteItemsData.length === 0) {
    closeChatAutocomplete();
    return;
  }

  renderAutocompleteItems();
  chatAutocompletePopover.style.display = 'block';
  closeEmotePicker();
  closeCommandAutocomplete();
}

function renderAutocompleteItems() {
  if (!chatAutocompleteList) return;
  chatAutocompleteList.innerHTML = '';
  autocompleteSelectedIndex = 0;

  const fragment = document.createDocumentFragment();
  autocompleteItemsData.forEach((item, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat-autocomplete-item' + (idx === 0 ? ' is-selected' : '');
    btn.setAttribute('data-index', idx);

    let visualHtml = '';
    if (item.type === 'emote') {
      visualHtml = `<img class="chat-autocomplete-img" src="${escapeHtml(item.img)}" alt="" loading="lazy">`;
    } else {
      visualHtml = `<span class="chat-autocomplete-avatar">${escapeHtml(item.initial)}</span>`;
    }

    let metaHtml = '';
    if (item.isAdmin) {
      metaHtml = `<span class="badge-admin" style="font-size: 0.6rem; padding: 1px 4px;">👑 ADMIN</span>`;
    } else {
      metaHtml = `<span class="chat-autocomplete-meta">${escapeHtml(item.meta)}</span>`;
    }

    btn.innerHTML = `
      ${visualHtml}
      <span class="chat-autocomplete-name">${escapeHtml(item.display)}</span>
      ${metaHtml}
    `;

    fragment.appendChild(btn);
  });

  chatAutocompleteList.appendChild(fragment);
}

function updateAutocompleteSelectionUI() {
  if (!chatAutocompleteList) return;
  const items = chatAutocompleteList.querySelectorAll('.chat-autocomplete-item');
  items.forEach((item, idx) => {
    if (idx === autocompleteSelectedIndex) {
      item.classList.add('is-selected');
      item.scrollIntoView({ block: 'nearest' });
    } else {
      item.classList.remove('is-selected');
    }
  });
}

function selectAutocompleteItem(item) {
  if (!item) return;

  const currentVal = chatInput.value;
  const before = currentVal.substring(0, autocompleteTokenRange.start);
  const after = currentVal.substring(autocompleteTokenRange.end);

  const inserted = item.type === 'mention' ? `@${item.value}` : item.value;
  const needSpaceAfter = !after.startsWith(' ');
  const replacement = inserted + (needSpaceAfter ? ' ' : '');

  chatInput.value = before + replacement + after;
  const newCaretPos = before.length + replacement.length;
  chatInput.setSelectionRange(newCaretPos, newCaretPos);
  chatInput.focus();

  closeChatAutocomplete();
}

function closeChatAutocomplete() {
  if (chatAutocompletePopover) {
    chatAutocompletePopover.style.display = 'none';
  }
  autocompleteActiveType = null;
  autocompleteItemsData = [];
}

// Event listenery pro input a popovery
chatInput.addEventListener('input', () => {
  const val = chatInput.value;
  if (val.startsWith('!')) {
    closeChatAutocomplete();
    updateCommandAutocomplete();
  } else {
    closeCommandAutocomplete();
    updateChatAutocomplete();
  }
});

if (chatCommandsPopover) {
  chatCommandsPopover.addEventListener('click', (e) => {
    const item = e.target.closest('.chat-command-item');
    if (!item) return;
    const cmd = item.getAttribute('data-command');
    if (cmd) {
      chatInput.value = cmd;
      closeCommandAutocomplete();
      chatInput.focus();
      const len = chatInput.value.length;
      chatInput.setSelectionRange(len, len);
    }
  });
}

if (chatAutocompletePopover) {
  chatAutocompletePopover.addEventListener('mousedown', (e) => {
    const itemEl = e.target.closest('.chat-autocomplete-item');
    if (!itemEl) return;
    e.preventDefault();
    const idx = parseInt(itemEl.getAttribute('data-index'), 10);
    if (!isNaN(idx) && autocompleteItemsData[idx]) {
      selectAutocompleteItem(autocompleteItemsData[idx]);
    }
  });
}

chatInput.addEventListener('keydown', (e) => {
  // 1. Zpracování pro autocomplete popover (:emotes / @mentions)
  if (chatAutocompletePopover && chatAutocompletePopover.style.display !== 'none' && autocompleteItemsData.length > 0) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      autocompleteSelectedIndex = (autocompleteSelectedIndex + 1) % autocompleteItemsData.length;
      updateAutocompleteSelectionUI();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      autocompleteSelectedIndex = (autocompleteSelectedIndex - 1 + autocompleteItemsData.length) % autocompleteItemsData.length;
      updateAutocompleteSelectionUI();
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const selected = autocompleteItemsData[autocompleteSelectedIndex];
      if (selected) {
        selectAutocompleteItem(selected);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeChatAutocomplete();
      return;
    }
  }

  // 2. Zpracování pro nápovědu příkazů (!)
  if (chatCommandsPopover && chatCommandsPopover.style.display !== 'none') {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeCommandAutocomplete();
      return;
    }
    const visibleItems = Array.from(chatCommandsPopover.querySelectorAll('.chat-command-item')).filter(
      (el) => el.style.display !== 'none'
    );
    if (visibleItems.length > 0 && e.key === 'Tab') {
      e.preventDefault();
      const cmd = visibleItems[0].getAttribute('data-command');
      chatInput.value = cmd;
      closeCommandAutocomplete();
      const len = chatInput.value.length;
      chatInput.setSelectionRange(len, len);
      return;
    }
  }
});

document.addEventListener('click', (e) => {
  if (chatCommandsPopover && chatCommandsPopover.style.display !== 'none') {
    if (!chatCommandsPopover.contains(e.target) && e.target !== chatInput) {
      closeCommandAutocomplete();
    }
  }
  if (chatAutocompletePopover && chatAutocompletePopover.style.display !== 'none') {
    if (!chatAutocompletePopover.contains(e.target) && e.target !== chatInput) {
      closeChatAutocomplete();
    }
  }
});

// DOM – Chat záložky (Místnost vs Globál)
const chatTabRoom = document.getElementById('chat-tab-room');
const chatTabGlobal = document.getElementById('chat-tab-global');
const chatMessagesGlobal = document.getElementById('chat-messages-global');
const globalUnreadDot = document.getElementById('global-unread-dot');
let activeChatTab = 'room'; // 'room' | 'global'

function switchChatTab(tab) {
  activeChatTab = tab;
  if (tab === 'room') {
    if (chatTabRoom) {
      chatTabRoom.classList.add('is-active');
      chatTabRoom.setAttribute('aria-selected', 'true');
    }
    if (chatTabGlobal) {
      chatTabGlobal.classList.remove('is-active');
      chatTabGlobal.setAttribute('aria-selected', 'false');
    }
    if (chatMessages) chatMessages.style.display = 'block';
    if (chatMessagesGlobal) chatMessagesGlobal.style.display = 'none';
    if (chatInput) chatInput.placeholder = 'Napiš zprávu do arény... (např. xdd)';
  } else {
    if (chatTabGlobal) {
      chatTabGlobal.classList.add('is-active');
      chatTabGlobal.setAttribute('aria-selected', 'true');
    }
    if (chatTabRoom) {
      chatTabRoom.classList.remove('is-active');
      chatTabRoom.setAttribute('aria-selected', 'false');
    }
    if (chatMessages) chatMessages.style.display = 'none';
    if (chatMessagesGlobal) chatMessagesGlobal.style.display = 'block';
    if (globalUnreadDot) globalUnreadDot.style.display = 'none';
    if (chatInput) chatInput.placeholder = 'Napiš do globálního chatu pro celou Slovotečku...';
  }
}

if (chatTabRoom) {
  chatTabRoom.addEventListener('click', () => {
    SoundFx.playKeyClick();
    switchChatTab('room');
  });
}
if (chatTabGlobal) {
  chatTabGlobal.addEventListener('click', () => {
    SoundFx.playKeyClick();
    switchChatTab('global');
  });
}

function appendGlobalChatMessage(data) {
  if (!chatMessagesGlobal) return;
  const empty = chatMessagesGlobal.querySelector('.chat-empty');
  if (empty) empty.remove();

  const isMe = myPlayerName && data.sender && myPlayerName.toLowerCase() === data.sender.toLowerCase();
  const div = document.createElement('div');
  div.className = 'chat-msg' + (isMe ? ' is-me' : '');

  const senderColor = data.color ? escapeHtml(data.color) : '#38bdf8';
  const adminBadge = data.isAdmin
    ? ' <span class="badge-admin" title="Administrátor"><span class="badge-admin-crown">👑</span> ADMIN</span>'
    : '';
  const parsedHtml = renderMessageWithEmotes(data.message);

  div.innerHTML = `
    <span class="chat-msg-time">${data.timestamp || ''}</span>
    <span class="chat-msg-badge-global">[GLOBÁL]</span>
    <span class="chat-msg-author" style="color: ${senderColor};">${escapeHtml(data.sender)}${adminBadge}${isMe ? ' (ty)' : ''}:</span>
    <span class="chat-msg-text" data-raw="${escapeHtml(data.message)}">${parsedHtml}</span>
  `;

  chatMessagesGlobal.appendChild(div);

  if (activeChatTab === 'global' || isMe) {
    chatMessagesGlobal.scrollTop = chatMessagesGlobal.scrollHeight;
  } else {
    if (globalUnreadDot) globalUnreadDot.style.display = 'inline-block';
  }

  if (!isMe && chatPanel && !chatPanel.classList.contains('is-open')) {
    if (headerChatDot) headerChatDot.style.display = 'inline-block';
  }
}

socket.on('global_chat_history', (history) => {
  if (!chatMessagesGlobal || !Array.isArray(history)) return;
  chatMessagesGlobal.innerHTML = '';
  if (history.length === 0) {
    chatMessagesGlobal.innerHTML = '<div class="chat-empty">Zatím žádné globální zprávy. Napiš vzkaz pro všechny v arénách!</div>';
    return;
  }
  history.forEach(item => appendGlobalChatMessage(item));
});

socket.on('global_chat_message', (data) => {
  appendGlobalChatMessage(data);
});

// ── 6. Odeslání zprávy do chatu ───────────────────────
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;

  if (activeChatTab === 'global') {
    socket.emit('send_global_chat', { message: text });
    chatInput.value = '';
    closeEmotePicker();
    closeCommandAutocomplete();
    chatInput.focus();
    return;
  }

  const isCustomRoom = Boolean(latestGameState?.isCustomRoom || (currentMode && currentMode.startsWith('custom_')));
  const lowerText = text.toLowerCase().trim();

  if (lowerText.startsWith('!play') || ['!queue', '!fronta', '!skip'].includes(lowerText)) {
    if (!isCustomRoom) {
      showToast('Hudební jukebox (!play) je povolen pouze ve Vlastní aréně (Custom Room)!', true);
      return;
    }
  }

  if (lowerText.startsWith('!play') || ['ano', 'jo', 'yes', 'y', 'jj', '!ano', '!yes'].includes(lowerText)) {
    musicAllowed = true;
    try {
      sessionStorage.setItem('slovotecka_music_allowed', 'true');
    } catch (err) {}
    if (ytPlayer && typeof ytPlayer.unMute === 'function') {
      try {
        ytPlayer.unMute();
        ytPlayer.setVolume(currentVolume);
      } catch (err) {}
    }
  } else if (lowerText === '!stop') {
    musicAllowed = false;
    try {
      sessionStorage.removeItem('slovotecka_music_allowed');
    } catch (err) {}
    stopMusicLocal();
    showToast('⏹️ Hudba zastavena pro tebe.');
  }

  socket.emit('send_chat', { message: text });
  chatInput.value = '';
  closeEmotePicker();
  closeCommandAutocomplete();
  chatInput.focus();
});

// ── Server události ───────────────────────────────────
socket.on('error_message', (data) => {
  triggerInputShake();
  SoundFx.playError();
  showToast(data.message, true);
  setFeedback(data.message);
});

socket.on('notification', (data) => {
  showToast(data.message);
  setFeedback('');
});

socket.on('chat_message', (data) => {
  appendChatMessage(data);
});

socket.on('chat_cleared', () => {
  chatMessages.innerHTML = '<div class="chat-empty">🧹 Chat byl promazán administrátorem.</div>';
  showToast('🧹 Chat byl promazán administrátorem.');
});

socket.on('kicked', (data) => {
  alert(data?.message || 'Byl(a) jsi vyhozen(a) z arény administrátorem.');
  window.location.reload();
});

const chatUnreadBadge = document.getElementById('chat-unread-badge');

function isChatScrolledNearBottom() {
  if (!chatMessages) return true;
  const threshold = 70; // px od spodního okraje
  return chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight <= threshold;
}

if (chatUnreadBadge) {
  chatUnreadBadge.addEventListener('click', () => {
    SoundFx.playKeyClick();
    if (chatMessages) {
      chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' });
    }
    chatUnreadBadge.style.display = 'none';
  });
}

if (chatMessages) {
  chatMessages.addEventListener('scroll', () => {
    if (isChatScrolledNearBottom() && chatUnreadBadge) {
      chatUnreadBadge.style.display = 'none';
    }
  });
}

function appendChatMessage(data) {
  const emptyMsg = chatMessages.querySelector('.chat-empty');
  if (emptyMsg) emptyMsg.remove();

  const isMe = data.player === myPlayerName;
  const isTelegraph = data.player === '⚡ TELEGRAPH' || (typeof data.player === 'string' && data.player.includes('TELEGRAPH'));
  const div = document.createElement('div');
  let msgCls = 'chat-msg';
  if (isMe) msgCls += ' is-me';
  if (isTelegraph) msgCls += ' is-telegraph';
  div.className = msgCls;

  if (isTelegraph) {
    SoundFx.playHot();
  }

  // Zvýraznění zprávy pouze pokud tě zmíní někdo jiný (@myPlayerName)
  if (myPlayerName && !isMe) {
    const escapedMyName = myPlayerName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const mentionRegex = new RegExp(`@${escapedMyName}(?=[\\s.,!?:;]|$)`, 'i');
    if (mentionRegex.test(data.message)) {
      div.classList.add('has-mention');
      showToast(`💬 ${data.player} tě zmínil(a) v chatu!`);
    }
  }

  const parsedHtml = renderMessageWithEmotes(data.message);

  const adminBadge = data.isAdmin
    ? ' <span class="badge-admin" title="Administrátor"><span class="badge-admin-crown">👑</span> ADMIN</span>'
    : '';

  let confirmBoxHtml = '';
  if (data.confirmAction) {
    const isTarget = myPlayerName && data.confirmAction.targetPlayer &&
      myPlayerName.toLowerCase() === data.confirmAction.targetPlayer.toLowerCase();
    confirmBoxHtml = `
      <div class="chat-confirm-box" id="confirm-box-${escapeHtml(data.confirmAction.confirmId)}">
        <button type="button" class="chat-confirm-btn chat-confirm-yes" data-action="yes" data-id="${escapeHtml(data.confirmAction.confirmId)}" data-target="${escapeHtml(data.confirmAction.targetPlayer)}" title="${isTarget ? 'Potvrdit přehrání skladby' : 'Může potvrdit jen ' + escapeHtml(data.confirmAction.targetPlayer)}">ANO</button>
        <button type="button" class="chat-confirm-btn chat-confirm-no" data-action="no" data-id="${escapeHtml(data.confirmAction.confirmId)}" data-target="${escapeHtml(data.confirmAction.targetPlayer)}" title="${isTarget ? 'Zrušit výběr skladby' : 'Může zrušit jen ' + escapeHtml(data.confirmAction.targetPlayer)}">NE</button>
      </div>
    `;
  }

  const authorColor = data.playerColor ? escapeHtml(data.playerColor) : '';
  const authorStyle = authorColor ? `style="color: ${authorColor};"` : '';

  div.innerHTML = `
    <span class="chat-msg-time">${data.time || ''}</span>
    <span class="chat-msg-author" ${authorStyle}>${escapeHtml(data.player)}${adminBadge}${isMe ? ' (ty)' : ''}:</span>
    <span class="chat-msg-text" data-raw="${escapeHtml(data.message)}">${parsedHtml}</span>
    ${confirmBoxHtml}
  `;

  if (data.confirmAction) {
    const box = div.querySelector('.chat-confirm-box');
    if (box) {
      box.addEventListener('click', (e) => {
        const btn = e.target.closest('.chat-confirm-btn');
        if (!btn) return;
        const targetPlayer = btn.dataset.target;
        const isTarget = myPlayerName && targetPlayer && myPlayerName.toLowerCase() === targetPlayer.toLowerCase();
        if (!isTarget) {
          showToast(`Tuto volbu může potvrdit pouze ${targetPlayer}.`, true);
          return;
        }
        const isYes = btn.dataset.action === 'yes';
        const confirmId = btn.dataset.id;
        if (isYes) {
          musicAllowed = true;
          try { sessionStorage.setItem('slovotecka_music_allowed', 'true'); } catch (err) {}
          if (ytPlayer && typeof ytPlayer.unMute === 'function') {
            try {
              ytPlayer.unMute();
              ytPlayer.setVolume(currentVolume);
            } catch (err) {}
          }
        }
        socket.emit('confirm_play_song', { confirm: isYes, confirmId });
        box.innerHTML = `<span class="chat-confirmed-badge ${isYes ? 'badge-yes' : 'badge-no'}">${isYes ? '✓ Potvrzeno (ANO)' : '✕ Zrušeno (NE)'}</span>`;
      });
    }
  }

  const wasAtBottom = isChatScrolledNearBottom();

  chatMessages.appendChild(div);

  if (isMe || wasAtBottom) {
    chatMessages.scrollTop = chatMessages.scrollHeight;
    if (chatUnreadBadge) chatUnreadBadge.style.display = 'none';
  } else {
    if (chatUnreadBadge) chatUnreadBadge.style.display = 'block';
  }

  if (!isMe && chatPanel && !chatPanel.classList.contains('is-open')) {
    if (headerChatDot) headerChatDot.style.display = 'inline-block';
  }
}

// ── Vykreslení stavu denní hry ────────────────────────
socket.on('game_state', (state) => {
  renderGameState(state);
});

socket.on('top_50_data', (data) => {
  currentTop50Data = data;
  renderTop50Modal(data);
  showTop50Modal();
});

socket.on('poll_update', (poll) => {
  renderPoll(poll);
});

let chatLoaded = false;

function renderGameState(state) {
  latestGameState = state;

  if (state.top50) {
    currentTop50Data = { word: state.secretWord, top50: state.top50 };
  }

  if (state.poll !== undefined) {
    renderPoll(state.poll);
  }

  // Synchronizace online hráčů pro @mentions
  currentRoomPlayers = state.players || [];

  // Přepnutí do herní plochy
  hideWhatsNew();
  lobbySection.style.display = 'none';
  gameSection.style.display = 'block';

  // Přizpůsobení podle režimu (vlastní aréna vs neomezený vs denní)
  const isCustom = Boolean(state.isCustomRoom || (state.mode && state.mode.startsWith('custom_')));
  if (isCustom) {
    if (displayModeLabel) displayModeLabel.textContent = '[ VLASTNÍ ARÉNA ]';
    if (displayDayTitle) displayDayTitle.textContent = state.isDailyEligible ? 'DENNÍ SLOVO' : `ARCHIV #${state.dayNumber || '?'}`;
    if (displayMetaText) displayMetaText.textContent = state.isDailyEligible ? 'ZAPOČÍTÁVÁ SE DO STATŮ' : 'ARCHIVNÍ SADA';
    if (secretLabel) secretLabel.textContent = '[ TAJNÉ SLOVO ARÉNY ]';

    if (customShareBadge) {
      customShareBadge.style.display = 'inline-flex';
      if (displayCustomCode) displayCustomCode.textContent = state.roomCode || '-----';
    }

    if (voteBar) {
      if (state.wordSource === 'archive' && state.voting) {
        voteBar.style.display = 'flex';
        const { votesCount, requiredVotes, hasVoted, totalPlayers } = state.voting;
        if (voteCountBadge) voteCountBadge.textContent = `${votesCount} / ${requiredVotes} HLASŮ`;
        if (btnVoteNewWord && btnVoteText) {
          btnVoteNewWord.classList.toggle('voted', hasVoted);
          btnVoteText.textContent = hasVoted ? 'ZRUŠIT HLAS PRO NOVÉ SLOVO' : 'HLASOVAT PRO NOVÉ SLOVO';
        }
        if (voteDesc) {
          voteDesc.textContent = `Hlasování o další archivní slovo (${votesCount}/${requiredVotes}).`;
        }
      } else {
        voteBar.style.display = 'none';
      }
    }
  } else if (state.mode === 'unlimited') {
    if (displayModeLabel) displayModeLabel.textContent = '[ UNLIMITED REŽIM ]';
    displayDayTitle.textContent = `ARCHIV #${state.dayNumber || '?'}`;
    if (displayMetaText) displayMetaText.textContent = 'ARCHIVNÍ SADA';
    if (secretLabel) secretLabel.textContent = '[ ARCHIVNÍ TAJNÉ SLOVO ]';
    if (customShareBadge) customShareBadge.style.display = 'none';

    if (voteBar) {
      voteBar.style.display = 'flex';
      if (state.voting) {
        const { votesCount, requiredVotes, hasVoted, totalPlayers } = state.voting;
        if (voteCountBadge) {
          voteCountBadge.textContent = `${votesCount} / ${requiredVotes} HLASŮ`;
        }
        if (btnVoteNewWord && btnVoteText) {
          if (hasVoted) {
            btnVoteNewWord.classList.add('voted');
            btnVoteText.textContent = 'ZRUŠIT HLAS PRO NOVÉ SLOVO';
          } else {
            btnVoteNewWord.classList.remove('voted');
            btnVoteText.textContent = 'HLASOVAT PRO NOVÉ SLOVO';
          }
        }
        if (voteDesc) {
          voteDesc.textContent = `Když zahlasuje alespoň ${requiredVotes} ${requiredVotes === 1 ? 'hráč' : requiredVotes < 5 ? 'hráči' : 'hráčů'} z ${totalPlayers} online, vylosuje se nové slovo.`;
        }
      }
    }
  } else {
    if (displayModeLabel) displayModeLabel.textContent = '[ DENNÍ VÝZVA ]';
    displayDayTitle.textContent = `Den #${state.dayNumber || '1'}`;
    if (displayMetaText) displayMetaText.textContent = 'RESET O PŮLNOCI';
    if (secretLabel) secretLabel.textContent = '[ DNEŠNÍ TAJNÉ SLOVO ]';
    if (customShareBadge) customShareBadge.style.display = 'none';
    if (voteBar) voteBar.style.display = 'none';
  }

  // Datum / info
  displayDate.textContent = state.date;

  // Nápověda (skrytá / odemčená s klaunem)
  if (state.hasUsedHint && state.hint) {
    hintLocked.style.display = 'none';
    hintRevealed.style.display = 'flex';
    displayHint.textContent = state.hint;
  } else {
    hintLocked.style.display = 'flex';
    hintRevealed.style.display = 'none';
    displayHint.textContent = '';
  }

  // Tajné slovo (vidí ten kdo uhodl nebo se vzdal)
  if (state.secretWord) {
    secretWordBox.style.display = 'flex';
    displaySecretWord.textContent = state.secretWord;
  } else {
    secretWordBox.style.display = 'none';
  }

  // Stav ovládání
  if (state.myStatus) {
    myIsAdmin = !!state.myStatus.isAdmin;
    if (state.myStatus.color) {
      myPlayerColor = state.myStatus.color;
      try {
        localStorage.setItem('slovotecka_color', myPlayerColor);
      } catch (e) {}
      updatePlayerColorUI(myPlayerColor);
    }
    if (state.myStatus.name) {
      myPlayerName = state.myStatus.name;
      try {
        localStorage.setItem('slovotecka_nickname', myPlayerName);
      } catch (e) {}
    }
    renderAdminCommandsInPopover();

    const locked = state.myStatus.solved || state.myStatus.gaveUp;
    guessInput.disabled = locked;
    btnSubmitGuess.disabled = locked;
    btnRevealWord.disabled = locked;

    if (state.myStatus.solved) {
      setFeedback(state.mode === 'unlimited' ? 'Toto archivní slovo jsi úspěšně uhodl(a)! Můžeš sledovat tipy ostatních naživo nebo hlasovat pro další slovo.' : 'Dnešní slovo jsi úspěšně uhodl(a)! Nyní jsi v diváckém módu.');
    } else if (state.myStatus.gaveUp) {
      setFeedback('Vzdal(a) ses v tomto kole – hádání je uzamčeno. Nyní jsi v diváckém módu.');
    } else {
      setFeedback('');
    }
  }

  // Divácký mód UI (subtilní lišta v hlavičce odhalených slov)
  const isSpectator = !!state.isSpectator || (state.myStatus && (state.myStatus.solved || state.myStatus.gaveUp));

  if (spectatorToolbar) {
    spectatorToolbar.style.display = isSpectator ? 'inline-flex' : 'none';
  }
  if (spectatorBanner) {
    spectatorBanner.style.display = 'none';
  }
  if (guessesTitle) {
    guessesTitle.textContent = '[ ODHALENÁ SLOVA ]';
  }

  // TOP 50 tlačítko v horní liště – zobrazit POUZE pokud se hráč vzdal nebo heslo uhodl
  const canSeeTop50 = !!(state.myStatus && (state.myStatus.solved || state.myStatus.gaveUp));
  const navTop50 = document.getElementById('btn-nav-top50');
  if (navTop50) {
    navTop50.style.display = canSeeTop50 ? 'inline-flex' : 'none';
  }

  if (top50Modal && top50Modal.style.display === 'flex' && currentTop50Data) {
    renderTop50Modal(currentTop50Data);
  }

  // Zpracování posledního tipu hráče (Contexto styl přímo pod polem)
  const myGuesses = state.guesses.filter(
    (g) => g.isMine || (myPlayerName && g.player.toLowerCase() === myPlayerName.toLowerCase())
  );
  myGuesses.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  const lastGuess = myGuesses[0] || null;

  // Záznam odehrané hry a výhry pro legitimaci hráče
  if (myPlayerName) {
    let statGameType = 'daily';
    if (isCustom) {
      statGameType = state.isDailyEligible ? 'custom_daily' : 'custom_archive';
    } else if (state.mode === 'unlimited') {
      statGameType = 'unlimited';
    }
    const currentGameId = `${statGameType}_${state.dayNumber || state.date || state.roomCode || 'round'}`;
    PlayerStats.recordGameEntry(currentGameId);
    if (state.myStatus && state.myStatus.solved) {
      const winGuesses = (typeof state.myStatus.guessCount === 'number') ? state.myStatus.guessCount : myGuesses.length;
      PlayerStats.recordGameWin(currentGameId, winGuesses);
    }
  }

  if (lastGuess && lastGuessContainer) {
    lastGuessContainer.style.display = 'block';
    lastGuessWord.textContent = lastGuess.word;
    lastGuessRank.textContent = lastGuess.rank;

    const { width, bg } = getBarStyles(lastGuess.rank);
    lastGuessFill.style.width = width;
    lastGuessFill.style.backgroundColor = bg;

    // Zvukový feedback pouze při novém vlastním tipu
    if (initialGameStateRendered && lastGuess.id !== previousLastGuessId) {
      if (lastGuess.rank === 1) {
        SoundFx.playWin();
      } else if (lastGuess.rank <= 300) {
        SoundFx.playHot();
      } else if (lastGuess.rank <= 1500) {
        SoundFx.playWarm();
      } else {
        SoundFx.playCold();
      }
    }
    previousLastGuessId = lastGuess.id;
  } else if (lastGuessContainer) {
    lastGuessContainer.style.display = 'none';
  }
  initialGameStateRendered = true;

  // Hráči online
  updateHeaderPlayersCount();
  if (playersPopover && playersPopover.style.display !== 'none') {
    renderPlayersPopover();
  }

  // Filtrování tipů pro zobrazení (v diváckém módu podle záložky: všechny vs pouze moje)
  const displayGuesses = (isSpectator && spectatorFilterMode === 'mine')
    ? state.guesses.filter(g => g.isMine || (myPlayerName && g.player.toLowerCase() === myPlayerName.toLowerCase()))
    : state.guesses;

  // Tipy seřazené dle zvoleného módu: # blízkost vs čas zadání
  let sorted;
  if (guessSortMode === 'time') {
    sorted = [...displayGuesses].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  } else {
    sorted = [...displayGuesses].sort((a, b) => a.rank - b.rank || (a.timestamp || 0) - (b.timestamp || 0));
  }

  // Mechanické páskové počítadlo zobrazuje OSOBNÍ počet pokusů hráče (např. 4 i při výhře/divákovi)
  const myPersonalGuessesCount = (state.myStatus && typeof state.myStatus.guessCount === 'number')
    ? state.myStatus.guessCount
    : myGuesses.length;

  if (isSpectator && spectatorFilterMode === 'all') {
    guessesCount.textContent = `${displayGuesses.length} tipů (${myPersonalGuessesCount} tvých)`;
  } else {
    guessesCount.textContent = `${myPersonalGuessesCount} ${myPersonalGuessesCount === 1 ? 'tip' : myPersonalGuessesCount < 5 ? 'tipy' : 'tipů'}`;
  }
  updateTapeCounter(myPersonalGuessesCount);

  if (sorted.length === 0) {
    if (isSpectator && spectatorFilterMode === 'mine') {
      guessesList.innerHTML = `<div class="empty-guesses">ZATÍM JSI NEZADAL(A) ŽÁDNÉ VLASTNÍ TIPY.</div>`;
    } else {
      guessesList.innerHTML = `<div class="empty-guesses">ZATÍM ŽÁDNÉ TIPY. ZAČNI HÁDAT DNEŠNÍ SLOVO!</div>`;
    }
  } else {
    guessesList.innerHTML = '';
    sorted.forEach((g) => {
      const card = document.createElement('div');
      const isMine = g.isMine || (myPlayerName && g.player.toLowerCase() === myPlayerName.toLowerCase());
      const isShared = !isMine && g.isShared;
      const isOther = !isMine && !g.isShared;
      const isLast = lastGuess && g.id === lastGuess.id;

      let cls = 'guess-card';
      if (isMine) cls += ' is-me';
      else if (isShared) cls += ' is-shared';
      else if (isOther) cls += ' is-other is-spectator-guess';

      if (isLast) cls += ' is-last-guess is-new-guess';
      if (g.isWinner) cls += ' is-winner';
      card.className = cls;

      const { width, bg } = getBarStyles(g.rank);
      const rClass = rankClass(g.rank);

      const wordText = escapeHtml(g.word);
      const pColor = g.playerColor ? escapeHtml(g.playerColor) : '';
      const colorStyle = pColor ? `style="color: ${pColor}; border-color: ${pColor}55;"` : '';

      let whoHtml = '';
      if (isMine) {
        whoHtml = `<span class="badge-you">(ty)</span>`;
      } else if (isShared) {
        whoHtml = `<span class="who-other" ${colorStyle}>${escapeHtml(g.player)}</span> <span class="badge-shared">[společné]</span>`;
      } else {
        whoHtml = `<span class="who-other who-spectator-other" ${colorStyle}>${escapeHtml(g.player)}</span>`;
      }

      card.innerHTML = `
        <div class="guess-card-bar-bg" style="width: ${width}; background-color: ${bg};"></div>
        <div class="guess-card-content">
          <div class="guess-card-left">
            <span class="guess-card-word my-word">${wordText}</span>
            <span class="guess-card-who">${whoHtml}</span>
          </div>
          <span class="guess-card-rank ${rClass}">${g.rank}</span>
        </div>
      `;
      guessesList.appendChild(card);
    });
  }

  // Načtení historie chatu při prvním vstupu
  if (!chatLoaded && state.chatHistory && state.chatHistory.length > 0) {
    chatMessages.innerHTML = '';
    state.chatHistory.forEach(msg => appendChatMessage(msg));
    chatLoaded = true;
  }

  // Synchronizace hudby s herním stavem – povolena POUZE ve Vlastní aréně
  if (!isCustom) {
    if (floatingGramophone) floatingGramophone.style.display = 'none';
    if (musicBar) musicBar.style.display = 'none';
    scheduleSidebarBoundsUpdate();
    if (activeTrack) stopMusicLocal();
  } else if (state.currentMusic) {
    if (state.currentMusic.serverTime) {
      syncServerTime(state.currentMusic.serverTime);
    }
    const trackKey = `${state.currentMusic.videoId}_${state.currentMusic.startedAt || 0}`;
    if (failedTrackKeys.has(trackKey)) {
      // Tato skladba již selhala – nepokoušíme se ji znovu načítat ani nehlásíme chybu
      return;
    }

    const isDifferentTrack = !activeTrack ||
      activeTrack.videoId !== state.currentMusic.videoId ||
      activeTrack.startedAt !== state.currentMusic.startedAt;

    if (isDifferentTrack) {
      playTrack(state.currentMusic);
    } else {
      activeTrack.startedAt = state.currentMusic.startedAt;
      activeTrack.title = state.currentMusic.title;
      updateMusicSkipUI(
        state.currentMusic.skipVotes,
        state.currentMusic.requiredSkipVotes,
        state.currentMusic.hasVotedSkip
      );
      updateMusicQueueUI(
        state.currentMusic.queue,
        state.currentMusic.queueLength
      );
    }
  } else if (activeTrack) {
    stopMusicLocal();
  }
}

function syncServerTime(serverTime) {
  if (typeof serverTime === 'number' && !isNaN(serverTime)) {
    serverClockOffset = Date.now() - serverTime;
  }
}

function getSyncServerNow() {
  return Date.now() - serverClockOffset;
}

function getTrackElapsedTime(track) {
  if (!track || !track.startedAt) return 0;
  return Math.max(0, (getSyncServerNow() - track.startedAt) / 1000);
}

// Výchozí hlasitost 20% ("aby to nebylo nahlas prvně") s uložením do localStorage
let currentVolume = 20;
const savedVol = localStorage.getItem('slovotecka_music_volume');
if (savedVol !== null) {
  const parsed = parseInt(savedVol, 10);
  if (!isNaN(parsed) && parsed >= 0 && parsed <= 100) {
    currentVolume = parsed;
  }
}
if (musicVolumeSlider) musicVolumeSlider.value = currentVolume;
if (musicVolumeVal) musicVolumeVal.textContent = `${currentVolume}%`;

// Robustní inicializace YouTube Iframe API
function initYouTubePlayer() {
  if (ytPlayer) return;
  if (!window.YT || !window.YT.Player) return;
  const target = document.getElementById('yt-player');
  if (!target) return;

  try {
    ytPlayer = new YT.Player('yt-player', {
      height: '200',
      width: '200',
      playerVars: {
        autoplay: 1,
        controls: 0,
        disablekb: 1,
        fs: 0,
        modestbranding: 1,
        playsinline: 1,
        rel: 0,
        origin: window.location.origin
      },
      events: {
        onReady: (e) => {
          isYtReady = true;
          try {
            e.target.setVolume(currentVolume);
          } catch (err) {}

          const toPlay = activeTrack || pendingTrack;
          if (toPlay && musicAllowed) {
            pendingTrack = null;
            playTrack(toPlay);
          }
        },
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.PLAYING) {
            isLocalPaused = false;
            updateVinylState(true, false, activeTrack ? activeTrack.videoId : null);
            if (musicToggleIcon) musicToggleIcon.textContent = '⏸';
            if (btnMusicToggle) btnMusicToggle.title = 'Pozastavit hudbu pro tebe';

            if (activeTrack) {
              const cur = (typeof ytPlayer.getCurrentTime === 'function') ? (ytPlayer.getCurrentTime() || 0) : 0;
              const target = getTrackElapsedTime(activeTrack);

              if (target <= 2.0) {
                // Nová skladba začíná striktně od 0:00 pro všechny
                if (cur > 1.5 || needSeekToZero) {
                  try { ytPlayer.seekTo(0, true); } catch (err) {}
                }
                needSeekToZero = false;
                pendingSyncTarget = null;
              } else {
                // Skladba již běží (např. hráč zapnul hudbu po minutě)
                if (pendingSyncTarget !== null || Math.abs(cur - target) > 2.0) {
                  try { ytPlayer.seekTo(target, true); } catch (err) {}
                  pendingSyncTarget = null;
                }
              }
            }
          } else if (e.data === YT.PlayerState.PAUSED) {
            isLocalPaused = true;
            updateVinylState(false, true, activeTrack ? activeTrack.videoId : null);
            if (musicToggleIcon) musicToggleIcon.textContent = '▶';
            if (btnMusicToggle) btnMusicToggle.title = 'Spustit hudbu';
          } else if (e.data === YT.PlayerState.ENDED) {
            updateVinylState(false, false, null);
            if (activeTrack) {
              socket.emit('track_ended', { videoId: activeTrack.videoId });
            }
            stopMusicLocal();
          } else if (e.data === YT.PlayerState.CUED || e.data === YT.PlayerState.BUFFERING) {
            if (isLocalPaused && musicToggleIcon) {
              musicToggleIcon.textContent = '▶';
            }
            if (activeTrack) {
              const target = getTrackElapsedTime(activeTrack);
              if (target <= 2.0 && needSeekToZero) {
                try { ytPlayer.seekTo(0, true); } catch (err) {}
              } else if (target > 2.0 && pendingSyncTarget !== null) {
                try { ytPlayer.seekTo(target, true); } catch (err) {}
              }
            }
          }
        },
        onError: (e) => {
          console.warn('Chyba YouTube přehrávače:', e.data);
          const currentVid = (activeTrack && activeTrack.videoId) || (pendingTrack && pendingTrack.videoId) || null;
          const currentStartedAt = (activeTrack && activeTrack.startedAt) || (pendingTrack && pendingTrack.startedAt) || 0;
          const trackKey = currentVid ? `${currentVid}_${currentStartedAt}` : null;

          if (trackKey) {
            if (failedTrackKeys.has(trackKey)) {
              return;
            }
            failedTrackKeys.add(trackKey);
            if (failedTrackKeys.size > 100) {
              const first = failedTrackKeys.values().next().value;
              failedTrackKeys.delete(first);
            }
          }

          showToast('Skladbu nelze přehrát (autorská práva nebo omezení vloženého videa).', true);
          if (currentVid) {
            socket.emit('track_failed', { videoId: currentVid, error: e.data });
          }
          stopMusicLocal();
        }
      }
    });
  } catch (err) {
    console.error('Chyba při vytváření YT.Player:', err);
  }
}

// 1. YouTube API callback
window.onYouTubeIframeAPIReady = function() {
  initYouTubePlayer();
};

// 2. Pokud už je YT API načtené dřív než app.js
if (window.YT && window.YT.Player) {
  initYouTubePlayer();
} else if (window.YT && typeof window.YT.ready === 'function') {
  window.YT.ready(initYouTubePlayer);
}

// 3. Fallback interval pro načtení API
const ytInitInterval = setInterval(() => {
  if (ytPlayer && isYtReady) {
    clearInterval(ytInitInterval);
    return;
  }
  if (window.YT && window.YT.Player) {
    initYouTubePlayer();
  }
}, 300);
setTimeout(() => clearInterval(ytInitInterval), 15000);

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function updateMusicQueueUI(queue, queueLength) {
  const len = queueLength !== undefined ? queueLength : (queue ? queue.length : 0);
  if (musicQueueBadge) {
    musicQueueBadge.textContent = len;
    if (len > 0) {
      musicQueueBadge.classList.add('has-items');
    } else {
      musicQueueBadge.classList.remove('has-items');
    }
  }

  if (musicQueueBody) {
    if (!queue || queue.length === 0) {
      musicQueueBody.innerHTML = '<div class="queue-empty">Fronta je prázdná. Přidej skladbu příkazem <code>!play &lt;název / odkaz&gt;</code></div>';
    } else {
      musicQueueBody.innerHTML = queue.map((item, idx) => {
        const pos = item.position || (idx + 1);
        const safeTitle = escapeHtml(item.title || 'Neznámá skladba');
        const safeReq = item.requestedBy ? `(od ${escapeHtml(item.requestedBy)})` : '';
        return `
          <div class="queue-item">
            <span class="queue-num">#${pos}</span>
            <span class="queue-item-title" title="${safeTitle}">${safeTitle}</span>
            <span class="queue-item-req">${safeReq}</span>
          </div>
        `;
      }).join('');
    }
  }
}

function updateMusicSkipUI(skipVotes, requiredSkipVotes, hasVotedSkip) {
  if (musicSkipBadge) {
    musicSkipBadge.textContent = `${skipVotes || 0}/${requiredSkipVotes || 1}`;
  }
  if (btnMusicSkip) {
    if (hasVotedSkip) {
      btnMusicSkip.classList.add('has-voted');
      btnMusicSkip.title = `Hlasoval(a) jsi pro přeskočení (${skipVotes}/${requiredSkipVotes}). Kliknutím hlas zrušíš.`;
    } else {
      btnMusicSkip.classList.remove('has-voted');
      btnMusicSkip.title = `Hlasovat pro přeskočení skladby (!skip, aktuálně ${skipVotes || 0}/${requiredSkipVotes || 1})`;
    }
  }
  if (btnGramophoneSkip) {
    if (hasVotedSkip) {
      btnGramophoneSkip.classList.add('has-voted');
      btnGramophoneSkip.title = `Hlasoval(a) jsi pro přeskočení (${skipVotes || 0}/${requiredSkipVotes || 1}).`;
    } else {
      btnGramophoneSkip.classList.remove('has-voted');
      btnGramophoneSkip.title = `Hlasovat pro přeskočení (!skip, ${skipVotes || 0}/${requiredSkipVotes || 1})`;
    }
  }
}

function playTrack(track) {
  if (!track || !track.videoId) return;

  const isCustom = Boolean(latestGameState?.isCustomRoom || (currentMode && currentMode.startsWith('custom_')));
  if (!isCustom) {
    return;
  }

  const trackKey = `${track.videoId}_${track.startedAt || 0}`;
  if (failedTrackKeys.has(trackKey)) {
    return;
  }

  if (track.serverTime) {
    syncServerTime(track.serverTime);
  }

  activeTrack = track;
  if (musicBar) musicBar.style.display = 'block';
  scheduleSidebarBoundsUpdate();
  if (floatingGramophone) floatingGramophone.style.display = 'flex';
  if (musicTitle) {
    musicTitle.textContent = track.title || `YouTube video (${track.videoId})`;
    musicTitle.title = track.title || '';
  }
  if (gramophoneTitle) {
    gramophoneTitle.textContent = track.title || `YouTube video (${track.videoId})`;
    gramophoneTitle.title = track.title || '';
  }
  if (musicRequester) {
    musicRequester.textContent = track.requestedBy ? `(od ${track.requestedBy})` : '';
  }
  if (gramophoneRequester) {
    gramophoneRequester.textContent = track.requestedBy ? `(od ${track.requestedBy})` : '';
  }

  updateMusicSkipUI(track.skipVotes, track.requiredSkipVotes, track.hasVotedSkip);
  updateMusicQueueUI(track.queue, track.queueLength);

  // Každý si musí hudbu explicitně zapnout ("jak přijde, musí si to každý zapnout")
  if (!musicAllowed) {
    updateVinylState(false, true, track.videoId);
    if (btnMusicEnable) btnMusicEnable.style.display = 'inline-flex';
    if (musicControlsActive) musicControlsActive.style.display = 'none';
    if (musicTime) {
      musicTime.textContent = 'VYPNUTO';
      musicTime.title = 'Hudba je pro tebe ztlumená. Klikni na ZAPNOUT HUDBU.';
    }
    if (musicProgressBar) musicProgressBar.style.width = '0%';
    return;
  }

  // Uživatel si hudbu zapnul
  updateVinylState(true, false, track.videoId);
  if (btnMusicEnable) btnMusicEnable.style.display = 'none';
  if (musicControlsActive) musicControlsActive.style.display = 'flex';

  const elapsed = getTrackElapsedTime(track);
  if (elapsed <= 2.0) {
    needSeekToZero = true;
    pendingSyncTarget = 0;
  } else {
    needSeekToZero = false;
    pendingSyncTarget = elapsed;
  }

  if (!isYtReady || !ytPlayer || typeof ytPlayer.loadVideoById !== 'function') {
    pendingTrack = track;
    initYouTubePlayer();
    if (musicTime) musicTime.textContent = 'NAČÍTÁM...';
    return;
  }

  try {
    const startSec = elapsed <= 2.0 ? 0 : Math.floor(elapsed);
    ytPlayer.loadVideoById({
      videoId: track.videoId,
      startSeconds: startSec
    });
    if (startSec > 0) {
      try {
        ytPlayer.seekTo(startSec, true);
      } catch (e) {}
    }
    ytPlayer.setVolume(currentVolume);
    if (isLocalMuted) {
      ytPlayer.mute();
    } else {
      ytPlayer.unMute();
    }
    ytPlayer.playVideo();
    isLocalPaused = false;
    if (musicToggleIcon) musicToggleIcon.textContent = '⏸';
  } catch (err) {
    console.error('Chyba při přehrávání videa:', err);
  }

  if (musicTicker) clearInterval(musicTicker);
  tickMusic();
  musicTicker = setInterval(tickMusic, 500);
}

function tickMusic() {
  if (!ytPlayer || typeof ytPlayer.getCurrentTime !== 'function') return;
  try {
    const cur = ytPlayer.getCurrentTime() || 0;
    const dur = ytPlayer.getDuration() || 0;

    // Periodická synchronizace s místností
    if (activeTrack && musicAllowed && !isLocalPaused && typeof ytPlayer.getPlayerState === 'function') {
      const pState = ytPlayer.getPlayerState();
      if (pState === YT.PlayerState.PLAYING) {
        const target = getTrackElapsedTime(activeTrack);

        if (target <= 2.0) {
          // Nová skladba od 00:00 pro všechny
          if (cur > 2.0 && cur < 6.0 && needSeekToZero) {
            try { ytPlayer.seekTo(0, true); } catch (e) {}
            needSeekToZero = false;
          }
        } else {
          // Skladba běží v čase - pokud už na serveru vypršela
          if (dur > 0 && target >= dur) {
            if (activeTrack) {
              socket.emit('track_ended', { videoId: activeTrack.videoId });
            }
            stopMusicLocal();
            return;
          }
          // Pokud je hráč mimo synchronizaci o více než 2.5s (např. začal od 0:00 místo 1:00)
          if (Math.abs(cur - target) > 2.5) {
            try { ytPlayer.seekTo(target, true); } catch (e) {}
          }
        }
      }
    }

    if (dur > 0) {
      const remaining = Math.max(0, dur - cur);
      const remM = Math.floor(remaining / 60);
      const remS = Math.floor(remaining % 60).toString().padStart(2, '0');

      if (musicTime) {
        musicTime.textContent = `-${remM}:${remS}`;
        musicTime.title = `${formatTime(cur)} / ${formatTime(dur)} (zbývá ${remM}:${remS})`;
      }
      if (gramophoneTime) {
        gramophoneTime.textContent = `-${remM}:${remS}`;
      }

      if (musicProgressBar) {
        const pct = Math.min(100, Math.max(0, (cur / dur) * 100));
        musicProgressBar.style.width = `${pct}%`;
      }

      if (cur >= dur - 0.5) {
        if (activeTrack) {
          socket.emit('track_ended', { videoId: activeTrack.videoId });
        }
        stopMusicLocal();
      }
    } else {
      const formatted = cur > 0 ? formatTime(cur) : '0:00';
      if (musicTime) musicTime.textContent = formatted;
      if (gramophoneTime) gramophoneTime.textContent = formatted;
      if (musicProgressBar) musicProgressBar.style.width = `0%`;
    }
  } catch (err) {
    // Tiché zachycení chyb během načítání
  }
}

function stopMusicLocal() {
  activeTrack = null;
  pendingTrack = null;
  updateVinylState(false, false, null);
  if (musicTicker) {
    clearInterval(musicTicker);
    musicTicker = null;
  }
  if (ytPlayer && typeof ytPlayer.stopVideo === 'function') {
    try {
      ytPlayer.stopVideo();
    } catch (e) {}
  }
  if (musicBar) musicBar.style.display = 'none';
  scheduleSidebarBoundsUpdate();
  if (floatingGramophone) {
    floatingGramophone.style.display = 'none';
    floatingGramophone.classList.add('is-minimized');
  }
  if (gramophoneTitle) gramophoneTitle.textContent = '--';
  if (gramophoneRequester) gramophoneRequester.textContent = '';
  if (gramophoneTime) gramophoneTime.textContent = '-:--';
  if (btnMusicEnable) btnMusicEnable.style.display = 'inline-flex';
  if (musicControlsActive) musicControlsActive.style.display = 'none';
  if (musicProgressBar) musicProgressBar.style.width = '0%';
  if (musicTime) musicTime.textContent = '-:--';
  updateMusicSkipUI(0, 1, false);
  updateMusicQueueUI([], 0);
  if (musicQueuePopover) musicQueuePopover.style.display = 'none';
}

// Tlačítko pro explicitní zapnutí hudby
if (btnMusicEnable) {
  btnMusicEnable.addEventListener('click', () => {
    musicAllowed = true;
    try {
      sessionStorage.setItem('slovotecka_music_allowed', 'true');
    } catch (err) {}
    showToast('🎵 Hudba zapnuta (výchozí hlasitost 20%).');
    if (activeTrack) {
      playTrack(activeTrack);
    }
  });
}

// Ovládání přehrávače
function toggleMusic() {
  if (!musicAllowed) {
    musicAllowed = true;
    try {
      sessionStorage.setItem('slovotecka_music_allowed', 'true');
    } catch (err) {}
    showToast('🎵 Hudba zapnuta (výchozí hlasitost 20%).');
    if (activeTrack) {
      playTrack(activeTrack);
    }
    return;
  }

  if (!ytPlayer || typeof ytPlayer.getPlayerState !== 'function') {
    if (activeTrack) {
      playTrack(activeTrack);
    }
    return;
  }
  try {
    const state = ytPlayer.getPlayerState();
    if (state === YT.PlayerState.PLAYING) {
      ytPlayer.pauseVideo();
      isLocalPaused = true;
      updateVinylState(false, true, activeTrack ? activeTrack.videoId : null);
      if (musicToggleIcon) musicToggleIcon.textContent = '▶';
      if (btnMusicToggle) btnMusicToggle.title = 'Spustit hudbu';
    } else {
      ytPlayer.unMute();
      ytPlayer.setVolume(currentVolume);
      if (activeTrack) {
        const target = getTrackElapsedTime(activeTrack);
        if (target > 2.0) {
          try { ytPlayer.seekTo(target, true); } catch (e) {}
        }
      }
      ytPlayer.playVideo();
      isLocalPaused = false;
      updateVinylState(true, false, activeTrack ? activeTrack.videoId : null);
      if (musicToggleIcon) musicToggleIcon.textContent = '⏸';
      if (btnMusicToggle) btnMusicToggle.title = 'Pozastavit hudbu pro tebe';
    }
  } catch (e) {
    console.warn('Chyba v toggleMusic:', e);
  }
}

if (btnMusicToggle) {
  btnMusicToggle.addEventListener('click', toggleMusic);
}

if (musicVolumeSlider) {
  musicVolumeSlider.addEventListener('input', (e) => {
    currentVolume = parseInt(e.target.value, 10);
    if (musicVolumeVal) musicVolumeVal.textContent = `${currentVolume}%`;
    localStorage.setItem('slovotecka_music_volume', currentVolume.toString());
    if (ytPlayer && typeof ytPlayer.setVolume === 'function') {
      ytPlayer.setVolume(currentVolume);
      if (currentVolume > 0 && isLocalMuted) {
        isLocalMuted = false;
        ytPlayer.unMute();
        if (musicMuteIcon) musicMuteIcon.textContent = '🔈';
      }
    }
  });
}

if (btnMusicMute) {
  btnMusicMute.addEventListener('click', () => {
    if (!ytPlayer || typeof ytPlayer.isMuted !== 'function') return;
    isLocalMuted = !isLocalMuted;
    if (isLocalMuted) {
      ytPlayer.mute();
      if (musicMuteIcon) musicMuteIcon.textContent = '🔇';
    } else {
      ytPlayer.unMute();
      ytPlayer.setVolume(currentVolume);
      if (musicMuteIcon) musicMuteIcon.textContent = '🔈';
    }
  });
}

// Tlačítko a popover pro zobrazení fronty skladeb
if (btnMusicQueue) {
  btnMusicQueue.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!musicQueuePopover) return;
    const isHidden = musicQueuePopover.style.display === 'none';
    musicQueuePopover.style.display = isHidden ? 'block' : 'none';
  });
}

if (btnCloseQueue) {
  btnCloseQueue.addEventListener('click', () => {
    if (musicQueuePopover) musicQueuePopover.style.display = 'none';
  });
}

document.addEventListener('click', (e) => {
  if (musicQueuePopover && musicQueuePopover.style.display !== 'none') {
    if (!musicQueuePopover.contains(e.target) && e.target !== btnMusicQueue) {
      musicQueuePopover.style.display = 'none';
    }
  }
});

// Tlačítko pro hlasování o přeskočení hudby (!skip)
if (btnMusicSkip) {
  btnMusicSkip.addEventListener('click', () => {
    socket.emit('skip_music');
  });
}

if (btnMusicStop) {
  btnMusicStop.addEventListener('click', () => {
    musicAllowed = false;
    try {
      sessionStorage.removeItem('slovotecka_music_allowed');
    } catch (err) {}
    stopMusicLocal();
    showToast('⏹️ Hudba zastavena pro tebe.');
  });
}

// Socket události pro hudbu
socket.on('music_play', (track) => {
  if (track && track.serverTime) {
    syncServerTime(track.serverTime);
  }
  playTrack(track);
});

socket.on('music_queue_update', (data) => {
  if (activeTrack) {
    activeTrack.queue = data.queue;
    activeTrack.queueLength = data.queueLength;
  }
  updateMusicQueueUI(data.queue, data.queueLength);
});

socket.on('music_skip_update', (data) => {
  if (activeTrack) {
    activeTrack.skipVotes = data.skipVotes;
    activeTrack.requiredSkipVotes = data.requiredSkipVotes;
  }
  const hasVoted = btnMusicSkip ? btnMusicSkip.classList.contains('has-voted') : false;
  updateMusicSkipUI(data.skipVotes, data.requiredSkipVotes, hasVoted);
});

socket.on('music_stop', () => {
  stopMusicLocal();
});

// Podpora pro browser autoplay politiku: při jakémkoli kliknutí nebo stisku klávesy se pokusí spustit zvuk, pokud má uživatel hudbu povolenou
function tryResumePlayback() {
  if (!musicAllowed || !activeTrack || isLocalPaused) return;
  if (ytPlayer && typeof ytPlayer.getPlayerState === 'function') {
    try {
      const state = ytPlayer.getPlayerState();
      if (state !== YT.PlayerState.PLAYING && state !== YT.PlayerState.BUFFERING) {
        ytPlayer.unMute();
        ytPlayer.setVolume(currentVolume);
        ytPlayer.playVideo();
      }
    } catch (e) {}
  }
}
document.addEventListener('click', tryResumePlayback);
document.addEventListener('keydown', tryResumePlayback);
