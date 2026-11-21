import { DiceRoll } from '/vendor/rpg-dice-roller.mjs?v=5.5.0';
import { createRoomManager } from './rooms.js?v=secure-1';
import { createDiceAnimator } from './dice-animation.js?v=secure-1';

const historyKey = 'dados-destino-history-v1';
const form = document.querySelector('#roll-form');
const notationInput = document.querySelector('#notation');
const quantityInput = document.querySelector('#quantity');
const modifierInput = document.querySelector('#modifier');
const feedback = document.querySelector('#roll-feedback');
const rollVisual = document.querySelector('#roll-visual');
const historyList = document.querySelector('#history-list');
const historyEmpty = document.querySelector('#history-empty');
const clearHistoryButton = document.querySelector('#clear-history');
const dieOptions = [...document.querySelectorAll('.die-option')];
const partySeats = document.querySelector('#party-seats');
const partyTableCount = document.querySelector('#party-table-count');
const rollTarget = document.querySelector('#roll-target');
const clearTableFocus = document.querySelector('#clear-table-focus');
const rollButton = document.querySelector('.roll-button');
const diceAnimator = createDiceAnimator(rollVisual);
let selectedSides = 20;
let pendingSeatHighlight = '';
let lastSeatHighlight = '';
let roomManager;
let focusedPlayerId = '';
let partyState = { code: '', myPlayerId: '', isMaster: false, players: [], rolls: [] };

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

function renderPartyTable(room) {
  if (partyState.code !== room.code) {
    // Ao entrar numa sala, mantém só o histórico salvo dessa sala; ao sair, limpa.
    // Na abertura da página (sem sala ainda) o histórico salvo não é tocado.
    history = room.code ? history.filter((entry) => entry.roomCode === room.code) : [];
    saveHistory();
    renderHistory();
    diceAnimator.cancel();
    rollButton.classList.remove('is-rolling');
    rollVisual.replaceChildren();
    rollVisual.hidden = true;
  }
  partyState = room;
  document.querySelector('.workspace').classList.toggle('in-room', Boolean(room.code));
  const players = Array.isArray(room.players) ? room.players : [];
  const rolls = Array.isArray(room.rolls) ? room.rolls : [];
  if (focusedPlayerId && !players.some((player) => player.id === focusedPlayerId)) {
    focusedPlayerId = '';
  }
  const latestRolls = new Map();
  for (const roll of rolls) {
    if (roll.player) {
      latestRolls.set(roll.targetPlayerId || roll.player, roll);
    }
  }

  const highlightRollId = pendingSeatHighlight;
  pendingSeatHighlight = '';
  partyTableCount.textContent = room.code ? `${players.length} / 8 NA MESA` : 'SUA MESA';
  partySeats.replaceChildren();
  if (players.length === 0) {
    const empty = document.createElement('div');
    const emblem = document.createElement('span');
    const message = document.createElement('span');
    const hint = document.createElement('small');
    empty.className = 'table-empty';
    emblem.className = 'table-emblem';
    emblem.setAttribute('aria-hidden', 'true');
    emblem.textContent = 'D20';
    message.textContent = 'Os lugares aguardam a próxima sessão.';
    hint.textContent = 'Crie uma sala ou entre com um código.';
    empty.append(emblem, message, hint);
    partySeats.append(empty);
    updateTableFocus();
    return;
  }

  players.forEach((player, index) => {
    const seat = document.createElement('article');
    const identity = document.createElement('div');
    const avatar = document.createElement('span');
    const details = document.createElement('span');
    const name = document.createElement('strong');
    const presence = document.createElement('small');
    const lastRoll = latestRolls.get(player.id);
    const dice = document.createElement('div');
    const actions = document.createElement('div');

    seat.className = 'player-seat';
    seat.dataset.playerId = player.id;
    seat.dataset.tone = String(index % 4);
    if (highlightRollId && lastRoll?.id === highlightRollId) {
      seat.classList.add('just-rolled');
    }
    identity.className = 'seat-identity';
    avatar.className = 'seat-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = player.name.trim().slice(0, 1).toUpperCase();
    details.className = 'seat-details';
    name.className = 'seat-name';
    name.textContent = `${player.characterName} (${player.name})`;
    presence.className = 'seat-presence';
    presence.textContent = lastRoll ? 'JOGOU NESTA SESSAO' : 'NA MESA';
    details.append(name, presence);
    identity.append(avatar, details);

    dice.className = `seat-roll${lastRoll ? ' has-roll' : ''}${lastRoll?.isPrivate ? ' is-private' : ''}`;
    if (lastRoll) {
      const notation = document.createElement('span');
      const total = document.createElement('strong');
      notation.className = 'seat-notation';
      notation.textContent = lastRoll.notation;
      total.className = 'seat-total';
      total.textContent = String(lastRoll.total);
      dice.append(notation, total);
      if (lastRoll.isPrivate) {
        const visibility = document.createElement('small');
        visibility.className = 'seat-visibility';
        visibility.textContent = 'PRIVADA';
        dice.append(visibility);
      }
    } else {
      dice.classList.add('is-waiting');
      dice.textContent = 'AGUARDANDO A PRIMEIRA ROLAGEM';
    }

    actions.className = 'seat-actions';
    const focusButton = document.createElement('button');
    focusButton.type = 'button';
    focusButton.className = 'seat-action seat-focus';
    focusButton.textContent = focusedPlayerId === player.id ? 'FOCADA' : 'FOCAR';
    focusButton.setAttribute('aria-pressed', String(focusedPlayerId === player.id));
    focusButton.addEventListener('click', () => {
      focusedPlayerId = focusedPlayerId === player.id ? '' : player.id;
      updateTableFocus();
    });
    actions.append(focusButton);

    if (room.isMaster || player.id === room.myPlayerId) {
      const rollButton = document.createElement('button');
      rollButton.type = 'button';
      rollButton.className = 'seat-action';
      rollButton.textContent = 'ROLAR AQUI';
      rollButton.addEventListener('click', () => {
        rollTarget.value = player.id;
        rollTarget.dispatchEvent(new Event('change'));
        focusedPlayerId = player.id;
        updateTableFocus();
        notationInput.focus();
      });
      actions.append(rollButton);
    }

    seat.append(identity, dice, actions);
    partySeats.append(seat);
  });
  updateTableFocus();
}

