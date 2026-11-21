// Salas: criar (nome, limite de jogadores, pública/privada, espectadores),
// entrar com código como jogador ou espectador, procurar salas públicas, o painel
// da sala e o link de convite do anfitrião.
import { t, errorText } from './i18n.js';

const $ = (selector) => document.querySelector(selector);
const nameInput = $('#player-name');
const characterInput = $('#character-name');
const characterLabel = $('#character-label');
const codeInput = $('#room-code');
const roomNameInput = $('#room-name');
const lobbyFeedback = $('#lobby-feedback');
const roomFeedback = $('#room-feedback');
const connectionStatus = $('#connection-status');
const roomConnectionState = $('#room-connection-state');
const connectionDot = $('#connection-dot');
const playerList = $('#player-list');
const spectatorList = $('#spectator-list');
const tableRollControls = $('#table-roll-controls');
const rollTarget = $('#roll-target');
const rollVisibility = $('#roll-visibility');
const roomResults = $('#room-results');
const roomResultsEmpty = $('#room-results-empty');
const searchInput = $('#room-search');
const roomSettings = $('#room-settings');
const roomParameter = (new URLSearchParams(location.search).get('room') || '').toUpperCase();

let activeRoom = null;
let connectionStart;
let connectionKey = 'status.connecting';
let limits = { maxPlayersPerRoom: 12, maxSpectatorsPerRoom: 10 };
let createMaxPlayers = 6;
let createPublic = true;
let joinAsSpectator = false;
let settingsMaxPlayers = 6;
let settingsPublic = true;
let privateRoll = false;
let publicRooms = null;
let searchTimer = 0;
let lobbyTab = 'create';
let lastFeedback = { element: null, key: '', params: {} };

const session = {
  get(key) {
    try { return sessionStorage.getItem(key) || ''; } catch { return ''; }
  },
  set(key, value) {
    try { sessionStorage.setItem(key, value); } catch { /* só nesta aba */ }
  },
  remove(key) {
    try { sessionStorage.removeItem(key); } catch { /* só nesta aba */ }
  },
};
let sessionRoomCode = session.get('dados-destino-room');
let sessionPlayerToken = session.get('dados-destino-player-token');
let sessionSpectator = session.get('dados-destino-spectator') === '1';

try {
  nameInput.value = localStorage.getItem('dados-destino-player-name') || '';
  characterInput.value = localStorage.getItem('dados-destino-character-name') || '';
} catch {
  // Sem armazenamento: campos começam vazios.
}
// Voltando para a sala nesta aba: usa o nome com que entrou nela (outra aba pode
// ter salvo outro nome no navegador).
if (roomParameter && sessionRoomCode === roomParameter) {
  nameInput.value = session.get('dados-destino-name') || nameInput.value;
  characterInput.value = session.get('dados-destino-character') || characterInput.value;
}

const connection = new window.signalR.HubConnectionBuilder()
  .withUrl('/tableHub')
  .withAutomaticReconnect()
  .build();

// ---------- mensagens e estado da conexão ----------

function setConnectionStatus(connected, key) {
  connectionKey = key;
  connectionStatus.textContent = t(key);
  roomConnectionState.textContent = t(key);
  connectionDot.classList.toggle('is-offline', !connected);
}

// Guarda a chave da mensagem para traduzir de novo se o idioma mudar.
function say(element, key = '', params = {}) {
  lastFeedback = { element, key, params };
  element.textContent = key ? t(key, params) : '';
  if (element !== lobbyFeedback) lobbyFeedback.textContent = '';
  if (element !== roomFeedback) roomFeedback.textContent = '';
}

function sayError(element, error, fallbackKey) {
  lastFeedback = { element, key: '', params: {} };
  element.textContent = errorText(error, fallbackKey);
}

// ---------- nome, personagem e validação ----------

function hasHiddenCharacters(text) {
  return /[\u0000-\u001f\u007f​-‏‪-‮⁠-⁤﻿]/.test(text);
}

function readName() {
  const name = nameInput.value.trim();
  if (name.length < 2 || name.length > 22 || hasHiddenCharacters(name)) {
    nameInput.focus();
    throw new Error('INVALID_NAME');
  }
  try { localStorage.setItem('dados-destino-player-name', name); } catch { /* sem armazenamento */ }
  return name;
}

