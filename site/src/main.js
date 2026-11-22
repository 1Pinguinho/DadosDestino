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
import { avatarUrl, currentAccount, initAccount, onAccountChange } from './account.js';
import { initSheet } from './sheet.js';
import { initNotes } from './notes.js';
import { describeEffect, initRollKind } from './rollkind.js';
import { initCombat } from './combat.js';
import { initShield } from './shield.js';
import { initAmbient } from './ambient.js';
import { skillTest } from './sheet.js';
import { playTurn } from './sound.js';

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
const serverEchoes = new Map();
let rollKind = null;
let combat = null;
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
  const status = document.createElement('div');
  status.className = 'seat-status';
  status.hidden = true;
  details.append(name, presence, status);
  head.append(avatar, details, actions);
  foot.append(notation, visibility);
  seat.append(head, stage, waiting, foot);

  const entry = {
    seat, avatar, name, presence, status, actions, stage, waiting, notation, visibility,
    avatarKey: '',
    animator: createDiceAnimator(stage, { onLand: playLand, onOutcome: playOutcome }),
    shownRollId: null,
    actionsKey: '',
  };
  seats.set(playerId, entry);
  return entry;
}

function showSeatRoll(entry, roll) {
  // Às cegas para quem não pode ver: sem dados, só "?".
  const hidden = Boolean(roll?.hidden);
  entry.waiting.hidden = Boolean(roll) && !hidden;
  entry.waiting.textContent = hidden ? t('blind.secret') : t('table.waiting');
  entry.waiting.classList.toggle('is-blind', hidden);
  entry.stage.hidden = !roll || hidden;
  entry.notation.textContent = roll ? roll.notation : '';
  const effect = roll ? describeEffect(roll, partyState.players || []) : '';
  entry.visibility.textContent = [effect, roll?.isPrivate ? t('table.private') : ''].filter(Boolean).join(' · ');
  entry.seat.classList.toggle('has-roll', Boolean(roll));
}

function updateSeat(entry, player, index, room, lastRoll) {
  entry.seat.dataset.color = player.color || '';
  entry.seat.classList.toggle('is-offline', !player.isOnline);
  // Foto da conta ao lado do nome; sem foto, a inicial.
  const photo = avatarUrl(player.accountId, player.avatarVersion);
  const avatarKey = photo || `letter:${player.name}`;
  if (entry.avatarKey !== avatarKey) {
    entry.avatarKey = avatarKey;
    entry.avatar.replaceChildren();
    entry.avatar.classList.toggle('has-photo', Boolean(photo));
    if (photo) {
      const image = document.createElement('img');
      image.src = photo;
      image.alt = '';
      entry.avatar.append(image);
    } else {
      entry.avatar.textContent = player.name.trim().slice(0, 1).toUpperCase();
    }
  }
  updateSeatStatus(entry, player.status);
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
      entry.animator.show(lastRoll && !lastRoll.hidden ? animationSource(lastRoll) : null);
    }
    showSeatRoll(entry, lastRoll);
  }
}

