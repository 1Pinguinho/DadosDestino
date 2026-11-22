// Ponto de entrada da mesa: rolagens, a mesa da campanha e o histórico.
// As salas ficam em rooms.js; idioma em i18n.js; tema e animações em settings.js.
import { DiceRoll } from '/vendor/rpg-dice-roller.mjs';
import { t, errorCode, errorText, formatTime } from './i18n.js';
import { createRoomManager } from './rooms.js';
import { createDiceAnimator, packDice } from './dice-animation.js';
import { diceColorValue, getSettings, initSettings } from './settings.js';
import { playLand, playOutcome } from './sound.js';
import { initShortcuts } from './shortcuts.js';
import { initTitlebar } from './titlebar.js';
import { initChat } from './chat.js';
import { initReactions } from './reactions.js';

initSettings();
initTitlebar();

const historyKey = 'dados-destino-history-v1';
const form = document.querySelector('#roll-form');
const notationInput = document.querySelector('#notation');
const quantityInput = document.querySelector('#quantity');
const modifierInput = document.querySelector('#modifier');
const feedback = document.querySelector('#roll-feedback');
const historyList = document.querySelector('#history-list');
const historyEmpty = document.querySelector('#history-empty');
const clearHistoryButton = document.querySelector('#clear-history');
const dieOptions = [...document.querySelectorAll('.die-option')];
const partySeats = document.querySelector('#party-seats');
const partyTableCount = document.querySelector('#party-table-count');
const rollTarget = document.querySelector('#roll-target');
const clearTableFocus = document.querySelector('#clear-table-focus');
const rollButton = document.querySelector('.roll-button');
const workspace = document.querySelector('.workspace');
let selectedSides = 20;
let roomManager;
let reactions = null;
let focusedPlayerId = '';
let partyState = { code: '', myPlayerId: '', isMaster: false, players: [], spectators: [], rolls: [] };
let feedbackKey = '';
// Rolagens feitas aqui: o eco que volta do servidor é ignorado (já animou aqui).
const localRollsInFlight = new Set();
// Um lugar por jogador, reaproveitado entre atualizações para a animação não reiniciar.
const seats = new Map();

function showFeedback(key = '', params = {}) {
  feedbackKey = key;
  feedback.textContent = key ? t(key, params) : '';
}

function historyEntryId(entry) {
  return entry.id || `${entry.timestamp}:${entry.player || ''}:${entry.notation}:${entry.total}`;
}

function rollAuthor(entry) {
  return entry.characterName && entry.player
    ? `${entry.characterName} (${entry.player})`
    : entry.player || '';
}

function mergeHistory(entries) {
  const merged = new Map(history.map((entry) => [historyEntryId(entry), entry]));
  for (const entry of entries) {
    if (entry && typeof entry.notation === 'string' && Number.isFinite(entry.total)
      && typeof entry.output === 'string' && Number.isFinite(entry.timestamp)) {
      merged.set(historyEntryId(entry), { ...entry, roomCode: entry.roomCode || partyState.code });
    }
  }
  history = [...merged.values()].sort((left, right) => right.timestamp - left.timestamp).slice(0, 20);
  saveHistory();
  renderHistory();
}

// ---------- mesa da campanha ----------

function animationSource(roll) {
  return { dice: roll.dice || [], extraDice: roll.extraDice || 0, total: roll.total, diceColor: roll.diceColor || 'classic', diceStyle: roll.diceStyle || 'classic' };
}