function readCharacter(optional) {
  const name = characterInput.value.trim();
  if (optional && !name) {
    return '';
  }
  if (name.length < 2 || name.length > 30 || hasHiddenCharacters(name)) {
    characterInput.focus();
    throw new Error('INVALID_CHARACTER');
  }
  try { localStorage.setItem('dados-destino-character-name', name); } catch { /* sem armazenamento */ }
  return name;
}

async function ensureConnection() {
  if (connection.state === window.signalR.HubConnectionState.Connected) {
    return;
  }
  if (!connectionStart) {
    connectionStart = connection.start().finally(() => { connectionStart = null; });
  }
  await connectionStart;
}

// ---------- abas do lobby ----------

function selectTab(tab) {
  lobbyTab = tab;
  for (const button of document.querySelectorAll('.lobby-tabs [data-tab]')) {
    const selected = button.dataset.tab === tab;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    $(`#panel-${button.dataset.tab}`).hidden = !selected;
  }
  updateCharacterLabel();
  clearInterval(searchTimer);
  if (tab === 'search') {
    loadPublicRooms();
    searchTimer = setInterval(() => {
      if (!activeRoom && lobbyTab === 'search' && !document.hidden) {
        loadPublicRooms(true);
      }
    }, 6000);
  }
}

function updateCharacterLabel() {
  const optional = lobbyTab !== 'create' && (lobbyTab === 'search' || joinAsSpectator);
  characterLabel.textContent = t(optional ? 'lobby.characterOptional' : 'lobby.character');
}

document.querySelector('.lobby-tabs').addEventListener('click', (event) => {
  const button = event.target.closest('[data-tab]');
  if (button) {
    selectTab(button.dataset.tab);
  }
});
document.querySelector('.lobby-tabs').addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') {
    return;
  }
  const tabs = [...document.querySelectorAll('.lobby-tabs [data-tab]')];
  const index = tabs.findIndex((tab) => tab.dataset.tab === lobbyTab);
  const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
  selectTab(next.dataset.tab);
  next.focus();
});

function setPressed(group, attribute, value) {
  for (const button of group.querySelectorAll(`[${attribute}]`)) {
    button.setAttribute('aria-pressed', String(button.getAttribute(attribute) === String(value)));
  }
}

// ---------- criar sala ----------

function renderCreateOptions() {
  createMaxPlayers = Math.min(Math.max(createMaxPlayers, 2), limits.maxPlayersPerRoom);
  $('#max-players').textContent = String(createMaxPlayers);
  $('#max-players-down').disabled = createMaxPlayers <= 2;
  $('#max-players-up').disabled = createMaxPlayers >= limits.maxPlayersPerRoom;
  setPressed($('#create-visibility'), 'data-public', createPublic);
  const hint = $('#visibility-hint');
  hint.dataset.i18n = createPublic ? 'create.publicHint' : 'create.privateHint';
  hint.textContent = t(hint.dataset.i18n);
  const spectatorsAllowed = limits.maxSpectatorsPerRoom > 0;
  $('#allow-spectators').disabled = !spectatorsAllowed;
  if (!spectatorsAllowed) {
    $('#allow-spectators').checked = false;
  }
}

$('#max-players-down').addEventListener('click', () => { createMaxPlayers -= 1; renderCreateOptions(); });
$('#max-players-up').addEventListener('click', () => { createMaxPlayers += 1; renderCreateOptions(); });
$('#create-visibility').addEventListener('click', (event) => {
  const button = event.target.closest('[data-public]');
  if (button) {
    createPublic = button.dataset.public === 'true';
    renderCreateOptions();
  }
});

function lockLobby(locked) {
  for (const control of document.querySelectorAll('#lobby button, #lobby input')) {
    control.disabled = locked;
  }
  if (!locked) {
    renderCreateOptions();
    renderPublicRooms();
  }
}

$('#panel-create').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    say(lobbyFeedback);
    const playerName = readName();
    const characterName = readCharacter(false);
    const roomName = roomNameInput.value.trim() || t('create.defaultName', { name: playerName }).slice(0, 40);
    lockLobby(true);
    await ensureConnection();
    const result = await connection.invoke('CreateRoom', {
      playerName,
      characterName,
      roomName,
      maxPlayers: createMaxPlayers,
      isPublic: createPublic,
      allowSpectators: $('#allow-spectators').checked,
      reconnectToken: sessionPlayerToken || null,
    });
    enteredRoom(result, false);
  } catch (error) {
    sayError(lobbyFeedback, error, 'room.joinFailed');
  } finally {
    lockLobby(false);
  }
});

