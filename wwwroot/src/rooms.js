const codeInput = document.querySelector('#room-code');
const nameInput = document.querySelector('#player-name');
const characterInput = document.querySelector('#character-name');
const joinView = document.querySelector('#room-join-view');
const activeView = document.querySelector('#room-active-view');
const roomFeedback = document.querySelector('#room-feedback');
const roomConnectionState = document.querySelector('#room-connection-state');
const connectionStatus = document.querySelector('#connection-status');
const connectionDot = document.querySelector('#connection-dot');
const roomList = document.querySelector('#player-list');
const tableRollControls = document.querySelector('#table-roll-controls');
const rollTarget = document.querySelector('#roll-target');
const rollVisibility = document.querySelector('#roll-visibility');
const roomParameter = new URLSearchParams(location.search).get('room');
let activeRoom = null;
let connectionStart;
let sessionRoomCode = '';
let sessionPlayerToken = '';
let privateRoll = false;

try {
  sessionRoomCode = sessionStorage.getItem('dados-destino-room') || '';
  sessionPlayerToken = sessionStorage.getItem('dados-destino-player-token') || '';
} catch {
  sessionRoomCode = '';
  sessionPlayerToken = '';
}

try {
  nameInput.value = localStorage.getItem('dados-destino-player-name') || '';
  characterInput.value = localStorage.getItem('dados-destino-character-name') || '';
} catch {
  nameInput.value = '';
  characterInput.value = '';
}

if (roomParameter) {
  codeInput.value = roomParameter.toUpperCase();
}

const connection = new window.signalR.HubConnectionBuilder()
  .withUrl('/tableHub')
  .withAutomaticReconnect()
  .build();

function setConnectionStatus(connected, label) {
  connectionStatus.textContent = label;
  roomConnectionState.textContent = label;
  connectionDot.classList.toggle('is-offline', !connected);
}

function showRoomMessage(message = '') {
  roomFeedback.textContent = message;
}

function getPlayerName() {
  const name = nameInput.value.trim();
  if (name.length < 2 || name.length > 22 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error('Use um nome de 2 a 22 caracteres.');
  }
  try {
    localStorage.setItem('dados-destino-player-name', name);
  } catch {
    return name;
  }
  return name;
}

function getCharacterName() {
  const name = characterInput.value.trim();
  if (name.length < 2 || name.length > 30 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error('Use um nome de personagem de 2 a 30 caracteres.');
  }
  try {
    localStorage.setItem('dados-destino-character-name', name);
  } catch {
    return name;
  }
  return name;
}

function getPlayerLabel() {
  const characterName = characterInput.value.trim();
  const playerName = nameInput.value.trim();
  return characterName && playerName ? `${characterName} (${playerName})` : playerName;
}

async function ensureConnection() {
  if (connection.state === window.signalR.HubConnectionState.Connected) {
    return;
  }
  if (!connectionStart) {
    connectionStart = connection.start().finally(() => {
      connectionStart = null;
    });
  }
  await connectionStart;
}

function updateRollControls(room) {
  tableRollControls.hidden = !room;
  rollVisibility.hidden = !room?.isMaster;
  if (!room) {
    rollTarget.replaceChildren();
    return;
  }

  const previousTarget = rollTarget.value;
  const eligiblePlayers = room.isMaster
    ? room.players
    : room.players.filter((player) => player.id === room.myPlayerId);
  rollTarget.replaceChildren();
  for (const player of eligiblePlayers) {
    const option = document.createElement('option');
    option.value = player.id;
    option.textContent = `${player.characterName} (${player.name})${player.isMaster ? ' · MESTRE' : ''}`;
    rollTarget.append(option);
  }
  if (eligiblePlayers.some((player) => player.id === previousTarget)) {
    rollTarget.value = previousTarget;
  } else {
    rollTarget.value = room.myPlayerId;
  }
  syncPrivateRollButtons();
}

function syncPrivateRollButtons() {
  for (const button of rollVisibility.querySelectorAll('[data-visibility]')) {
    button.setAttribute('aria-pressed', String((button.dataset.visibility === 'private') === privateRoll));
  }
}

function renderRoom(room) {
  if (!room || activeRoom?.code !== room.code) {
    privateRoll = false;
  }
  activeRoom = room;
  joinView.hidden = Boolean(room);
  activeView.hidden = !room;
  if (!room) {
    updateRollControls(null);
    window.dispatchEvent(new CustomEvent('room-state', {
      detail: { code: '', players: [], rolls: [] },
    }));
    return;
  }

  codeInput.value = room.code;
  document.querySelector('#active-room-code').textContent = room.code;
  document.querySelector('#player-count').textContent = `${room.players.length} / 8`;
  roomList.replaceChildren();
  for (const player of room.players) {
    const item = document.createElement('li');
    item.textContent = `${player.characterName} (${player.name})${player.isMaster ? ' · Mestre' : ''}${player.isOnline ? '' : ' · offline'}`;
    roomList.append(item);
  }
  updateRollControls(room);
  window.dispatchEvent(new CustomEvent('room-state', { detail: room }));
}