function createSeat(playerId) {
  const seat = document.createElement('article');
  const head = document.createElement('header');
  const avatar = document.createElement('span');
  const details = document.createElement('span');
  const name = document.createElement('strong');
  const presence = document.createElement('small');
  const actions = document.createElement('div');
  const stage = document.createElement('div');
  const waiting = document.createElement('p');
  const foot = document.createElement('div');
  const notation = document.createElement('span');
  const visibility = document.createElement('small');

  seat.className = 'player-seat';
  seat.dataset.playerId = playerId;
  head.className = 'seat-head';
  avatar.className = 'seat-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  details.className = 'seat-details';
  name.className = 'seat-name';
  presence.className = 'seat-presence';
  actions.className = 'seat-actions';
  stage.className = 'seat-stage dice-skin';
  stage.setAttribute('aria-hidden', 'true');
  waiting.className = 'seat-waiting';
  foot.className = 'seat-foot';
  notation.className = 'seat-notation';
  visibility.className = 'seat-visibility';
  details.append(name, presence);
  head.append(avatar, details, actions);
  foot.append(notation, visibility);
  seat.append(head, stage, waiting, foot);

  const entry = {
    seat, avatar, name, presence, actions, stage, waiting, notation, visibility,
    animator: createDiceAnimator(stage, { onLand: playLand, onOutcome: playOutcome }),
    shownRollId: null,
    actionsKey: '',
  };
  seats.set(playerId, entry);
  return entry;
}

function showSeatRoll(entry, roll) {
  entry.waiting.hidden = Boolean(roll);
  entry.waiting.textContent = t('table.waiting');
  entry.stage.hidden = !roll;
  entry.notation.textContent = roll ? roll.notation : '';
  entry.visibility.textContent = roll?.isPrivate ? t('table.private') : '';
  entry.seat.classList.toggle('has-roll', Boolean(roll));
}

function updateSeat(entry, player, index, room, lastRoll) {
  entry.seat.dataset.color = player.color || '';
  entry.seat.classList.toggle('is-offline', !player.isOnline);
  entry.avatar.textContent = player.name.trim().slice(0, 1).toUpperCase();
  entry.name.textContent = `${player.characterName} (${player.name})`;
  entry.presence.textContent = [
    player.isMaster ? t('room.master').toUpperCase() : '',
    lastRoll ? t('table.rolled') : t('table.seated'),
  ].filter(Boolean).join(' · ');

  // Botões: focar (todos) e rolar aqui (quem pode rolar nessa mesa).
  const canRollHere = !room.isSpectator && (room.isMaster || player.id === room.myPlayerId);
  // Reagir: na mesa dos outros, para quem está numa sala.
  const canReact = Boolean(reactions && room.code && player.id !== room.myPlayerId);
  const actionsKey = `${canRollHere}:${canReact}`;
  if (entry.actionsKey !== actionsKey) {
    entry.actionsKey = actionsKey;
    const focusButton = document.createElement('button');
    focusButton.type = 'button';
    focusButton.className = 'seat-action seat-focus';
    focusButton.addEventListener('click', () => {
      focusedPlayerId = focusedPlayerId === player.id ? '' : player.id;
      updateTableFocus();
    });
    const buttons = canReact ? [reactions.button(player.id, entry.seat), focusButton] : [focusButton];
    if (canRollHere) {
      const rollHereButton = document.createElement('button');
      rollHereButton.type = 'button';
      rollHereButton.className = 'seat-action seat-roll-here';
      rollHereButton.addEventListener('click', () => {
        rollTarget.value = player.id;
        rollTarget.dispatchEvent(new Event('change'));
        focusedPlayerId = player.id;
        updateTableFocus();
        notationInput.focus();
      });
      buttons.push(rollHereButton);
    }
    entry.actions.replaceChildren(...buttons);
  }
  const rollHere = entry.actions.querySelector('.seat-roll-here');
  if (rollHere) {
    rollHere.textContent = t('table.rollHere');
  }

  // Enquanto os dados rolam nessa mesa, a animação não é tocada.
  if (!entry.animator.isPlaying()) {
    const rollId = lastRoll?.id || '';
    if (entry.shownRollId !== rollId) {
      entry.shownRollId = rollId;
      entry.animator.show(lastRoll ? animationSource(lastRoll) : null);
    }
    showSeatRoll(entry, lastRoll);
  }
}

function removeSeat(playerId) {
  const entry = seats.get(playerId);
  if (entry) {
    entry.animator.finish();
    entry.seat.remove();
    seats.delete(playerId);
  }
}