// Barrinhas finas de vida e EA (da ficha ativa de quem entrou com conta).
function updateSeatStatus(entry, status) {
  entry.status.hidden = !status;
  entry.seat.classList.toggle('is-down', Boolean(status && status.hpMax > 0 && status.hp <= 0));
  if (!status) {
    return;
  }
  entry.status.replaceChildren(...[['hp', status.hp, status.hpMax], ['ea', status.ea, status.eaMax]].map(([stat, value, max]) => {
    const row = document.createElement('span');
    const label = document.createElement('b');
    const bar = document.createElement('span');
    const fill = document.createElement('i');
    const numbers = document.createElement('small');
    row.className = 'seat-stat';
    row.dataset.stat = stat;
    label.textContent = t(`stat.${stat}`);
    bar.className = 'seat-stat-bar';
    fill.style.width = `${max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0}%`;
    bar.append(fill);
    numbers.textContent = `${value}/${max}`;
    row.append(label, bar, numbers);
    return row;
  }));
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
  if (roll.hidden) {
    entry.animator.show(null);
    flashSeat(entry);
    onDone();
    return;
  }
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
    const effect = describeEffect(entry, partyState.players || []);
    detail.textContent = `${entry.isPrivate ? `${t('history.private')} · ` : ''}${author ? `${author} · ` : ''}${effect ? `${effect} · ` : ''}${entry.output}`;
    total.className = 'history-total';
    total.textContent = entry.hidden ? '?' : String(entry.total);
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
function recordRoll(localRoll) {
  // Se o servidor já respondeu, usa a versão dele (traz o que foi aplicado na ficha).
  const echo = serverEchoes.get(localRoll.id);
  serverEchoes.delete(localRoll.id);
  const roll = echo ? { ...localRoll, ...echo } : localRoll;
  mergeHistory([roll]);
  historyList.scrollTop = 0;
  const otherRolls = partyState.rolls.filter((entry) => entry.targetPlayerId !== roll.targetPlayerId && entry.id !== roll.id);
  renderPartyTable({ ...partyState, rolls: [...otherRolls, roll] });
}

// Vantagem / desvantagem: troca o primeiro 1d20 da rolagem por 2d20kh1 (fica com o
// maior) ou 2d20kl1 (fica com o menor). Volta para "Normal" depois de cada rolagem.
const advantageGroup = document.querySelector('#roll-advantage');
let advantage = 'none';
function setAdvantage(value) {
  advantage = value;
  for (const button of advantageGroup.querySelectorAll('[data-advantage]')) {
    button.setAttribute('aria-pressed', String(button.dataset.advantage === value));
  }
}
advantageGroup.addEventListener('click', (event) => {
  const button = event.target.closest('[data-advantage]');
  if (button) {
    setAdvantage(button.dataset.advantage === advantage ? 'none' : button.dataset.advantage);
  }
});

function withAdvantage(notation) {
  if (advantage === 'none' || !notation) {
    return notation;
  }
  const changed = notation.replace(/(^|[^\dA-Za-z%])1?d20(?![\d%])(?![a-zA-Z!])/i, `$12d20${advantage}1`);
  return changed === notation ? null : changed;
}

function rollDice(notation, override = null) {
  if (roomManager?.isSpectator()) {
    return;
  }
  const cleanedNotation = withAdvantage(notation.trim());
  if (cleanedNotation === null) {
    showFeedback('advantage.noD20');
    return;
  }
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

  // O que a rolagem faz: o tipo escolhido no rolador vale primeiro; sem escolha, no
  // combate a rolagem conta como o passo da vez (iniciativa, ataque, Reflexos, Medicina).
  let effect = { kind: 'normal' };
  try {
    const chosen = rollKind?.read() || effect;
    effect = override || (chosen.kind !== 'normal' ? chosen : combat?.rollEffect() || chosen);
    if (combat?.needsDamageType() && effect.kind !== 'damage' && effect.kind !== 'recovery') {
      throw new Error('combat.chooseDamage');
    }
  } catch (error) {
    showFeedback(error.message);
    return;
  }
  const rollContext = roomManager?.getRollContext() || { targetPlayerId: '', isPrivate: false };
  if (effect.kind === 'blind') {
    // Teste às cegas: sempre na própria mesa e nunca privado (quem vê é o servidor que decide).
    rollContext.targetPlayerId = partyState.myPlayerId;
    rollContext.isPrivate = false;
  }
  const entry = {
    kind: effect.kind,
    label: effect.label || null,
    recoverStat: effect.recoverStat || null,
    damageType: effect.damageType || null,
    manaCost: effect.manaCost || 0,
    effectTargetId: effect.effectTargetId || null,
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
  rollKind?.reset();
  setAdvantage('none');
  localRollsInFlight.add(entry.id);
  const reportNotSent = (error) => {
    feedbackKey = '';
    feedback.textContent = errorCode(error)
      ? t('roller.notSent', { reason: errorText(error, 'roller.localOnly') })
      : t('roller.localOnly');
  };
  if (effect.hideFromMe) {
    // Às cegas sem ver: o resultado vai só para o mestre; aqui aparece "?".
    roomManager?.shareRoll(entry).catch(reportNotSent);
    showFeedback('blind.sentHidden');
    const masked = { ...entry, notation: effect.label || '?', total: 0, output: '', dice: [], extraDice: 0, hidden: true };
    const seat = seats.get(entry.targetPlayerId);
    if (seat) {
      seat.shownRollId = entry.id;
      showSeatRoll(seat, masked);
      seat.animator.show(null);
    }
    recordRoll(masked);
    return;
  }
  rollButton.classList.add('is-rolling');
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
      // Eco da própria rolagem: traz o que o servidor aplicou (ex.: cura limitada).
      if (history.some((entry) => entry.id === roll.id)) {
        mergeHistory([roll]);
        partyState.rolls = partyState.rolls.map((entry) => (entry.id === roll.id ? { ...entry, ...roll } : entry));
        const seat = seats.get(roll.targetPlayerId);
        if (seat && seat.shownRollId === roll.id && !seat.animator.isPlaying()) {
          showSeatRoll(seat, roll);
        }
      } else {
        serverEchoes.set(roll.id, roll);
      }
      return;
    }
    animateOnSeat(roll, () => recordRoll(roll));
  },
  onRoomHistory: (rolls) => mergeHistory(rolls),
  onRoomState: (room) => renderPartyTable(room),
});
initChat(roomManager);
const sheets = initSheet();
initAccount({
  exportSheets: () => sheets.exportSheets(),
  importSheets: (parsed) => sheets.importSheets(parsed),
});
initNotes(roomManager);
rollKind = initRollKind({ getRoom: () => partyState, getSheet: () => sheets.active() });

