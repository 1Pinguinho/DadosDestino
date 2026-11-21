import { t } from './i18n.js';

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

function shapeOf(sides) {
  if (sides === FATE) {
    return 'fate';
  }
  return [4, 6, 8, 10, 12, 20, 100].includes(sides) ? String(sides) : 'other';
}

function labelOf(sides) {
  if (sides === FATE) {
    return 'DF';
  }
  return sides ? `D${sides}` : 'D?';
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

function outcomeOf(dice) {
  const d20s = dice.filter((die) => die.sides === 20 && die.used);
  if (d20s.some((die) => die.natural === 20)) {
    return 'crit';
  }
  if (d20s.some((die) => die.natural === 1)) {
    return 'fumble';
  }
  return '';
}

// Um animador por mesa. "roll" é { dice, extraDice, total } (como vem da sala).
export function createDiceAnimator(stage) {
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

  function spawnSparks() {
    for (let index = 0; index < SPARK_COUNT; index += 1) {
      const spark = document.createElement('span');
      spark.className = 'roll-spark';
      spark.style.setProperty('--angle', `${Math.round(index * (360 / SPARK_COUNT) + randomBetween(-8, 8))}deg`);
      spark.style.setProperty('--distance', `${Math.round(randomBetween(50, 110))}px`);
      spark.style.setProperty('--spark-delay', `${Math.round(randomBetween(0, 90))}ms`);
      stage.append(spark);
    }
  }

  // Monta os dados e o total. Retorna as peças para a animação mexer nelas.
  function build(roll, animated) {
    const dice = cleanDice(roll.dice);
    const extra = Math.max(0, Number(roll.extraDice) || 0);
    stage.replaceChildren();
    stage.classList.remove('is-crit', 'is-fumble');
    stage.classList.toggle('is-static', !animated);

    const tray = document.createElement('div');
    tray.className = 'roll-dice';
    const dieElements = dice.map((die, index) => {
      const element = document.createElement('span');
      const body = document.createElement('span');
      const face = document.createElement('span');
      const label = document.createElement('small');
      element.className = 'roll-die';
      element.dataset.shape = shapeOf(die.sides);
      if (animated) {
        element.style.setProperty('--tumble', `${TUMBLE_MS}ms`);
        element.style.setProperty('--delay', `${Math.min(index * STAGGER_MS, MAX_STAGGER_MS)}ms`);
        element.style.setProperty('--spin-x', `${randomSign() * Math.round(randomBetween(540, 900))}deg`);
        element.style.setProperty('--spin-y', `${randomSign() * Math.round(randomBetween(360, 720))}deg`);
        element.style.setProperty('--spin-z', `${randomSign() * Math.round(randomBetween(90, 270))}deg`);
        element.style.setProperty('--drift', `${Math.round(randomBetween(-50, 50))}px`);
      }
      element.style.setProperty('--tilt', `${Math.round(randomBetween(-10, 10))}deg`);
      body.className = 'roll-die-body';
      face.className = 'roll-die-face';
      face.textContent = animated ? randomFace(die.sides) : faceText(die.sides, die.value);
      label.className = 'roll-die-label';
      label.textContent = labelOf(die.sides);
      element.append(body, face, label);
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
      const outcome = outcomeOf(dice);
      if (outcome) {
        stage.classList.add(outcome === 'crit' ? 'is-crit' : 'is-fumble');
        outcomeLabel.textContent = t(outcome === 'crit' ? 'dice.crit' : 'dice.fumble');
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
      stage.classList.remove('is-crit', 'is-fumble');
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
      if (parts.showOutcome() === 'crit' && !reduceMotion) {
        spawnSparks();
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
      state.timers.push(setTimeout(() => parts.land(index), landsAt));
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
