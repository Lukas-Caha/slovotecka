// Připojení k Socket.IO serveru (automaticky se připojí k doméně, na které web běží)
const socket = io();

// Globální stav na klientovi
let currentRoomCode = null;
let myPlayerName = '';

// DOM elementy - Lobby
const lobbySection = document.getElementById('lobby-section');
const gameSection = document.getElementById('game-section');
const playerNameInput = document.getElementById('player-name');
const roomCodeInput = document.getElementById('room-code-input');
const btnCreateDaily = document.getElementById('btn-create-daily');
const btnCreateRandom = document.getElementById('btn-create-random');
const btnJoinRoom = document.getElementById('btn-join-room');

// DOM elementy - Hra
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

const errorMessage = document.getElementById('error-message');
const statusMessage = document.getElementById('status-message');

// Pomocné funkce pro zobrazení zpráv
function showError(text) {
  errorMessage.textContent = text;
  setTimeout(() => {
    if (errorMessage.textContent === text) {
      errorMessage.textContent = '';
    }
  }, 5000);
}

function showStatus(text) {
  statusMessage.textContent = text;
  setTimeout(() => {
    if (statusMessage.textContent === text) {
      statusMessage.textContent = '';
    }
  }, 5000);
}

// 1. Akce z Lobby
btnCreateDaily.addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  if (!name) return showError('Nejprve zadej své jméno.');
  myPlayerName = name;
  socket.emit('create_room', { playerName: name, isDaily: true });
});

btnCreateRandom.addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  if (!name) return showError('Nejprve zadej své jméno.');
  myPlayerName = name;
  socket.emit('create_room', { playerName: name, isDaily: false });
});

btnJoinRoom.addEventListener('click', () => {
  const name = playerNameInput.value.trim();
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!name) return showError('Nejprve zadej své jméno.');
  if (!code) return showError('Zadej kód místnosti.');
  myPlayerName = name;
  socket.emit('join_room', { code, playerName: name });
});

// 2. Odeslání tipu
function submitCurrentGuess() {
  const word = guessInput.value.trim();
  if (!word) return;
  guessFeedback.textContent = 'Ověřuji slovo...';
  socket.emit('submit_guess', { code: currentRoomCode, word });
  guessInput.value = '';
}

btnSubmitGuess.addEventListener('click', submitCurrentGuess);

guessInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    submitCurrentGuess();
  }
});

// 3. Vzdát se a odhalit slovo
btnRevealWord.addEventListener('click', () => {
  const confirmed = confirm('Opravdu se chceš vzdát a odhalit tajné slovo?\nUž nebudeš moci v tomto kole hádat.');
  if (confirmed) {
    socket.emit('reveal_word', { code: currentRoomCode });
  }
});

// 4. Další kolo (pro hostitele)
btnNextRound.addEventListener('click', () => {
  socket.emit('next_round', { code: currentRoomCode });
});

// --- PŘÍJEM UDÁLOSTÍ ZE SERVERU ---

// Chyba
socket.on('error_message', (data) => {
  showError(data.message);
  guessFeedback.textContent = '';
});

// Oznámení
socket.on('notification', (data) => {
  showStatus(data.message);
  guessFeedback.textContent = '';
});

// Připojení do místnosti
socket.on('room_joined', (state) => {
  currentRoomCode = state.code;
  renderRoomState(state);
});

// Aktualizace stavu místnosti v reálném čase
socket.on('room_state', (state) => {
  renderRoomState(state);
});

// Vykreslení celé herní obrazovky
function renderRoomState(state) {
  currentRoomCode = state.code;

  // Přepnutí ze sekce Lobby do Herní sekce
  lobbySection.style.display = 'none';
  gameSection.style.display = 'block';

  // Základní informace
  displayRoomCode.textContent = state.code;
  displayMode.textContent = state.isDaily ? 'Denní slovo' : 'Náhodná hra';
  displayDate.textContent = state.date;
  displayHint.textContent = state.hint || 'Žádná';

  // Ovládání hostitele
  hostControls.style.display = state.isHost ? 'block' : 'none';

  // Pokud hráč odhalil slovo nebo uhodl
  if (state.secretWord) {
    secretWordBox.style.display = 'block';
    displaySecretWord.textContent = state.secretWord;
  } else {
    secretWordBox.style.display = 'none';
    displaySecretWord.textContent = '';
  }

  // Zablokování / odblokování formuláře pro hádání
  if (state.myStatus) {
    if (state.myStatus.solved) {
      guessInput.disabled = true;
      btnSubmitGuess.disabled = true;
      btnRevealWord.disabled = true;
      guessFeedback.textContent = 'Výborně! Slovo jsi úspěšně uhodl(a).';
    } else if (state.myStatus.gaveUp) {
      guessInput.disabled = true;
      btnSubmitGuess.disabled = true;
      btnRevealWord.disabled = true;
      guessFeedback.textContent = 'Vzdal(a) ses a odhalil(a) slovo. Hádání je uzamčeno.';
    } else {
      guessInput.disabled = false;
      btnSubmitGuess.disabled = false;
      btnRevealWord.disabled = false;
    }
  }

  // Vykreslení seznamu hráčů
  playersList.innerHTML = '';
  state.players.forEach((p) => {
    const tr = document.createElement('tr');

    let statusText = 'Hraje...';
    if (p.solved) statusText = '🏆 Uhodl(a) (#1)!';
    else if (p.gaveUp) statusText = '❌ Vzdal(a) se';

    const isMe = p.name === myPlayerName;
    const displayName = `${p.name}${p.isHost ? ' (Hostitel)' : ''}${isMe ? ' (Ty)' : ''}`;

    tr.innerHTML = `
      <td>${displayName}</td>
      <td>${p.guessCount}</td>
      <td>${statusText}</td>
    `;
    playersList.appendChild(tr);
  });

  // Vykreslení hádaných slov seřazených podle ranku (od 1 nahoru)
  guessesList.innerHTML = '';
  const sortedGuesses = [...state.guesses].sort((a, b) => a.rank - b.rank);

  sortedGuesses.forEach((g) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${g.rank}</strong></td>
      <td>${g.word}</td>
      <td>${g.player}</td>
    `;
    guessesList.appendChild(tr);
  });
}
