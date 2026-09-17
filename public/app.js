const socket = io();

// Detekce režimu podle URL adresy
const isUnlimited = window.location.pathname.startsWith('/unlimited');
const currentMode = isUnlimited ? 'unlimited' : 'daily';

// Globální stav
let myPlayerName = localStorage.getItem('slovotecka_nickname') || '';

// DOM – Navigace
const tabDaily = document.getElementById('tab-daily');
const tabUnlimited = document.getElementById('tab-unlimited');
if (isUnlimited) {
  if (tabUnlimited) tabUnlimited.classList.add('active');
  if (tabDaily) tabDaily.classList.remove('active');
} else {
  if (tabDaily) tabDaily.classList.add('active');
  if (tabUnlimited) tabUnlimited.classList.remove('active');
}

// DOM – Lobby
const lobbySection = document.getElementById('lobby-section');
const gameSection = document.getElementById('game-section');
const joinForm = document.getElementById('join-form');
const playerNameInput = document.getElementById('player-name');
const lobbyTag = document.getElementById('lobby-tag');
const lobbyTitle = document.getElementById('lobby-title');
const lobbyDesc = document.getElementById('lobby-desc');

if (isUnlimited) {
  if (lobbyTag) lobbyTag.textContent = '[ 01. UNLIMITED ARÉNA ]';
  if (lobbyTitle) lobbyTitle.textContent = 'NEOMEZENÁ ARCHIVNÍ ARÉNA';
  if (lobbyDesc) lobbyDesc.textContent = 'Hrajte společně se slovy z předchozích dnů (1–16). Hráči v místnosti mohou společným hlasováním (např. 2 ze 3) kdykoliv vylosovat nové slovo!';
}

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
const chatEmoteCountBadge = document.getElementById('chat-emote-count');

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

// Výpočet šířky a barvy baru dle vzoru Contexto
function getBarStyles(rank) {
  if (rank === 1) {
    return { width: '100%', bg: '#10b981' };
  }
  if (rank <= 300) {
    const pct = Math.round(98 - ((rank - 2) / 298) * 38);
    return { width: `${pct}%`, bg: '#10b981' };
  }
  if (rank <= 1500) {
    const pct = Math.round(58 - ((rank - 301) / 1199) * 38);
    return { width: `${pct}%`, bg: '#f97316' };
  }
  return { width: '8px', bg: '#f43f5e' };
}

// ── 1. Vstup do hry ───────────────────────────────────
joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = playerNameInput.value.trim();
  if (!name) return showToast('Zadej své jméno nebo přezdívku.', true);

  myPlayerName = name;
  localStorage.setItem('slovotecka_nickname', name);

  socket.emit('join_game', { playerName: name, mode: currentMode });
});

// Automatické znovupřipojení při výpadku spojení
socket.on('connect', () => {
  if (myPlayerName && gameSection.style.display !== 'none') {
    socket.emit('join_game', { playerName: myPlayerName, mode: currentMode });
  }
});

// ── 2. Odeslání tipu ──────────────────────────────────
function submitGuess() {
  const word = guessInput.value.trim();
  if (!word) return;
  setFeedback('Ověřuji slovo…');
  socket.emit('submit_guess', { word });
  guessInput.value = '';
  guessInput.focus();
}

btnSubmitGuess.addEventListener('click', submitGuess);
guessInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    submitGuess();
  }
});

// ── 3. Vzdát se a odhalit dnešní slovo ────────────────
btnRevealWord.addEventListener('click', () => {
  const ok = confirm('Opravdu se chceš vzdát?\nUvidíš tajné slovo, ale ztratíš možnost dále v tomto kole hádat.');
  if (ok) socket.emit('reveal_word');
});

// ── 4. Odhalit nápovědu (získá 🤡) ────────────────────
btnShowHint.addEventListener('click', () => {
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
    }
  } catch (err) {
    console.warn('Nepodařilo se načíst 7TV emoty ze serveru:', err);
  }
}