async function enterRoom(create) {
  const buttons = [...document.querySelectorAll('#room-join-view button')];
  try {
    showRoomMessage('');
    const name = getPlayerName();
    const characterName = getCharacterName();
    buttons.forEach((button) => { button.disabled = true; });
    await ensureConnection();
    const result = create
      ? await connection.invoke('CreateRoom', name, characterName, sessionPlayerToken)
      : await connection.invoke('JoinRoom', codeInput.value.trim().toUpperCase(), name, characterName, sessionPlayerToken);
    const room = result.room;
    sessionPlayerToken = result.reconnectToken;
    renderRoom(room);
    try {
      sessionStorage.setItem('dados-destino-room', room.code);
      sessionStorage.setItem('dados-destino-player-token', sessionPlayerToken);
    } catch {
      sessionRoomCode = '';
    }
    sessionRoomCode = room.code;
    const url = new URL(location.href);
    url.searchParams.set('room', room.code);
    history.replaceState(null, '', url);
    if (room.rolls?.length) {
      window.dispatchEvent(new CustomEvent('room-shared-history', { detail: room.rolls }));
    }
  } catch (error) {
    showRoomMessage(error.message || 'Não foi possível entrar na sala.');
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

document.querySelector('#create-room').addEventListener('click', () => enterRoom(true));
document.querySelector('#join-room').addEventListener('click', () => enterRoom(false));

document.querySelector('#leave-room').addEventListener('click', async () => {
  try {
    await connection.invoke('LeaveRoom');
    renderRoom(null);
    sessionRoomCode = '';
    sessionPlayerToken = '';
    try {
      sessionStorage.removeItem('dados-destino-room');
      sessionStorage.removeItem('dados-destino-player-token');
    } catch {
      sessionRoomCode = '';
    }
    showRoomMessage('Você saiu da sala.');
    codeInput.value = '';
    const url = new URL(location.href);
    url.searchParams.delete('room');
    history.replaceState(null, '', url);
  } catch {
    showRoomMessage('Não foi possível sair da sala.');
  }
});

// Quem abre pelo app (ou em localhost) recebe um convite com o IP da rede local,
// que é o endereço que os outros computadores conseguem acessar.
async function buildInviteUrl(code) {
  let base = location.origin;
  if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    try {
      const info = await fetch('/api/info').then((response) => response.json());
      if (info.inviteBaseUrl) {
        base = info.inviteBaseUrl;
      }
    } catch {
      base = location.origin;
    }
  }
  const url = new URL('/', base);
  url.searchParams.set('room', code);
  return url.toString();
}

document.querySelector('#copy-room-link').addEventListener('click', async (event) => {
  if (!activeRoom) {
    return;
  }
  const button = event.currentTarget;
  const code = activeRoom.code;
  try {
    await navigator.clipboard.writeText(await buildInviteUrl(code));
    button.textContent = 'COPIADO';
    showRoomMessage('Convite copiado.');
  } catch {
    showRoomMessage(`Código para compartilhar: ${code}`);
  }
});

codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
});

connection.on('RoomUpdated', (room) => {
  if (activeRoom?.code === room.code) {
    const currentPlayer = room.players.find((player) => player.id === activeRoom.myPlayerId);
    renderRoom({ ...activeRoom, players: room.players, isMaster: Boolean(currentPlayer?.isMaster) });
  }
});

connection.on('ReceiveRoll', (roll) => {
  window.dispatchEvent(new CustomEvent('room-shared-roll', { detail: roll }));
});

connection.onreconnecting(() => setConnectionStatus(false, 'RECONECTANDO'));
connection.onreconnected(async () => {
  setConnectionStatus(true, 'CONECTADO');
  if (activeRoom) {
    try {
      const result = await connection.invoke('JoinRoom', activeRoom.code, getPlayerName(), getCharacterName(), sessionPlayerToken);
      sessionPlayerToken = result.reconnectToken;
      try {
        sessionStorage.setItem('dados-destino-player-token', sessionPlayerToken);
      } catch {
        sessionPlayerToken = result.reconnectToken;
      }
      renderRoom(result.room);
    } catch {
      renderRoom(null);
      showRoomMessage('A sala foi encerrada durante a desconexão.');
    }
  }
});
connection.onclose(() => setConnectionStatus(false, 'DESCONECTADO'));

async function startRoomConnection() {
  try {
    await ensureConnection();
    setConnectionStatus(true, 'CONECTADO');
    if (roomParameter && sessionRoomCode === roomParameter.toUpperCase() && nameInput.value.trim()) {
      await enterRoom(false);
    }
  } catch {
    setConnectionStatus(false, 'SERVIDOR OFFLINE');
    showRoomMessage('Servidor da mesa indisponível.');
  }
}

export function createRoomManager({ onRoomRoll, onRoomHistory, onRoomState }) {
  window.addEventListener('room-shared-roll', (event) => onRoomRoll(event.detail));
  window.addEventListener('room-shared-history', (event) => onRoomHistory(event.detail));
  window.addEventListener('room-state', (event) => onRoomState(event.detail));
  startRoomConnection();

  return {
    getPlayerName: () => (activeRoom ? nameInput.value.trim() : ''),
    getCharacterName: () => (activeRoom ? characterInput.value.trim() : ''),
    getPlayerLabel,
    getRollContext: () => ({
      targetPlayerId: activeRoom ? rollTarget.value : '',
      isPrivate: Boolean(activeRoom?.isMaster && privateRoll && rollTarget.value === activeRoom.myPlayerId),
    }),
    shareRoll: (roll) => (activeRoom
      ? connection.invoke('ShareRoll', roll)
      : Promise.resolve()),
  };
}

rollVisibility.querySelectorAll('[data-visibility]').forEach((button) => {
  button.addEventListener('click', () => {
    privateRoll = button.dataset.visibility === 'private';
    syncPrivateRollButtons();
  });
});

rollTarget.addEventListener('change', () => {
  if (activeRoom?.isMaster && rollTarget.value !== activeRoom.myPlayerId) {
    privateRoll = false;
    syncPrivateRollButtons();
  }
});