// ---------- entrar com código / pela busca ----------

$('#join-role').addEventListener('click', (event) => {
  const button = event.target.closest('[data-spectator]');
  if (button) {
    joinAsSpectator = button.dataset.spectator === 'true';
    setPressed($('#join-role'), 'data-spectator', joinAsSpectator);
    updateCharacterLabel();
  }
});

codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
});

async function joinRoom(code, asSpectator, { silent = false } = {}) {
  try {
    if (!silent) say(lobbyFeedback);
    const playerName = readName();
    const characterName = readCharacter(asSpectator);
    lockLobby(true);
    await ensureConnection();
    const result = await connection.invoke('JoinRoom', {
      code,
      playerName,
      characterName: characterName || null,
      asSpectator,
      reconnectToken: code === sessionRoomCode && sessionPlayerToken ? sessionPlayerToken : null,
    });
    enteredRoom(result, asSpectator);
  } catch (error) {
    sayError(lobbyFeedback, error, 'room.joinFailed');
  } finally {
    lockLobby(false);
  }
}

$('#panel-join').addEventListener('submit', (event) => {
  event.preventDefault();
  joinRoom(codeInput.value.trim().toUpperCase(), joinAsSpectator);
});

function enteredRoom(result, asSpectator) {
  const room = result.room;
  sessionPlayerToken = result.reconnectToken;
  sessionRoomCode = room.code;
  sessionSpectator = Boolean(room.isSpectator ?? asSpectator);
  session.set('dados-destino-room', room.code);
  session.set('dados-destino-player-token', sessionPlayerToken);
  session.set('dados-destino-spectator', sessionSpectator ? '1' : '0');
  session.set('dados-destino-name', nameInput.value.trim());
  session.set('dados-destino-character', characterInput.value.trim());
  const url = new URL(location.href);
  url.searchParams.set('room', room.code);
  history.replaceState(null, '', url);
  clearInterval(searchTimer);
  say(roomFeedback);
  renderRoom(room);
  if (room.rolls?.length) {
    window.dispatchEvent(new CustomEvent('room-shared-history', { detail: room.rolls }));
  }
}

// ---------- procurar salas ----------

async function loadPublicRooms(quiet = false) {
  if (!quiet) {
    roomResultsEmpty.textContent = t('search.loading');
    roomResultsEmpty.hidden = false;
  }
  try {
    await ensureConnection();
    publicRooms = await connection.invoke('ListRooms');
  } catch (error) {
    publicRooms = null;
    roomResults.replaceChildren();
    roomResultsEmpty.hidden = false;
    roomResultsEmpty.textContent = errorText(error, 'search.failed');
    return;
  }
  renderPublicRooms();
}

function normalize(text) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function renderPublicRooms() {
  if (!publicRooms) {
    return;
  }
  const query = searchInput.value.trim();
  const needle = normalize(query);
  const matches = publicRooms.filter((room) => !needle
    || normalize(room.name).includes(needle)
    || normalize(room.masterName).includes(needle)
    || normalize(room.code).includes(needle));

  roomResults.replaceChildren();
  roomResultsEmpty.hidden = matches.length > 0;
  roomResultsEmpty.textContent = publicRooms.length === 0
    ? t('search.empty')
    : t('search.noMatch', { query });

  for (const room of matches) {
    const item = document.createElement('li');
    const info = document.createElement('div');
    const name = document.createElement('strong');
    const meta = document.createElement('span');
    const stats = document.createElement('span');
    const actions = document.createElement('div');
    const full = room.players >= room.maxPlayers;

    item.className = 'room-result';
    info.className = 'room-result-info';
    name.textContent = room.name;
    meta.className = 'room-result-meta';
    meta.textContent = `${room.code}${room.masterName ? ` · ${t('search.master', { name: room.masterName })}` : ''}`;
    stats.className = 'room-result-stats';
    stats.textContent = t('search.players', { count: room.players, max: room.maxPlayers })
      + (room.spectators ? ` · ${t('search.spectators', { count: room.spectators })}` : '');
    if (full) {
      const badge = document.createElement('span');
      badge.className = 'badge badge-warm';
      badge.textContent = t('search.full');
      stats.append(' ', badge);
    }
    info.append(name, meta, stats);

    actions.className = 'room-result-actions';
    const join = document.createElement('button');
    join.type = 'button';
    join.className = 'room-button room-button-primary';
    join.textContent = t('join.submit');
    join.disabled = full;
    join.addEventListener('click', () => joinRoom(room.code, false));
    actions.append(join);
    if (room.allowSpectators) {
      const watch = document.createElement('button');
      watch.type = 'button';
      watch.className = 'room-button';
      watch.textContent = t('join.watch');
      watch.addEventListener('click', () => joinRoom(room.code, true));
      actions.append(watch);
    }
    item.append(info, actions);
    roomResults.append(item);
  }
}