// A última rolagem de cada mesa. As atualizações da sala (alguém entrou, voltou,
// trocou de cor) não trazem rolagens, então o que já está na mesa é mantido; as que
// chegam depois (ao vivo ou na lista completa ao entrar) substituem as anteriores.
function mergeTableRolls(current, incoming) {
  const latest = new Map();
  for (const roll of [...current, ...incoming]) {
    if (roll && roll.id && roll.targetPlayerId) {
      latest.set(roll.targetPlayerId, roll);
    }
  }
  return [...latest.values()];
}

function renderPartyTable(room) {
  const sameRoom = partyState.code === room.code;
  if (!sameRoom) {
    // Ao entrar numa sala, mantém só o histórico salvo dessa sala; ao sair, limpa.
    // Na abertura da página (sem sala ainda) o histórico salvo não é tocado.
    history = room.code ? history.filter((entry) => entry.roomCode === room.code) : [];
    saveHistory();
    renderHistory();
    for (const playerId of [...seats.keys()]) {
      seats.get(playerId).animator.cancel();
      removeSeat(playerId);
    }
    localRollsInFlight.clear();
    rollButton.classList.remove('is-rolling');
  }
  const players = Array.isArray(room.players) ? room.players : [];
  const spectators = Array.isArray(room.spectators) ? room.spectators : [];
  const rolls = mergeTableRolls(sameRoom ? partyState.rolls : [], Array.isArray(room.rolls) ? room.rolls : [])
    .filter((roll) => players.some((player) => player.id === roll.targetPlayerId));
  partyState = { ...room, rolls };
  workspace.classList.toggle('in-room', Boolean(room.code));
  workspace.classList.toggle('is-spectator', Boolean(room.isSpectator));
  document.querySelector('#room-heading').textContent = room.name || t('lobby.title1');
  if (focusedPlayerId && !players.some((player) => player.id === focusedPlayerId)) {
    focusedPlayerId = '';
  }
  const latestRolls = new Map();
  for (const roll of rolls) {
    if (roll.targetPlayerId) {
      latestRolls.set(roll.targetPlayerId, roll);
    }
  }

  partyTableCount.textContent = room.code
    ? t('table.count', { count: players.length, max: room.maxPlayers || players.length })
      + (spectators.length ? ` · ${t('table.watchers', { count: spectators.length })}` : '')
    : t('table.mine');

  partySeats.querySelector('.table-empty')?.remove();
  for (const playerId of [...seats.keys()]) {
    if (!players.some((player) => player.id === playerId)) {
      removeSeat(playerId);
    }
  }
  partySeats.classList.toggle('is-solo', players.length === 1);

  if (players.length === 0) {
    const empty = document.createElement('div');
    const emblem = document.createElement('span');
    const message = document.createElement('span');
    const hint = document.createElement('small');
    empty.className = 'table-empty';
    emblem.className = 'table-emblem';
    emblem.setAttribute('aria-hidden', 'true');
    emblem.textContent = 'D20';
    message.textContent = t('table.empty');
    hint.textContent = t('table.emptyHint');
    empty.append(emblem, message, hint);
    partySeats.append(empty);
    updateTableFocus();
    return;
  }

  players.forEach((player, index) => {
    const entry = seats.get(player.id) || createSeat(player.id);
    // Só move o lugar quando a ordem muda (mover reinicia as animações).
    if (partySeats.children[index] !== entry.seat) {
      partySeats.insertBefore(entry.seat, partySeats.children[index] || null);
    }
    updateSeat(entry, player, index, room, latestRolls.get(player.id));
  });
  updateTableFocus();
}

// Brilho no lugar de quem acabou de receber uma rolagem.
function flashSeat(entry) {
  entry.seat.classList.remove('just-rolled');
  void entry.seat.offsetWidth;
  entry.seat.classList.add('just-rolled');
}