function renderMessageWithEmotes(text) {
  if (!text) return '';
  const parts = text.split(/(\s+)/);
  return parts.map(part => {
    if (!part || /^\s+$/.test(part)) return part;

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

// ── 6. Odeslání zprávy do chatu ───────────────────────
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit('send_chat', { message: text });
  chatInput.value = '';
  closeEmotePicker();
  chatInput.focus();
});

// ── Server události ───────────────────────────────────
socket.on('error_message', (data) => {
  showToast(data.message, true);
  setFeedback('');
});

socket.on('notification', (data) => {
  showToast(data.message);
  setFeedback('');
});

socket.on('chat_message', (data) => {
  appendChatMessage(data);
});

function appendChatMessage(data) {
  const emptyMsg = chatMessages.querySelector('.chat-empty');
  if (emptyMsg) emptyMsg.remove();

  const isMe = data.player === myPlayerName;
  const div = document.createElement('div');
  div.className = 'chat-msg' + (isMe ? ' is-me' : '');

  const parsedHtml = renderMessageWithEmotes(data.message);

  div.innerHTML = `
    <div class="chat-msg-header">
      <span class="chat-msg-author">${escapeHtml(data.player)}${isMe ? ' (ty)' : ''}</span>
      <span class="chat-msg-time">${data.time || ''}</span>
    </div>
    <div class="chat-msg-text" data-raw="${escapeHtml(data.message)}">${parsedHtml}</div>
  `;

  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ── Vykreslení stavu denní hry ────────────────────────
socket.on('game_state', (state) => {
  renderGameState(state);
});

let chatLoaded = false;

function renderGameState(state) {
  // Přepnutí do herní plochy
  hideWhatsNew();
  lobbySection.style.display = 'none';
  gameSection.style.display = 'block';

  // Přizpůsobení podle režimu (denní vs unlimited)
  if (state.mode === 'unlimited') {
    if (displayModeLabel) displayModeLabel.textContent = '[ UNLIMITED REŽIM ]';
    displayDayTitle.textContent = `ARCHIV #${state.dayNumber || '?'}`;
    if (displayMetaText) displayMetaText.textContent = 'ARCHIVNÍ SADA (1–16)';
    if (secretLabel) secretLabel.textContent = '[ ARCHIVNÍ TAJNÉ SLOVO ]';

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
    const locked = state.myStatus.solved || state.myStatus.gaveUp;
    guessInput.disabled = locked;
    btnSubmitGuess.disabled = locked;
    btnRevealWord.disabled = locked;

    if (state.myStatus.solved) {
      setFeedback(state.mode === 'unlimited' ? 'Toto archivní slovo jsi úspěšně uhodl(a)! Můžeš hlasovat pro další slovo.' : 'Dnešní slovo jsi úspěšně uhodl(a)! Gratuluji.');
    } else if (state.myStatus.gaveUp) {
      setFeedback('Vzdal(a) ses v tomto kole – hádání je uzamčeno.');
    } else {
      setFeedback('');
    }
  }

  // Zpracování posledního tipu hráče (Contexto styl přímo pod polem)
  const myGuesses = state.guesses.filter(
    (g) => g.isMine || (myPlayerName && g.player.toLowerCase() === myPlayerName.toLowerCase())
  );
  myGuesses.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  const lastGuess = myGuesses[0] || null;

  if (lastGuess && lastGuessContainer) {
    lastGuessContainer.style.display = 'block';
    lastGuessWord.textContent = lastGuess.word;
    lastGuessRank.textContent = lastGuess.rank;

    const { width, bg } = getBarStyles(lastGuess.rank);
    lastGuessFill.style.width = width;
    lastGuessFill.style.backgroundColor = bg;
  } else if (lastGuessContainer) {
    lastGuessContainer.style.display = 'none';
  }

  // Hráči online
  playersList.innerHTML = '';
  state.players.forEach((p) => {
    const isMe = p.name === myPlayerName;
    const li = document.createElement('li');
    let cls = 'player-item';
    if (isMe)      cls += ' is-me';
    if (p.solved)  cls += ' solved';
    if (p.gaveUp)  cls += ' gave-up';
    li.className = cls;

    let statusText = `${p.guessCount} tipů`;
    if (p.solved)  statusText = 'UHODL(A)';
    if (p.gaveUp)  statusText = 'VZDÁNO';

    const clown = p.usedHint ? ' 🤡' : '';
    const votedBadge = p.votedForNewWord ? ' <span class="badge-voted" title="Hlasuje pro nové slovo">🗳️</span>' : '';
    const isMeTag = isMe ? ' (ty)' : '';
    const nameLabel = `${escapeHtml(p.name)}${clown}${votedBadge}${isMeTag}`;

    li.innerHTML = `
      <span class="player-name">${nameLabel}</span>
      <span class="player-status">${statusText}</span>
    `;
    playersList.appendChild(li);
  });

  // Tipy seřazené od nejbližšího
  const sorted = [...state.guesses].sort((a, b) => a.rank - b.rank || (a.timestamp || 0) - (b.timestamp || 0));
  const totalGuesses = state.guesses.length;
  guessesCount.textContent = `${totalGuesses} ${totalGuesses === 1 ? 'tip' : totalGuesses < 5 ? 'tipy' : 'tipů'}`;

  if (sorted.length === 0) {
    guessesList.innerHTML = `<div class="empty-guesses">ZATÍM ŽÁDNÉ TIPY. ZAČNI HÁDAT DNEŠNÍ SLOVO!</div>`;
  } else {
    guessesList.innerHTML = '';
    sorted.forEach((g) => {
      const card = document.createElement('div');
      const isMine = g.isMine || (myPlayerName && g.player.toLowerCase() === myPlayerName.toLowerCase());
      const isLast = lastGuess && g.id === lastGuess.id;

      let cls = 'guess-card';
      if (isMine) cls += ' is-me';
      else cls += ' is-shared';
      if (isLast) cls += ' is-last-guess';
      if (g.isWinner) cls += ' is-winner';
      card.className = cls;

      const { width, bg } = getBarStyles(g.rank);
      const rClass = rankClass(g.rank);

      const wordText = escapeHtml(g.word);

      const whoHtml = isMine
        ? `<span class="badge-you">(ty)</span>`
        : `<span class="who-other">${escapeHtml(g.player)}</span> <span class="badge-shared">[společné]</span>`;

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
}