searchInput.addEventListener('input', renderPublicRooms);
$('#room-search-refresh').addEventListener('click', () => loadPublicRooms());

// ---------- painel da sala ----------

function updateRollControls(room) {
  const canRoll = room && !room.isSpectator;
  tableRollControls.hidden = !canRoll;
  rollVisibility.hidden = !(canRoll && room.isMaster);
  if (!canRoll) {
    rollTarget.replaceChildren();
    return;
  }

  const previousTarget = rollTarget.value;
  const eligiblePlayers = room.isMaster ? room.players : room.players.filter((player) => player.id === room.myPlayerId);
  rollTarget.replaceChildren();
  for (const player of eligiblePlayers) {
    const option = document.createElement('option');
    option.value = player.id;
    option.textContent = `${player.characterName} (${player.name})${player.isMaster ? ` · ${t('roller.masterTag')}` : ''}`;
    rollTarget.append(option);
  }
  rollTarget.value = eligiblePlayers.some((player) => player.id === previousTarget) ? previousTarget : room.myPlayerId;
  syncPrivateRollButtons();
}

function syncPrivateRollButtons() {
  setPressed(rollVisibility, 'data-visibility', privateRoll ? 'private' : 'public');
}

function personLine(text, tags) {
  const item = document.createElement('li');
  const label = document.createElement('span');
  label.className = 'person-name';
  label.textContent = text;
  item.append(label);
  for (const tag of tags) {
    const chip = document.createElement('span');
    chip.className = `person-tag${tag.className ? ` ${tag.className}` : ''}`;
    chip.textContent = tag.text;
    item.append(chip);
  }
  return item;
}

function renderRoomPanel(room) {
  $('#room-title').textContent = room.name || room.code;
  const badge = $('#room-visibility-badge');
  badge.textContent = t(room.isPublic ? 'room.public' : 'room.private');
  badge.className = `badge${room.isPublic ? '' : ' badge-warm'}`;
  $('#active-room-code').textContent = room.code;
  $('#player-count').textContent = `${room.players.length} / ${room.maxPlayers}`;

  playerList.replaceChildren(...room.players.map((player) => {
    const tags = [];
    if (player.id === room.myPlayerId) tags.push({ text: t('room.you'), className: 'is-you' });
    if (player.isMaster) tags.push({ text: t('room.master'), className: 'is-master' });
    if (!player.isOnline) tags.push({ text: t('room.offline'), className: 'is-offline' });
    const line = personLine(`${player.characterName} (${player.name})`, tags);
    line.classList.toggle('is-offline', !player.isOnline);
    return line;
  }));

  const spectators = room.spectators || [];
  $('#spectator-block').hidden = spectators.length === 0;
  $('#spectator-count').textContent = room.maxSpectators ? `${spectators.length} / ${room.maxSpectators}` : String(spectators.length);
  spectatorList.replaceChildren(...spectators.map((spectator) => {
    const tags = [];
    if (spectator.id === room.myPlayerId) tags.push({ text: t('room.you'), className: 'is-you' });
    if (!spectator.isOnline) tags.push({ text: t('room.offline'), className: 'is-offline' });
    return personLine(spectator.name, tags);
  }));

  roomSettings.hidden = !room.isMaster;
  if (!room.isMaster) {
    roomSettings.open = false;
  }
  $('#spectator-note').hidden = !room.isSpectator;
}

