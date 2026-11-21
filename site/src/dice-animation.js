import { t } from './i18n.js';
import { DICE_STYLES, createDieElement } from './dice-shapes.js';

// Animação das rolagens, feita na mesa de quem recebe a rolagem: os dados caem
// girando, os números embaralham até cada dado parar no valor real e, por fim,
// o total aparece contando. Depois, a mesa continua mostrando os dados da última
// rolagem, parados.
const TUMBLE_MS = 820;
const STAGGER_MS = 70;
const MAX_STAGGER_MS = 420;
export const MAX_VISIBLE_DICE = 10;
const COUNT_UP_MS = 420;
const FACE_CYCLE_MS = 70;
const SPARK_COUNT = 14;
const FATE = -1;

// O botão "Animações" (configurações) liga/desliga a classe reduce-motion no <html>.
function isMotionReduced() {
  return document.documentElement.classList.contains('reduce-motion');
}

function faceText(sides, value) {
  if (sides === FATE) {
    return value > 0 ? '+' : value < 0 ? '−' : '0';
  }
  return String(value);
}

function randomFace(sides) {
  if (sides === FATE) {
    return faceText(FATE, Math.floor(Math.random() * 3) - 1);
  }
  return String(1 + Math.floor(Math.random() * (sides > 0 ? sides : 20)));
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function randomSign() {
  return Math.random() < 0.5 ? -1 : 1;
}

function formatTotal(value) {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

// Lista cada dado rolado com o tipo, o valor e se ele conta no total
// (em 2d20kh1, por exemplo, o dado descartado não conta). Dados Fate usam lados = -1.
export function extractDice(roll) {
  try {
    const groups = [...roll.notation.matchAll(/(\d*)d(\d+|%|F)/gi)];
    const results = (roll.rolls || []).filter((part) => part && typeof part === 'object' && Array.isArray(part.rolls));
    const dice = [];
    results.forEach((result, index) => {
      const sidesText = groups[index]?.[2]?.toUpperCase();
      const sides = sidesText === '%' ? 100 : sidesText === 'F' ? FATE : Number(sidesText) || 0;
      for (const die of result.rolls) {
        dice.push({
          sides,
          value: die.value,
          natural: die.initialValue ?? die.value,
          used: die.useInTotal !== false,
        });
      }
    });
    return dice;
  } catch {
    return [];
  }
}

// O que vai junto com a rolagem para a sala: até 10 dados e quantos ficaram de fora.
export function packDice(roll) {
  const dice = extractDice(roll);
  return {
    dice: dice.slice(0, MAX_VISIBLE_DICE),
    extraDice: Math.max(0, dice.length - MAX_VISIBLE_DICE),
  };
}

function cleanDice(list) {
  return (Array.isArray(list) ? list : []).slice(0, MAX_VISIBLE_DICE)
    .filter((die) => die && Number.isFinite(die.sides) && Number.isFinite(die.value))
    .map((die) => ({
      sides: die.sides,
      value: die.value,
      natural: Number.isFinite(die.natural) ? die.natural : die.value,
      used: die.used !== false,
    }));
}

// Jackpot: 3 ou mais dados iguais EM SEQUÊNCIA, na ordem em que aparecem na mesa.
// 4,4,4,6 conta; 4,4,6,4 não. Dado descartado ou Fate no meio quebra a sequência.
// Retorna as posições dos dados que formam a sequência (vazio se não houver).
function jackpotRun(dice) {
  const matches = [];
  let start = 0;
  for (let index = 1; index <= dice.length; index += 1) {
    const current = dice[index];
    const first = dice[start];
    const counts = (die) => die && die.used && die.sides !== FATE;
    if (index < dice.length && counts(current) && counts(first) && current.value === first.value) {
      continue;
    }
    if (counts(first) && index - start >= 3) {
      for (let position = start; position < index; position += 1) {
        matches.push(position);
      }
    }
    start = index;
  }
  return matches;
}

// Total com 3 ou mais dígitos iguais (111, 777, 2222...).
function isRepdigitTotal(total) {
  return Number.isInteger(total) && /^-?(\d)\1{2,}$/.test(String(total));
}

// Jackpot só com dados rolados (com ou sem soma, como 1d20+5); conta pura, como
// 423-523, nunca dá jackpot porque não tem dado.
function outcomeOf(dice, total) {
  if (dice.length > 0 && (jackpotRun(dice).length > 0 || isRepdigitTotal(total))) {
    return 'jackpot';
  }
  const d20s = dice.filter((die) => die.sides === 20 && die.used);
  if (d20s.some((die) => die.natural === 20)) {
    return 'crit';
  }
  if (d20s.some((die) => die.natural === 1)) {
    return 'fumble';
  }
  return '';
}

// Cor dos dados: um nome da lista, "classic" ou "custom:#borda:#inicio:#fim".
const CUSTOM_DICE = /^custom:(#[0-9a-f]{6}):(#[0-9a-f]{6}):(#[0-9a-f]{6})$/i;

function brightness(hex) {
  const value = parseInt(hex.slice(1), 16);
  return (0.299 * (value >> 16) + 0.587 * ((value >> 8) & 255) + 0.114 * (value & 255)) / 255;
}

export function applyDiceColor(stage, diceColor) {
  const custom = CUSTOM_DICE.exec(diceColor || '');
  for (const name of ['--dice-edge', '--dice-from', '--dice-to', '--dice-ink']) {
    stage.style.removeProperty(name);
  }
  if (!custom) {
    stage.dataset.diceColor = diceColor || 'classic';
    return;
  }
  const [, edge, from, to] = custom;
  stage.dataset.diceColor = 'custom';
  stage.style.setProperty('--dice-edge', edge);
  stage.style.setProperty('--dice-from', from);
  stage.style.setProperty('--dice-to', to);
  // Número claro em dado escuro e escuro em dado claro.
  stage.style.setProperty('--dice-ink', (brightness(from) + brightness(to)) / 2 > 0.6 ? '#1b1320' : '#fff8ff');
}

// Um animador por mesa. "roll" é { dice, extraDice, total, diceColor } (como vem da sala).
// hooks.onLand toca quando um dado cai; hooks.onOutcome no crítico ou na falha.
export function createDiceAnimator(stage, hooks = {}) {
  let active = null;

  function stop(commit) {
    if (!active) {
      return;
    }
    const current = active;
    active = null;
    current.timers.forEach(clearTimeout);
    clearInterval(current.cycle);
    if (commit) {
      current.onReveal();
    }
  }

  // Faíscas no crítico; moedas no jackpot.
  function spawnSparks(kind = 'roll-spark') {
    for (let index = 0; index < SPARK_COUNT; index += 1) {
      const spark = document.createElement('span');
      spark.className = kind;
      spark.style.setProperty('--angle', `${Math.round(index * (360 / SPARK_COUNT) + randomBetween(-8, 8))}deg`);
      spark.style.setProperty('--distance', `${Math.round(randomBetween(50, kind === 'roll-coin' ? 140 : 110))}px`);
      spark.style.setProperty('--spark-delay', `${Math.round(randomBetween(0, 90))}ms`);
      stage.append(spark);
    }
  }

  // Monta os dados e o total. Retorna as peças para a animação mexer nelas.
  function build(roll, animated) {
    const dice = cleanDice(roll.dice);
    const extra = Math.max(0, Number(roll.extraDice) || 0);
    stage.replaceChildren();
    stage.classList.remove('is-crit', 'is-fumble', 'is-jackpot');
    stage.classList.toggle('is-static', !animated);
    applyDiceColor(stage, roll.diceColor);
    stage.dataset.diceStyle = DICE_STYLES.includes(roll.diceStyle) ? roll.diceStyle : 'classic';

    const tray = document.createElement('div');
    tray.className = 'roll-dice';
    const dieElements = dice.map((die, index) => {
      const { element, face } = createDieElement(die.sides, stage.dataset.diceStyle);
      if (animated) {
        element.style.setProperty('--tumble', `${TUMBLE_MS}ms`);
        element.style.setProperty('--delay', `${Math.min(index * STAGGER_MS, MAX_STAGGER_MS)}ms`);
        element.style.setProperty('--spin-x', `${randomSign() * Math.round(randomBetween(540, 900))}deg`);
        element.style.setProperty('--spin-y', `${randomSign() * Math.round(randomBetween(360, 720))}deg`);
        element.style.setProperty('--spin-z', `${randomSign() * Math.round(randomBetween(90, 270))}deg`);
        element.style.setProperty('--drift', `${Math.round(randomBetween(-50, 50))}px`);
      }
      element.style.setProperty('--tilt', `${Math.round(randomBetween(-10, 10))}deg`);
      face.textContent = animated ? randomFace(die.sides) : faceText(die.sides, die.value);
      tray.append(element);
      return element;
    });
    if (extra) {
      const more = document.createElement('span');
      more.className = 'roll-more';
      more.textContent = `+${extra}`;
      tray.append(more);
    }

    const totalBox = document.createElement('div');
    const totalLabel = document.createElement('span');
    const totalValue = document.createElement('strong');
    const outcomeLabel = document.createElement('span');
    totalBox.className = 'roll-total';
    totalLabel.className = 'roll-total-label';
    totalLabel.textContent = t('dice.total');
    totalValue.textContent = animated ? '0' : formatTotal(roll.total);
    outcomeLabel.className = 'roll-outcome';
    totalBox.append(totalLabel, totalValue, outcomeLabel);
    stage.append(tray, totalBox);

    const land = (index) => {
      const element = dieElements[index];
      const die = dice[index];
      element.classList.add('is-landed');
      element.querySelector('.roll-die-face').textContent = faceText(die.sides, die.value);
      element.classList.toggle('is-dropped', !die.used);
      element.classList.toggle('is-natural-max', die.sides === 20 && die.used && die.natural === 20);
      element.classList.toggle('is-natural-min', die.sides === 20 && die.used && die.natural === 1);
    };

    const showOutcome = () => {
      const outcome = outcomeOf(dice, roll.total);
      if (outcome) {
        stage.classList.add(`is-${outcome}`);
        outcomeLabel.textContent = t(`dice.${outcome}`);
      }
      if (outcome === 'jackpot') {
        // Os dados iguais pulam um depois do outro.
        jackpotRun(dice).forEach((index, order) => {
          dieElements[index].classList.add('is-match');
          dieElements[index].style.setProperty('--match-delay', `${order * 90}ms`);
        });
      }
      return outcome;
    };

    return { dice, dieElements, totalBox, totalValue, land, showOutcome };
  }

  // Mostra a última rolagem parada (ao abrir a página ou entrar na sala).
  function show(roll) {
    stop(false);
    if (!roll) {
      stage.replaceChildren();
      stage.classList.remove('is-crit', 'is-fumble', 'is-jackpot');
      return;
    }
    const parts = build(roll, false);
    parts.dice.forEach((_, index) => parts.land(index));
    parts.totalBox.classList.add('is-visible');
    parts.showOutcome();
  }

  function play(roll, onReveal) {
    // Uma nova rolagem antes da anterior terminar: conclui a anterior na hora.
    stop(true);
    const reduceMotion = isMotionReduced();
    const state = { timers: [], cycle: 0, onReveal };
    active = state;
    const parts = build(roll, !reduceMotion);

    const countUp = () => {
      const target = roll.total;
      if (reduceMotion || !Number.isInteger(target)) {
        parts.totalValue.textContent = formatTotal(target);
        return;
      }
      const start = performance.now();
      const step = (now) => {
        const progress = Math.min(1, (now - start) / COUNT_UP_MS);
        const eased = 1 - (1 - progress) ** 3;
        parts.totalValue.textContent = String(Math.round(target * eased));
        if (progress < 1) {
          requestAnimationFrame(step);
        }
      };
      requestAnimationFrame(step);
      // Aba em segundo plano não anima: garante o número final mesmo assim.
      setTimeout(() => { parts.totalValue.textContent = formatTotal(target); }, COUNT_UP_MS + 80);
    };

    const reveal = () => {
      if (active !== state) {
        return;
      }
      clearInterval(state.cycle);
      active = null;
      parts.totalBox.classList.add('is-visible');
      const outcome = parts.showOutcome();
      if (outcome === 'crit' && !reduceMotion) {
        spawnSparks();
      } else if (outcome === 'jackpot' && !reduceMotion) {
        spawnSparks('roll-coin');
      }
      if (outcome) {
        hooks.onOutcome?.(outcome);
      }
      countUp();
      onReveal();
    };

    if (reduceMotion) {
      parts.dice.forEach((_, index) => parts.land(index));
      reveal();
      return;
    }

    state.cycle = setInterval(() => {
      parts.dieElements.forEach((element, index) => {
        if (!element.classList.contains('is-landed')) {
          element.querySelector('.roll-die-face').textContent = randomFace(parts.dice[index].sides);
        }
      });
    }, FACE_CYCLE_MS);

    // O dado "toca a mesa" em ~60% da animação de queda; é aí que o valor aparece.
    let lastLanding = 0;
    parts.dice.forEach((_, index) => {
      const landsAt = Math.min(index * STAGGER_MS, MAX_STAGGER_MS) + TUMBLE_MS * 0.62;
      lastLanding = Math.max(lastLanding, landsAt);
      state.timers.push(setTimeout(() => {
        parts.land(index);
        // Som de no máximo 6 dados por rolagem, para não virar barulho.
        if (index < 6) hooks.onLand?.();
      }, landsAt));
    });
    state.timers.push(setTimeout(reveal, parts.dice.length ? lastLanding + 260 : 0));
  }

  return {
    play,
    show,
    isPlaying: () => Boolean(active),
    // Para sem perder a rolagem: o resultado é registrado na hora.
    finish: () => stop(true),
    cancel: () => stop(false),
  };
}
