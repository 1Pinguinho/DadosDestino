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
  // Chegou por um convite: só falta o nome para entrar.
  if (sessionRoomCode !== roomParameter.toUpperCase()) {
    roomFeedback.textContent = 'Você foi convidado! Digite seu nome e o do personagem e clique em Entrar.';
    (nameInput.value ? characterInput.value ? document.querySelector('#join-room') : characterInput : nameInput).focus();
  }
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

// Tira o prefixo técnico do SignalR ("An unexpected error occurred... HubException:").
function friendlyError(error, fallback) {
  const message = String(error?.message || '');
  const hubMessage = message.split('HubException:').pop().trim();
  return hubMessage && !hubMessage.startsWith('An unexpected error') ? hubMessage : fallback;
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
  updateHostLink();
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
    showRoomMessage(friendlyError(error, 'Não foi possível entrar na sala.'));
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

// O anfitrião vê a mesa em localhost; o convite precisa ser o link da internet
// que o app gerou. Quem entrou pelo link já está no endereço certo.
const isHostView = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const hostBar = document.querySelector('#host-bar');
const hostBarText = document.querySelector('#host-bar-text');
const hostBarLink = document.querySelector('#host-bar-link');
const hostBarCopy = document.querySelector('#host-bar-copy');
const hostBarRetry = document.querySelector('#host-bar-retry');
let publicBaseUrl = '';
let hostPollTimer = 0;

function inviteUrlFor(code) {
  const base = isHostView ? publicBaseUrl : location.origin;
  if (!base) {
    return '';
  }
  const url = new URL('/', base);
  if (code) {
    url.searchParams.set('room', code);
  }
  return url.toString();
}

function updateHostLink() {
  if (publicBaseUrl) {
    hostBarLink.textContent = inviteUrlFor(activeRoom?.code);
  }
}

async function copyInvite(button) {
  const code = activeRoom?.code || '';
  const link = inviteUrlFor(code);
  if (!link) {
    showRoomMessage(`O link da internet ainda está sendo gerado.${code ? ` Código da sala: ${code}` : ''}`);
    return;
  }
  try {
    await navigator.clipboard.writeText(link);
    const label = button.textContent;
    button.textContent = 'COPIADO';
    setTimeout(() => { button.textContent = label; }, 2000);
    showRoomMessage(code ? 'Convite copiado. Mande para seus amigos.' : 'Link copiado. Crie a sala para o convite já levar o código.');
  } catch {
    showRoomMessage(`Link para compartilhar: ${link}`);
  }
}

async function refreshHostBar() {
  clearTimeout(hostPollTimer);
  let info;
  try {
    info = await fetch('/api/info', { cache: 'no-store' }).then((response) => response.json());
  } catch {
    hostPollTimer = setTimeout(refreshHostBar, 5000);
    return;
  }
  if (!info || info.status === 'off') {
    hostBar.hidden = true;
    return;
  }

  hostBar.hidden = false;
  hostBar.dataset.status = info.status;
  publicBaseUrl = info.status === 'ready' && info.url ? info.url : '';
  hostBarLink.hidden = !publicBaseUrl;
  hostBarCopy.hidden = !publicBaseUrl;
  hostBarRetry.hidden = info.status !== 'error';
  if (info.status === 'downloading') {
    hostBarText.textContent = `Preparando o link da internet (só na primeira vez)… ${info.percent || 0}%`;
  } else if (info.status === 'starting') {
    hostBarText.textContent = 'Gerando o link da internet para seus amigos…';
  } else if (info.status === 'ready') {
    hostBarText.textContent = 'Link para os amigos:';
    updateHostLink();
  } else {
    hostBarText.textContent = `Sem link da internet: ${info.error || 'erro desconhecido.'}`;
  }

  const delay = info.status === 'ready' ? 15000 : info.status === 'error' ? 30000 : 1200;
  hostPollTimer = setTimeout(refreshHostBar, delay);
}

document.querySelector('#copy-room-link').addEventListener('click', (event) => {
  if (activeRoom) {
    copyInvite(event.currentTarget);
  }
});
hostBarCopy.addEventListener('click', () => copyInvite(hostBarCopy));
hostBarRetry.addEventListener('click', async () => {
  hostBarRetry.hidden = true;
  hostBarText.textContent = 'Gerando o link da internet para seus amigos…';
  try {
    await fetch('/api/tunnel/retry', { method: 'POST' });
  } finally {
    refreshHostBar();
  }
});
if (isHostView) {
  refreshHostBar();
}

// Dentro do app, o botão "Início" volta para a tela de hospedar/entrar.
const appBridge = window.chrome?.webview;
const appHomeButton = document.querySelector('#app-home');
if (appBridge) {
  appHomeButton.hidden = false;
  appHomeButton.addEventListener('click', () => appBridge.postMessage({ action: 'home' }));
}

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