function fillRoomSettings() {
  if (!activeRoom) return;
  $('#settings-room-name').value = activeRoom.name || '';
  settingsMaxPlayers = activeRoom.maxPlayers;
  settingsPublic = activeRoom.isPublic;
  $('#settings-spectators').checked = activeRoom.allowSpectators;
  $('#settings-spectators').disabled = limits.maxSpectatorsPerRoom === 0;
  renderSettingsOptions();
}

function renderSettingsOptions() {
  const minimum = Math.max(2, activeRoom?.players.length || 2);
  settingsMaxPlayers = Math.min(Math.max(settingsMaxPlayers, minimum), limits.maxPlayersPerRoom);
  $('#settings-max-players').textContent = String(settingsMaxPlayers);
  $('#settings-max-down').disabled = settingsMaxPlayers <= minimum;
  $('#settings-max-up').disabled = settingsMaxPlayers >= limits.maxPlayersPerRoom;
  setPressed($('#settings-visibility'), 'data-public', settingsPublic);
}

roomSettings.addEventListener('toggle', () => {
  if (roomSettings.open) fillRoomSettings();
});
$('#settings-max-down').addEventListener('click', () => { settingsMaxPlayers -= 1; renderSettingsOptions(); });
$('#settings-max-up').addEventListener('click', () => { settingsMaxPlayers += 1; renderSettingsOptions(); });
$('#settings-visibility').addEventListener('click', (event) => {
  const button = event.target.closest('[data-public]');
  if (button) {
    settingsPublic = button.dataset.public === 'true';
    renderSettingsOptions();
  }
});
$('#room-settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await connection.invoke('UpdateRoomSettings', {
      roomName: $('#settings-room-name').value.trim(),
      maxPlayers: settingsMaxPlayers,
      isPublic: settingsPublic,
      allowSpectators: $('#settings-spectators').checked,
    });
    roomSettings.open = false;
    say(roomFeedback, 'room.saved');
  } catch (error) {
    sayError(roomFeedback, error, 'room.joinFailed');
  }
});

function renderRoom(room) {
  if (!room || activeRoom?.code !== room.code) {
    privateRoll = false;
  }
  activeRoom = room;
  if (!room) {
    updateRollControls(null);
    window.dispatchEvent(new CustomEvent('room-state', { detail: { code: '', players: [], spectators: [], rolls: [] } }));
    updateHostChip();
    return;
  }
  renderRoomPanel(room);
  updateRollControls(room);
  updateHostChip();
  window.dispatchEvent(new CustomEvent('room-state', { detail: room }));
}

$('#leave-room').addEventListener('click', async () => {
  try {
    await connection.invoke('LeaveRoom');
    renderRoom(null);
    sessionRoomCode = '';
    sessionPlayerToken = '';
    session.remove('dados-destino-room');
    session.remove('dados-destino-player-token');
    session.remove('dados-destino-spectator');
    session.remove('dados-destino-name');
    session.remove('dados-destino-character');
    codeInput.value = '';
    const url = new URL(location.href);
    url.searchParams.delete('room');
    history.replaceState(null, '', url);
    say(lobbyFeedback, 'room.left');
    selectTab(lobbyTab);
  } catch {
    say(roomFeedback, 'room.leaveFailed');
  }
});

// ---------- link de convite do anfitrião ----------
// O anfitrião vê a mesa em localhost; o convite precisa ser o link da internet
// que o app gerou. Quem entrou pelo link já está no endereço certo.

const isHostView = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const hostChip = $('#host-chip');
const hostChipText = $('#host-chip-text');
const hostChipLink = $('#host-chip-link');
const hostChipReveal = $('#host-chip-reveal');
const hostChipCopy = $('#host-chip-copy');
const hostChipRetry = $('#host-chip-retry');
let tunnelInfo = null;
let publicBaseUrl = '';
let linkRevealed = false;
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

function setIcon(button, icon, labelKey) {
  button.querySelector('use').setAttribute('href', `#i-${icon}`);
  button.setAttribute('aria-label', t(labelKey));
  button.title = t(labelKey);
}