// Faz o lugar do jogador piscar uma única vez por rolagem (a rolagem local e
// o eco vindo do servidor têm o mesmo id).
function highlightSeatRoll(rollId) {
  if (rollId && rollId !== lastSeatHighlight) {
    pendingSeatHighlight = rollId;
    lastSeatHighlight = rollId;
  }
}

function updateTableFocus() {
  document.querySelector('.party-table').classList.toggle('has-focus', Boolean(focusedPlayerId));
  for (const seat of partySeats.querySelectorAll('.player-seat')) {
    const focused = seat.dataset.playerId === focusedPlayerId;
    seat.classList.toggle('is-focused', focused);
    const button = seat.querySelector('.seat-focus');
    button?.setAttribute('aria-pressed', String(focused));
    if (button) {
      button.textContent = focused ? 'FOCADA' : 'FOCAR';
    }
  }
}

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
    feedback.textContent = 'O armazenamento local está indisponível.';
  }
}

function renderHistory() {
  historyList.replaceChildren();
  historyEmpty.hidden = history.length > 0;
  clearHistoryButton.disabled = history.length === 0;
  document.querySelector('#history-count').textContent = `${history.length} ${history.length === 1 ? 'REGISTRO' : 'REGISTROS'}`;

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
    repeatButton.setAttribute('aria-label', `Usar novamente ${entry.notation}, resultado ${entry.total}`);
    notation.className = 'history-notation';
    notation.textContent = entry.notation;
    detail.className = 'history-detail';
    const author = rollAuthor(entry);
    detail.textContent = `${entry.isPrivate ? 'PRIVADA · ' : ''}${author ? `${author} · ` : ''}${entry.output}`;
    total.className = 'history-total';
    total.textContent = String(entry.total);
    time.className = 'history-time';
    time.dateTime = date.toISOString();
    time.textContent = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date);

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