// Rola os dados na mesa do jogador alvo e chama onDone quando o total aparece.
function animateOnSeat(roll, onDone) {
  const entry = seats.get(roll.targetPlayerId);
  if (!entry) {
    onDone();
    return;
  }
  entry.shownRollId = roll.id;
  showSeatRoll(entry, roll);
  entry.animator.play(animationSource(roll), () => {
    flashSeat(entry);
    onDone();
  });
}

function updateTableFocus() {
  document.querySelector('.party-table').classList.toggle('has-focus', Boolean(focusedPlayerId));
  for (const seat of partySeats.querySelectorAll('.player-seat')) {
    const focused = seat.dataset.playerId === focusedPlayerId;
    seat.classList.toggle('is-focused', focused);
    const button = seat.querySelector('.seat-focus');
    if (button) {
      button.setAttribute('aria-pressed', String(focused));
      button.textContent = focused ? t('table.focused') : t('table.focus');
    }
  }
}

// ---------- histórico ----------

function readHistory() {
  try {
    const stored = JSON.parse(localStorage.getItem(historyKey) || '[]');
    return Array.isArray(stored)
      ? stored.filter((entry) => entry && typeof entry.notation === 'string'
        && typeof entry.output === 'string' && Number.isFinite(entry.total)
        && Number.isFinite(entry.timestamp) && !entry.isPrivate).slice(0, 20)
      : [];
  } catch {
    return [];
  }
}

let history = readHistory();

function saveHistory() {
  try {
    localStorage.setItem(historyKey, JSON.stringify(history.filter((entry) => !entry.isPrivate)));
  } catch {
    showFeedback('roller.storage');
  }
}

function renderHistory() {
  historyList.replaceChildren();
  historyEmpty.hidden = history.length > 0;
  clearHistoryButton.disabled = history.length === 0;
  document.querySelector('#history-count').textContent = t(history.length === 1 ? 'history.one' : 'history.other', { count: history.length });

  for (const entry of history) {
    const item = document.createElement('li');
    const repeatButton = document.createElement('button');
    const notation = document.createElement('span');
    const detail = document.createElement('span');
    const total = document.createElement('strong');
    const time = document.createElement('time');
    const date = new Date(entry.timestamp);

    repeatButton.className = 'history-entry';
    repeatButton.type = 'button';
    repeatButton.setAttribute('aria-label', t('history.repeat', { notation: entry.notation, total: entry.total }));
    notation.className = 'history-notation';
    notation.textContent = entry.notation;
    detail.className = 'history-detail';
    const author = rollAuthor(entry);
    detail.textContent = `${entry.isPrivate ? `${t('history.private')} · ` : ''}${author ? `${author} · ` : ''}${entry.output}`;
    total.className = 'history-total';
    total.textContent = String(entry.total);
    time.className = 'history-time';
    time.dateTime = date.toISOString();
    time.textContent = formatTime(date);

    const entryText = document.createElement('span');
    entryText.className = 'history-copy';
    entryText.append(notation, detail);
    repeatButton.append(entryText, total, time);
    repeatButton.addEventListener('click', () => {
      notationInput.value = entry.notation;
      notationInput.focus();
    });
    item.append(repeatButton);
    historyList.append(item);
  }
}

// ---------- rolagem ----------

// Guarda a rolagem na mesa e no histórico depois que o total aparece.
function recordRoll(roll) {
  mergeHistory([roll]);
  historyList.scrollTop = 0;
  const otherRolls = partyState.rolls.filter((entry) => entry.targetPlayerId !== roll.targetPlayerId && entry.id !== roll.id);
  renderPartyTable({ ...partyState, rolls: [...otherRolls, roll] });
}

