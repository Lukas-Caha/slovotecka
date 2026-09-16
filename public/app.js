const socket = io();

// Globální stav
let myPlayerName = localStorage.getItem('slovotecka_nickname') || '';

// DOM – Lobby
const lobbySection = document.getElementById('lobby-section');
const gameSection = document.getElementById('game-section');
const joinForm = document.getElementById('join-form');
const playerNameInput = document.getElementById('player-name');

// DOM – Hra
const displayDayTitle = document.getElementById('display-day-title');
const displayDate = document.getElementById('display-date');
const displayHint = document.getElementById('display-hint');
const hintLocked = document.getElementById('hint-locked');
const hintRevealed = document.getElementById('hint-revealed');
const btnShowHint = document.getElementById('btn-show-hint');
const secretWordBox = document.getElementById('secret-word-box');
const displaySecretWord = document.getElementById('display-secret-word');

const playersList = document.getElementById('players-list');
const guessInput = document.getElementById('guess-input');
const btnSubmitGuess = document.getElementById('btn-submit-guess');
const btnRevealWord = document.getElementById('btn-reveal-word');
const guessFeedback = document.getElementById('guess-feedback');
const guessesList = document.getElementById('guesses-list');
const guessesCount = document.getElementById('guesses-count');
const toastContainer = document.getElementById('toast-container');

// DOM – Chat
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');

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
  if (rank <= 10)    return 'rank-hot';
  if (rank <= 50)    return 'rank-warm';
  return 'rank-cool';
}

// ── 1. Vstup do hry ───────────────────────────────────
joinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = playerNameInput.value.trim();
  if (!name) return showToast('Zadej své jméno nebo přezdívku.', true);

  myPlayerName = name;
  localStorage.setItem('slovotecka_nickname', name);

  socket.emit('join_game', { playerName: name });
});

// Automatické znovupřipojení při výpadku spojení
socket.on('connect', () => {
  if (myPlayerName && gameSection.style.display !== 'none') {
    socket.emit('join_game', { playerName: myPlayerName });
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
  const ok = confirm('Opravdu se chceš vzdát?\nUvidíš dnešní tajné slovo, ale ztratíš možnost dále dnes hádat.');
  if (ok) socket.emit('reveal_word');
});

// ── 4. Odhalit nápovědu (získá 🤡) ────────────────────
btnShowHint.addEventListener('click', () => {
  const ok = confirm('Opravdu chceš odhalit nápovědu?\nPozor: všichni online uvidí vedle tvého jména klauna 🤡!');
  if (ok) socket.emit('use_hint');
});

// ── 5. Odeslání zprávy do chatu ───────────────────────
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit('send_chat', { message: text });
  chatInput.value = '';
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

  div.innerHTML = `
    <div class="chat-msg-header">
      <span class="chat-msg-author">${escapeHtml(data.player)}${isMe ? ' (ty)' : ''}</span>
      <span class="chat-msg-time">${data.time || ''}</span>
    </div>
    <div class="chat-msg-text">${escapeHtml(data.message)}</div>
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
  lobbySection.style.display = 'none';
  gameSection.style.display = 'block';

  // Hlavička
  displayDayTitle.textContent = `Den #${state.dayNumber || '1'}`;
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
      setFeedback('🏆 Dnešní slovo jsi úspěšně uhodl(a)! Gratuluji.');
    } else if (state.myStatus.gaveUp) {
      setFeedback('Dnes ses vzdal(a) – hádání je uzamčeno.');
    }
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
    if (p.solved)  statusText = '🏆 Uhodl(a)!';
    if (p.gaveUp)  statusText = '❌ Vzdal(a) se';

    const clown = p.usedHint ? ' 🤡' : '';
    const isMeTag = isMe ? ' (ty)' : '';
    const nameLabel = `${escapeHtml(p.name)}${clown}${isMeTag}`;

    li.innerHTML = `
      <span class="player-name">${nameLabel}</span>
      <span class="player-status">${statusText}</span>
    `;
    playersList.appendChild(li);
  });

  // Tipy seřazené od nejbližšího
  const sorted = [...state.guesses].sort((a, b) => a.rank - b.rank);
  const totalGuesses = state.guesses.length;
  guessesCount.textContent = `${totalGuesses} ${totalGuesses === 1 ? 'tip' : totalGuesses < 5 ? 'tipy' : 'tipů'}`;

  if (sorted.length === 0) {
    guessesList.innerHTML = `
      <tr class="empty-row">
        <td colspan="3">Zatím žádné tipy. Začni hádat dnešní slovo!</td>
      </tr>`;
  } else {
    guessesList.innerHTML = '';
    sorted.forEach((g) => {
      const tr = document.createElement('tr');
      if (g.isWinner) tr.classList.add('winner-row');

      const rClass = rankClass(g.rank);
      tr.innerHTML = `
        <td class="rank-cell ${rClass}">${g.rank}</td>
        <td class="word-cell">${escapeHtml(g.word)}</td>
        <td class="who-cell">${escapeHtml(g.player)}</td>
      `;
      guessesList.appendChild(tr);
    });
  }

  // Načtení historie chatu při prvním vstupu
  if (!chatLoaded && state.chatHistory && state.chatHistory.length > 0) {
    chatMessages.innerHTML = '';
    state.chatHistory.forEach(msg => appendChatMessage(msg));
    chatLoaded = true;
  }
}