// Registra a rolagem depois que a animação revela o total, para o histórico,
// a mesa e os outros jogadores não mostrarem o resultado antes da hora.
function commitRoll(entry) {
  rollButton.classList.remove('is-rolling');
  history = [entry, ...history].slice(0, 20);
  saveHistory();
  renderHistory();
  if (entry.targetPlayerId) {
    const otherRolls = partyState.rolls.filter((rollEntry) => rollEntry.targetPlayerId !== entry.targetPlayerId);
    highlightSeatRoll(entry.id);
    renderPartyTable({ ...partyState, rolls: [...otherRolls, entry] });
  }
  roomManager?.shareRoll(entry).catch((error) => {
    const reason = String(error?.message || '').split('HubException:')[1]?.trim();
    feedback.textContent = reason
      ? `Rolagem não enviada à sala: ${reason}`
      : 'Rolagem local; não foi possível sincronizar com a sala.';
  });
}

function rollDice(notation) {
  const cleanedNotation = notation.trim();
  if (!cleanedNotation) {
    feedback.textContent = 'Digite uma notação para rolar.';
    notationInput.focus();
    return;
  }

  let roll;
  try {
    roll = new DiceRoll(cleanedNotation);
  } catch {
    feedback.textContent = 'Notação inválida. Confira os dados e tente novamente.';
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
  };
  feedback.textContent = '';
  rollButton.classList.add('is-rolling');
  diceAnimator.play(roll, () => commitRoll(entry));
}

function updateNotation() {
  const quantity = Math.min(100, Math.max(1, Number.parseInt(quantityInput.value, 10) || 1));
  const modifier = Math.min(999, Math.max(-999, Number.parseInt(modifierInput.value, 10) || 0));
  quantityInput.value = String(quantity);
  modifierInput.value = String(modifier);
  notationInput.value = `${quantity}d${selectedSides}${modifier > 0 ? `+${modifier}` : modifier < 0 ? modifier : ''}`;
  feedback.textContent = '';
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

document.querySelectorAll('[data-quick]').forEach((button) => {
  button.addEventListener('click', () => {
    notationInput.value = button.dataset.quick;
    feedback.textContent = '';
    rollDice(notationInput.value);
  });
});

// Animações ficam ligadas por padrão, mesmo que o Windows esteja com os efeitos
// de animação desligados; o jogador pode desligá-las no botão.
const motionKey = 'dados-destino-animations';
const motionToggle = document.querySelector('#motion-toggle');

function applyMotionSetting(enabled) {
  document.documentElement.classList.toggle('reduce-motion', !enabled);
  motionToggle.setAttribute('aria-pressed', String(enabled));
  motionToggle.textContent = enabled ? 'ANIMAÇÕES: LIGADAS' : 'ANIMAÇÕES: DESLIGADAS';
}

let motionEnabled = true;
try {
  motionEnabled = localStorage.getItem(motionKey) !== 'off';
} catch {
  motionEnabled = true;
}
applyMotionSetting(motionEnabled);
motionToggle.addEventListener('click', () => {
  motionEnabled = !motionEnabled;
  applyMotionSetting(motionEnabled);
  try {
    localStorage.setItem(motionKey, motionEnabled ? 'on' : 'off');
  } catch {
    // Sem armazenamento: a escolha vale só até fechar.
  }
});

clearHistoryButton.addEventListener('click', () => {
  history = [];
  saveHistory();
  renderHistory();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target === notationInput) {
    event.preventDefault();
    rollDice(notationInput.value);
  }
});

renderHistory();

roomManager = createRoomManager({
  onRoomRoll: (roll) => {
    mergeHistory([roll]);
    highlightSeatRoll(roll.id);
    const otherRolls = partyState.rolls.filter((rollEntry) => rollEntry.targetPlayerId !== roll.targetPlayerId);
    renderPartyTable({ ...partyState, rolls: [...otherRolls, roll] });
  },
  onRoomHistory: (rolls) => mergeHistory(rolls),
  onRoomState: (room) => renderPartyTable(room),
});
renderPartyTable(partyState);