function rollDice(notation) {
  if (roomManager?.isSpectator()) {
    return;
  }
  const cleanedNotation = notation.trim();
  if (!cleanedNotation) {
    showFeedback('roller.empty');
    notationInput.focus();
    return;
  }

  let roll;
  try {
    roll = new DiceRoll(cleanedNotation);
  } catch {
    showFeedback('roller.invalid');
    notationInput.focus();
    return;
  }

  const rollContext = roomManager?.getRollContext() || { targetPlayerId: '', isPrivate: false };
  const entry = {
    id: crypto.randomUUID(),
    notation: roll.notation,
    total: roll.total,
    output: roll.output,
    timestamp: Date.now(),
    player: roomManager?.getPlayerName() || '',
    characterName: roomManager?.getCharacterName() || '',
    targetPlayerId: rollContext.targetPlayerId,
    isPrivate: rollContext.isPrivate,
    roomCode: partyState.code,
    diceColor: diceColorValue(),
    diceStyle: getSettings().diceStyle,
    ...packDice(roll),
  };
  showFeedback();
  rollButton.classList.add('is-rolling');
  localRollsInFlight.add(entry.id);
  // Vai para a sala na hora: todos veem os dados rolarem na mesa ao mesmo tempo.
  roomManager?.shareRoll(entry).catch((error) => {
    feedbackKey = '';
    feedback.textContent = errorCode(error)
      ? t('roller.notSent', { reason: errorText(error, 'roller.localOnly') })
      : t('roller.localOnly');
  });
  animateOnSeat(entry, () => {
    rollButton.classList.remove('is-rolling');
    recordRoll(entry);
  });
}

function updateNotation() {
  const quantity = Math.min(100, Math.max(1, Number.parseInt(quantityInput.value, 10) || 1));
  const modifier = Math.min(999, Math.max(-999, Number.parseInt(modifierInput.value, 10) || 0));
  quantityInput.value = String(quantity);
  modifierInput.value = String(modifier);
  notationInput.value = `${quantity}d${selectedSides}${modifier > 0 ? `+${modifier}` : modifier < 0 ? modifier : ''}`;
  showFeedback();
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  rollDice(notationInput.value);
});

clearTableFocus.addEventListener('click', () => {
  focusedPlayerId = '';
  updateTableFocus();
});
for (const option of dieOptions) {
  option.addEventListener('click', () => {
    selectedSides = Number(option.dataset.sides);
    for (const dieOption of dieOptions) {
      const selected = dieOption === option;
      dieOption.classList.toggle('is-selected', selected);
      dieOption.setAttribute('aria-pressed', String(selected));
    }
    updateNotation();
  });
}

quantityInput.addEventListener('change', updateNotation);
modifierInput.addEventListener('change', updateNotation);

// Atalhos (os padrões e os criados pelo jogador): um clique rola.
initShortcuts({
  isValid: (notation) => {
    try {
      new DiceRoll(notation);
      return true;
    } catch {
      return false;
    }
  },
  onRoll: (notation) => {
    notationInput.value = notation;
    showFeedback();
    rollDice(notation);
  },
});

clearHistoryButton.addEventListener('click', () => {
  history = [];
  saveHistory();
  renderHistory();
});

window.addEventListener('languagechange-app', () => {
  renderHistory();
  for (const entry of seats.values()) {
    entry.shownRollId = null;
    entry.actionsKey = '';
  }
  renderPartyTable(partyState);
  if (feedbackKey) {
    feedback.textContent = t(feedbackKey);
  }
});

renderHistory();

roomManager = createRoomManager({
  onRoomRoll: (roll) => {
    if (localRollsInFlight.has(roll.id)) {
      return;
    }
    animateOnSeat(roll, () => recordRoll(roll));
  },
  onRoomHistory: (rolls) => mergeHistory(rolls),
  onRoomState: (room) => renderPartyTable(room),
});
initChat(roomManager);
reactions = initReactions({
  sendReaction: (targetPlayerId, emoji) => roomManager.sendReaction(targetPlayerId, emoji),
  seatFor: (playerId) => seats.get(playerId)?.seat || null,
});
renderPartyTable(partyState);

// Guia de notação: clicar num exemplo coloca ele no campo, pronto para rolar.
document.querySelectorAll('[data-example]').forEach((button) => {
  button.addEventListener('click', () => {
    notationInput.value = button.dataset.example;
    showFeedback();
    notationInput.focus();
  });
});