combat = initCombat({
  manager: roomManager,
  getRoom: () => partyState,
  getSheet: () => sheets.active(),
  rollNotation: (notation, override = null) => {
    notationInput.value = notation;
    showFeedback();
    rollDice(notation, override);
  },
  selectDamage: (type) => {
    rollKind.select(type);
    showFeedback(type === 'magic' ? 'kind.chooseMana' : 'combat.thenRoll');
    (type === 'magic' ? document.querySelector('#mana-cost') : notationInput).focus();
  },
  seatFor: (playerId) => seats.get(playerId)?.seat || null,
});

// Abas da sala: Mesa (rolagens), Ficha e Notas.
const roomViews = document.querySelector('#room-views');
function selectRoomView(view) {
  workspace.dataset.view = view;
  for (const button of roomViews.querySelectorAll('[data-view]')) {
    button.setAttribute('aria-selected', String(button.dataset.view === view));
  }
  document.querySelector('#sheet-view').hidden = view !== 'sheet';
  document.querySelector('#notes-view').hidden = view !== 'notes';
  document.querySelector('#shield-view').hidden = view !== 'shield';
}
roomViews.addEventListener('click', (event) => {
  const button = event.target.closest('[data-view]');
  if (button) {
    selectRoomView(button.dataset.view);
  }
});
window.addEventListener('room-state', (event) => {
  if (!event.detail?.code) {
    selectRoomView('table');
  }
});
selectRoomView('table');

initShield({ manager: roomManager });
initAmbient();

// Testes às cegas que o mestre pediu: um cartão por pedido, acima do rolador.
const blindBox = document.querySelector('#blind-requests');
let blindRequests = [];
function renderBlindRequests() {
  blindBox.hidden = blindRequests.length === 0;
  blindBox.replaceChildren(...blindRequests.map((request) => {
    const sheet = sheets.active();
    const notation = request.skillId
      ? `1d20${(() => { const value = sheet ? skillTest(sheet, request.skillId) : 0; return value ? (value > 0 ? `+${value}` : String(value)) : ''; })()}`
      : request.notation;
    const card = document.createElement('div');
    const text = document.createElement('p');
    const go = document.createElement('button');
    card.className = 'blind-request';
    text.textContent = t(request.playerSees ? 'blind.request' : 'blind.requestHidden', { label: request.label });
    go.type = 'button';
    go.className = 'room-button room-button-primary';
    go.textContent = t('combat.rollButton', { what: request.label, notation });
    go.addEventListener('click', () => {
      blindRequests = blindRequests.filter((candidate) => candidate.id !== request.id);
      renderBlindRequests();
      notationInput.value = notation;
      rollDice(notation, { kind: 'blind', effectTargetId: request.id, label: request.label, hideFromMe: !request.playerSees });
    });
    card.append(text, go);
    return card;
  }));
}
window.addEventListener('room-blind-requests', (event) => {
  const { requests = [], replace = false } = event.detail || {};
  blindRequests = replace ? [...requests] : [...blindRequests.filter((old) => !requests.some((request) => request.id === old.id)), ...requests];
  renderBlindRequests();
  if (!replace && requests.length) {
    playTurn();
  }
});
window.addEventListener('room-state', (event) => {
  if (!event.detail?.code) {
    blindRequests = [];
    renderBlindRequests();
  }
});
sheets.onChange(renderBlindRequests);

// Rolagens rápidas da ficha ativa, no rolador. A magia espera a EA gasta antes de rolar.
const sheetRollsBlock = document.querySelector('#sheet-rolls-block');
const sheetRolls = document.querySelector('#sheet-rolls');
function renderSheetRolls() {
  const sheet = currentAccount() && partyState.code && !partyState.isSpectator ? sheets.active() : null;
  const rolls = (sheet?.quickRolls || []).filter((roll) => roll.name && roll.notation);
  sheetRollsBlock.hidden = rolls.length === 0;
  sheetRolls.replaceChildren(...rolls.map((roll) => {
    const button = document.createElement('button');
    const label = document.createElement('span');
    const notation = document.createElement('b');
    button.type = 'button';
    button.className = 'quick-chip';
    button.dataset.kind = roll.kind;
    label.textContent = roll.name;
    notation.textContent = roll.notation;
    button.append(label, notation);
    button.title = t(`quick.${roll.kind}`);
    button.addEventListener('click', () => {
      notationInput.value = roll.notation;
      showFeedback();
      const selected = rollKind.select(roll.kind);
      if (selected === 'magic') {
        showFeedback('kind.chooseMana');
        document.querySelector('#mana-cost').focus();
        return;
      }
      rollDice(roll.notation);
    });
    return button;
  }));
}
sheets.onChange(renderSheetRolls);
onAccountChange(renderSheetRolls);
window.addEventListener('room-state', renderSheetRolls);

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