function updateHostChip() {
  if (!tunnelInfo || tunnelInfo.status === 'off') {
    hostChip.hidden = true;
    return;
  }
  hostChip.hidden = false;
  hostChip.dataset.status = tunnelInfo.status;
  const ready = Boolean(publicBaseUrl);
  hostChipReveal.hidden = !ready;
  hostChipCopy.hidden = !ready;
  hostChipRetry.hidden = tunnelInfo.status !== 'error';
  hostChipLink.hidden = !(ready && linkRevealed);
  hostChipLink.textContent = ready ? inviteUrlFor(activeRoom?.code) : '';
  setIcon(hostChipReveal, linkRevealed ? 'eye-off' : 'eye', linkRevealed ? 'host.hide' : 'host.show');
  hostChipReveal.setAttribute('aria-pressed', String(linkRevealed));
  setIcon(hostChipCopy, 'copy', 'host.copy');
  setIcon(hostChipRetry, 'refresh', 'host.retry');

  if (tunnelInfo.status === 'downloading') {
    hostChipText.textContent = t('host.preparing', { percent: tunnelInfo.percent || 0 });
  } else if (tunnelInfo.status === 'starting') {
    hostChipText.textContent = t('host.starting');
  } else if (tunnelInfo.status === 'ready') {
    hostChipText.textContent = t('host.ready');
  } else {
    const code = tunnelInfo.error || '';
    const reason = t(`tunnel.${code}`) !== `tunnel.${code}` ? t(`tunnel.${code}`) : code || t('tunnel.unknown');
    hostChipText.textContent = t('host.error');
    hostChip.title = reason;
  }
  if (tunnelInfo.status !== 'error') {
    hostChip.removeAttribute('title');
  }
}

async function copyInvite(button) {
  const code = activeRoom?.code || '';
  const link = inviteUrlFor(code);
  const feedback = activeRoom ? roomFeedback : lobbyFeedback;
  if (!link) {
    say(feedback, 'room.linkPending', { code });
    return;
  }
  try {
    await navigator.clipboard.writeText(link);
    const use = button.querySelector('use');
    use.setAttribute('href', '#i-check');
    button.classList.add('is-done');
    setTimeout(() => {
      use.setAttribute('href', '#i-copy');
      button.classList.remove('is-done');
    }, 1800);
    say(feedback, code ? 'room.inviteCopied' : 'room.linkCopiedNoRoom');
  } catch {
    say(feedback, 'room.shareFallback', { link });
  }
}

async function refreshHostChip() {
  clearTimeout(hostPollTimer);
  try {
    tunnelInfo = await fetch('/api/info', { cache: 'no-store' }).then((response) => response.json());
  } catch {
    hostPollTimer = setTimeout(refreshHostChip, 5000);
    return;
  }
  publicBaseUrl = tunnelInfo?.status === 'ready' && tunnelInfo.url ? tunnelInfo.url : '';
  updateHostChip();
  if (!tunnelInfo || tunnelInfo.status === 'off') {
    return;
  }
  const delay = tunnelInfo.status === 'ready' ? 15000 : tunnelInfo.status === 'error' ? 30000 : 1200;
  hostPollTimer = setTimeout(refreshHostChip, delay);
}

hostChipReveal.addEventListener('click', () => {
  linkRevealed = !linkRevealed;
  updateHostChip();
});
hostChipCopy.addEventListener('click', () => copyInvite(hostChipCopy));
$('#copy-room-link').addEventListener('click', (event) => copyInvite(event.currentTarget));
hostChipRetry.addEventListener('click', async () => {
  tunnelInfo = { status: 'starting' };
  updateHostChip();
  try {
    await fetch('/api/tunnel/retry', { method: 'POST' });
  } finally {
    refreshHostChip();
  }
});
if (isHostView) {
  refreshHostChip();
}

// Dentro do app, o botão "Início" volta para a tela de hospedar/entrar.
const appBridge = window.chrome?.webview;
if (appBridge) {
  const homeButton = $('#app-home');
  homeButton.hidden = false;
  homeButton.addEventListener('click', () => appBridge.postMessage({ action: 'home' }));
}

// ---------- idioma ----------

window.addEventListener('languagechange-app', () => {
  setConnectionStatus(!connectionDot.classList.contains('is-offline'), connectionKey);
  updateCharacterLabel();
  renderCreateOptions();
  if (activeRoom) {
    renderRoomPanel(activeRoom);
    updateRollControls(activeRoom);
  }
  renderPublicRooms();
  updateHostChip();
  if (lastFeedback.element && lastFeedback.key) {
    lastFeedback.element.textContent = t(lastFeedback.key, lastFeedback.params);
  }
});

