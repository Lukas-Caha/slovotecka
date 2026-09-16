const socket = io();

let currentRoomCode = null;
let myPlayerName = '';

// DOM – Lobby
const lobbySection = document.getElementById('lobby-section');
const gameSection = document.getElementById('game-section');
const playerNameInput = document.getElementById('player-name');
const roomCodeInput = document.getElementById('room-code-input');
const btnCreateDaily = document.getElementById('btn-create-daily');
const btnCreateRandom = document.getElementById('btn-create-random');
const btnJoinRoom = document.getElementById('btn-join-room');

// DOM – Hra
const displayRoomCode = document.getElementById('display-room-code');
const displayMode = document.getElementById('display-mode');
const displayDate = document.getElementById('display-date');
const displayHint = document.getElementById('display-hint');
const secretWordBox = document.getElementById('secret-word-box');
const displaySecretWord = document.getElementById('display-secret-word');
const hostControls = document.getElementById('host-controls');
const btnNextRound = document.getElementById('btn-next-round');
const playersList = document.getElementById('players-list');
const guessInput = document.getElementById('guess-input');
const btnSubmitGuess = document.getElementById('btn-submit-guess');
const btnRevealWord = document.getElementById('btn-reveal-word');
const guessFeedback = document.getElementById('guess-feedback');
const guessesList = document.getElementById('guesses-list');
const guessesCount = document.getElementById('guesses-count');
const toastContainer = document.getElementById('toast-container');

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

// ── Lobby akce ────────────────────────────────────────
btnCreateDaily.addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  if (!name) return showToast('Zadej přezdívku.', true);
  myPlayerName = name;
  socket.emit('create_room', { playerName: name, isDaily: true });
});

btnCreateRandom.addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  if (!name) return showToast('Zadej přezdívku.', true);
  myPlayerName = name;
  socket.emit('create_room', { playerName: name, isDaily: false });
});

btnJoinRoom.addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!name) return showToast('Zadej přezdívku.', true);
  if (!code) return showToast('Zadej kód místnosti.', true);
  myPlayerName = name;
  socket.emit('join_room', { code, playerName: name });
});

// Enter v kódu místnosti
roomCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnJoinRoom.click();
});
playerNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const code = roomCodeInput.value.trim();
    if (code) btnJoinRoom.click();
    else btnCreateDaily.click();
  }
});

// ── Hádat ─────────────────────────────────────────────
function submitGuess() {
  const word = guessInput.value.trim();
  if (!word) return;
  setFeedback('Ověřuji…');
  socket.emit('submit_guess', { code: currentRoomCode, word });
  guessInput.value = '';
  guessInput.focus();
}

btnSubmitGuess.addEventListener('click', submitGuess);
guessInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); submitGuess(); }
});

// ── Vzdát se ──────────────────────────────────────────
btnRevealWord.addEventListener('click', () => {
  const ok = confirm('Opravdu se vzdát? Uvidíš tajné slovo, ale ztratíš možnost hádat.');
  if (ok) socket.emit('reveal_word', { code: currentRoomCode });
});

// ── Nové kolo ─────────────────────────────────────────
btnNextRound.addEventListener('click', () => {
  socket.emit('next_round', { code: currentRoomCode });
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

socket.on('room_joined', (state) => {
  currentRoomCode = state.code;
  renderRoomState(state);
});

socket.on('room_state', (state) => {
  renderRoomState(state);
});

// ── Vykreslení stavu hry ──────────────────────────────
function renderRoomState(state) {
  currentRoomCode = state.code;

  lobbySection.style.display = 'none';
  gameSection.style.display = 'block';

  // Hlavička
  displayRoomCode.textContent = state.code;
  displayMode.textContent = state.isDaily ? '📅 Dnešní slovo' : '🎲 Náhodná hra';
  displayDate.textContent = state.date;
  displayHint.textContent = state.hint || '—';

  hostControls.style.display = state.isHost ? 'block' : 'none';

  // Tajné slovo
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
      setFeedback('🏆 Slovo jsi uhodl(a)! Gratuluji.');
    } else if (state.myStatus.gaveUp) {
      setFeedback('Vzdal(a) ses – hádání uzamčeno.');
    }
  }

  // Hráči
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

    const nameLabel = `${p.name}${p.isHost ? ' ★' : ''}${isMe ? ' (ty)' : ''}`;

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
        <td colspan="3">Zatím žádné tipy. Začni hádat!</td>
      </tr>`;
    return;
  }

  guessesList.innerHTML = '';
  sorted.forEach((g) => {
    const tr = document.createElement('tr');
    if (g.isWinner) tr.classList.add('winner-row');

    const rClass = rankClass(g.rank);
    tr.innerHTML = `
      <td class="rank-cell ${rClass}">${g.rank}</td>
      <td class="word-cell">${g.word}</td>
      <td class="who-cell">${g.player}</td>
    `;
    guessesList.appendChild(tr);
  });
}
