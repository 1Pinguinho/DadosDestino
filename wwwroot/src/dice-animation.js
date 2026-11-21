// Animação das rolagens: os dados caem girando, os números embaralham até
// cada dado parar no valor real e, por fim, o total aparece contando.
const TUMBLE_MS = 820;
const STAGGER_MS = 70;
const MAX_STAGGER_MS = 420;
const MAX_VISIBLE_DICE = 10;
const COUNT_UP_MS = 420;
const FACE_CYCLE_MS = 70;
const SPARK_COUNT = 16;

// O botão "Animações" liga/desliga a classe reduce-motion no <html>.
function isMotionReduced() {
  return document.documentElement.classList.contains('reduce-motion');
}

function shapeOf(sides) {
  if (sides === 'F') {
    return 'fate';
  }
  return [4, 6, 8, 10, 12, 20, 100].includes(sides) ? String(sides) : 'other';
}

function labelOf(sides) {
  if (sides === 'F') {
    return 'DF';
  }
  return sides ? `D${sides}` : 'D?';
}

function faceText(sides, value) {
  if (sides === 'F') {
    return value > 0 ? '+' : value < 0 ? '−' : '0';
  }
  return String(value);
}

function randomFace(sides) {
  if (sides === 'F') {
    return faceText('F', Math.floor(Math.random() * 3) - 1);
  }
  return String(1 + Math.floor(Math.random() * (sides || 20)));
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
// (em 2d20kh1, por exemplo, o dado descartado não conta).
export function extractDice(roll) {
  try {
    const groups = [...roll.notation.matchAll(/(\d*)d(\d+|%|F)/gi)];
    const results = (roll.rolls || []).filter((part) => part && typeof part === 'object' && Array.isArray(part.rolls));
    const dice = [];
    results.forEach((result, index) => {
      const sidesText = groups[index]?.[2]?.toUpperCase();
      const sides = sidesText === '%' ? 100 : sidesText === 'F' ? 'F' : Number(sidesText) || 0;
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
      spark.style.setProperty('--distance', `${Math.round(randomBetween(70, 150))}px`);
      spark.style.setProperty('--spark-delay', `${Math.round(randomBetween(0, 90))}ms`);
      stage.append(spark);
    }
  }

  function play(roll, onReveal) {
    // Uma nova rolagem antes da anterior terminar: conclui a anterior na hora.
    stop(true);
    const dice = extractDice(roll);
    const visible = dice.slice(0, MAX_VISIBLE_DICE);
    const outcome = outcomeOf(dice);
    const reduceMotion = isMotionReduced();
    const state = { timers: [], cycle: 0, onReveal };
    active = state;

    stage.replaceChildren();
    stage.classList.remove('is-crit', 'is-fumble');
    stage.hidden = false;

    const tray = document.createElement('div');
    tray.className = 'roll-dice';
    const dieElements = visible.map((die, index) => {
      const element = document.createElement('span');
      const body = document.createElement('span');
      const face = document.createElement('span');
      const label = document.createElement('small');
      element.className = 'roll-die';
      element.dataset.shape = shapeOf(die.sides);
      element.style.setProperty('--tumble', `${TUMBLE_MS}ms`);
      element.style.setProperty('--delay', `${Math.min(index * STAGGER_MS, MAX_STAGGER_MS)}ms`);
      element.style.setProperty('--spin-x', `${randomSign() * Math.round(randomBetween(540, 900))}deg`);
      element.style.setProperty('--spin-y', `${randomSign() * Math.round(randomBetween(360, 720))}deg`);
      element.style.setProperty('--spin-z', `${randomSign() * Math.round(randomBetween(90, 270))}deg`);
      element.style.setProperty('--drift', `${Math.round(randomBetween(-70, 70))}px`);
      element.style.setProperty('--tilt', `${Math.round(randomBetween(-10, 10))}deg`);
      body.className = 'roll-die-body';
      face.className = 'roll-die-face';
      face.textContent = randomFace(die.sides);
      label.className = 'roll-die-label';
      label.textContent = labelOf(die.sides);
      element.append(body, face, label);
      tray.append(element);
      return element;
    });
    if (dice.length > visible.length) {
      const more = document.createElement('span');
      more.className = 'roll-more';
      more.textContent = `+${dice.length - visible.length}`;
      tray.append(more);
    }

    const totalBox = document.createElement('div');
    const totalLabel = document.createElement('span');
    const totalValue = document.createElement('strong');
    const outcomeLabel = document.createElement('span');
    totalBox.className = 'roll-total';
    totalLabel.className = 'roll-total-label';
    totalLabel.textContent = 'TOTAL';
    totalValue.textContent = '0';
    outcomeLabel.className = 'roll-outcome';
    totalBox.append(totalLabel, totalValue, outcomeLabel);
    stage.append(tray, totalBox);

    const land = (index) => {
      const element = dieElements[index];
      const die = visible[index];
      element.classList.add('is-landed');
      element.querySelector('.roll-die-face').textContent = faceText(die.sides, die.value);
      element.classList.toggle('is-dropped', !die.used);
      element.classList.toggle('is-natural-max', die.sides === 20 && die.used && die.natural === 20);
      element.classList.toggle('is-natural-min', die.sides === 20 && die.used && die.natural === 1);
    };

    const countUp = () => {
      const target = roll.total;
      if (reduceMotion || !Number.isInteger(target)) {
        totalValue.textContent = formatTotal(target);
        return;
      }
      const start = performance.now();
      const step = (now) => {
        const progress = Math.min(1, (now - start) / COUNT_UP_MS);
        const eased = 1 - (1 - progress) ** 3;
        totalValue.textContent = String(Math.round(target * eased));
        if (progress < 1) {
          requestAnimationFrame(step);
        }
      };
      requestAnimationFrame(step);
    };

    const reveal = () => {
      if (active !== state) {
        return;
      }
      clearInterval(state.cycle);
      active = null;
      totalBox.classList.add('is-visible');
      if (outcome) {
        stage.classList.add(outcome === 'crit' ? 'is-crit' : 'is-fumble');
        outcomeLabel.textContent = outcome === 'crit' ? 'ACERTO CRÍTICO!' : 'FALHA CRÍTICA';
        if (outcome === 'crit' && !reduceMotion) {
          spawnSparks();
        }
      }
      countUp();
      onReveal();
    };

    if (reduceMotion) {
      visible.forEach((_, index) => land(index));
      reveal();
      return;
    }

    state.cycle = setInterval(() => {
      dieElements.forEach((element, index) => {
        if (!element.classList.contains('is-landed')) {
          element.querySelector('.roll-die-face').textContent = randomFace(visible[index].sides);
        }
      });
    }, FACE_CYCLE_MS);

    // O dado "toca a mesa" em ~60% da animação de queda; é aí que o valor aparece.
    let lastLanding = 0;
    visible.forEach((_, index) => {
      const landsAt = Math.min(index * STAGGER_MS, MAX_STAGGER_MS) + TUMBLE_MS * 0.62;
      lastLanding = Math.max(lastLanding, landsAt);
      state.timers.push(setTimeout(() => land(index), landsAt));
    });
    state.timers.push(setTimeout(reveal, visible.length ? lastLanding + 260 : 0));
  }

  return {
    play,
    cancel: () => stop(false),
  };
}