// ---------- eventos do servidor ----------

connection.on('RoomUpdated', (roster) => {
  if (activeRoom?.code === roster.code) {
    const me = roster.players.find((player) => player.id === activeRoom.myPlayerId);
    renderRoom({
      ...activeRoom,
      name: roster.name,
      maxPlayers: roster.maxPlayers,
      isPublic: roster.isPublic,
      allowSpectators: roster.allowSpectators,
      maxSpectators: roster.maxSpectators,
      players: roster.players,
      spectators: roster.spectators,
      isMaster: Boolean(me?.isMaster),
    });
  }
});

connection.on('ReceiveRoll', (roll) => {
  window.dispatchEvent(new CustomEvent('room-shared-roll', { detail: roll }));
});

connection.onreconnecting(() => setConnectionStatus(false, 'status.reconnecting'));
connection.onreconnected(async () => {
  setConnectionStatus(true, 'status.connected');
  if (!activeRoom) {
    return;
  }
  try {
    const result = await connection.invoke('JoinRoom', {
      code: activeRoom.code,
      playerName: nameInput.value.trim(),
      characterName: activeRoom.isSpectator ? null : characterInput.value.trim(),
      asSpectator: Boolean(activeRoom.isSpectator),
      reconnectToken: sessionPlayerToken,
    });
    sessionPlayerToken = result.reconnectToken;
    session.set('dados-destino-player-token', sessionPlayerToken);
    renderRoom(result.room);
  } catch {
    renderRoom(null);
    say(lobbyFeedback, 'room.closed');
  }
});
connection.onclose(() => setConnectionStatus(false, 'status.disconnected'));

async function startRoomConnection() {
  try {
    await ensureConnection();
    setConnectionStatus(true, 'status.connected');
    try {
      limits = await connection.invoke('GetLimits');
    } catch {
      // Servidor antigo: mantém os limites padrão.
    }
    renderCreateOptions();
    // Recarregou a página dentro de uma sala: volta com a mesma identidade.
    if (roomParameter && sessionRoomCode === roomParameter && nameInput.value.trim()) {
      await joinRoom(roomParameter, sessionSpectator, { silent: true });
    }
  } catch {
    setConnectionStatus(false, 'status.offline');
    say(lobbyFeedback, 'room.serverOffline');
  }
}

export function createRoomManager({ onRoomRoll, onRoomHistory, onRoomState }) {
  window.addEventListener('room-shared-roll', (event) => onRoomRoll(event.detail));
  window.addEventListener('room-shared-history', (event) => onRoomHistory(event.detail));
  window.addEventListener('room-state', (event) => onRoomState(event.detail));

  setConnectionStatus(false, 'status.connecting');
  renderCreateOptions();
  if (roomParameter) {
    codeInput.value = roomParameter;
    selectTab('join');
    // Chegou por um convite: só falta o nome para entrar.
    if (sessionRoomCode !== roomParameter) {
      say(lobbyFeedback, 'join.invited');
      (nameInput.value ? (characterInput.value ? $('#panel-join .lobby-submit') : characterInput) : nameInput).focus();
    }
  } else {
    selectTab('create');
  }
  startRoomConnection();

  return {
    getPlayerName: () => (activeRoom ? nameInput.value.trim() : ''),
    getCharacterName: () => (activeRoom ? characterInput.value.trim() : ''),
    getRollContext: () => ({
      targetPlayerId: activeRoom && !activeRoom.isSpectator ? rollTarget.value : '',
      isPrivate: Boolean(activeRoom?.isMaster && privateRoll && rollTarget.value === activeRoom.myPlayerId),
    }),
    isSpectator: () => Boolean(activeRoom?.isSpectator),
    shareRoll: (roll) => (activeRoom && !activeRoom.isSpectator
      ? connection.invoke('ShareRoll', roll)
      : Promise.resolve()),
  };
}

rollVisibility.addEventListener('click', (event) => {
  const button = event.target.closest('[data-visibility]');
  if (button) {
    privateRoll = button.dataset.visibility === 'private';
    syncPrivateRollButtons();
  }
});

rollTarget.addEventListener('change', () => {
  if (activeRoom?.isMaster && rollTarget.value !== activeRoom.myPlayerId) {
    privateRoll = false;
    syncPrivateRollButtons();
  }
});
