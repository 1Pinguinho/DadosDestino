// Trilha ambiente, tocando em ciclo. O mestre escolhe a cena e todos ouvem; cada pessoa
// tem o próprio liga/desliga e volume (configurações). Cenas: chuva, chuva com trovões,
// vento e fogueira. Tudo é gerado na hora pelo próprio app, sem arquivos de áudio.
import { getSettings } from './settings.js';

export const AMBIENT_SCENES = ['rain', 'storm', 'wind', 'fire'];

let context = null;
let output = null;
let scene = '';
let playing = null; // { gain, nodes, timers }
let previewLevel = null;

function audio() {
  if (!context) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      return null;
    }
    context = new AudioContext();
    output = context.createGain();
    output.gain.value = level();
    output.connect(context.destination);
  }
  if (context.state === 'suspended') {
    context.resume().catch(() => {});
  }
  return context;
}

// Curva suave, como o som dos dados: 30% no controle soa baixo.
function level() {
  const settings = getSettings();
  const volume = previewLevel ?? settings.ambientVolume;
  return settings.ambient ? (volume / 100) ** 2 * 0.7 : 0;
}

function noise(ctx, color) {
  const length = ctx.sampleRate * 4;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  let b0 = 0, b1 = 0, b2 = 0;
  for (let index = 0; index < length; index += 1) {
    const white = Math.random() * 2 - 1;
    if (color === 'brown') {
      last = (last + 0.02 * white) / 1.02;
      data[index] = last * 3.5;
    } else if (color === 'pink') {
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      data[index] = (b0 + b1 + b2 + white * 0.1848) * 0.2;
    } else {
      data[index] = white;
    }
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  return source;
}

function filter(ctx, type, frequency, q = 0.7) {
  const node = ctx.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  node.Q.value = q;
  return node;
}

function gain(ctx, value) {
  const node = ctx.createGain();
  node.gain.value = value;
  return node;
}

// Oscilador lento que mexe num parâmetro (vento, respiração, murmúrio).
function lfo(ctx, rate, depth, param) {
  const oscillator = ctx.createOscillator();
  const amount = gain(ctx, depth);
  oscillator.frequency.value = rate;
  oscillator.connect(amount).connect(param);
  oscillator.start();
  return oscillator;
}

// Um estalo curto de ruído (gota, brasa).
function burst(ctx, destination, { frequency, type = 'bandpass', q = 1, peak, duration }) {
  const source = ctx.createBufferSource();
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) {
    data[index] = (Math.random() * 2 - 1) * (1 - index / length) ** 2;
  }
  source.buffer = buffer;
  const shape = filter(ctx, type, frequency, q);
  const envelope = gain(ctx, peak);
  source.connect(shape).connect(envelope).connect(destination);
  source.start();
}

// Estalinho da fogueira: um clique de poucos milissegundos com brilho agudo.
function crackle(ctx, destination, peak) {
  const length = Math.max(8, Math.floor(ctx.sampleRate * (0.001 + Math.random() * 0.004)));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) {
    data[index] = (Math.random() * 2 - 1) * Math.exp(-index / (length / 4));
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(filter(ctx, 'bandpass', 2200 + Math.random() * 4500, 2.5)).connect(gain(ctx, peak * 3)).connect(destination);
  source.start();
}

// Trovão: ronco grave de ruído marrom que cresce rápido e some devagar.
function thunder(ctx, destination, peak) {
  const length = Math.floor(ctx.sampleRate * (2.5 + Math.random() * 2));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let index = 0; index < length; index += 1) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    const attack = Math.min(1, index / (ctx.sampleRate * 0.25));
    data[index] = last * 3.5 * attack * (1 - index / length) ** 1.6;
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(filter(ctx, 'lowpass', 180 + Math.random() * 120)).connect(gain(ctx, peak * 2.2)).connect(destination);
  source.start();
}

// Repete uma ação em intervalos aleatórios enquanto a cena toca.
function every(timers, min, max, action) {
  const schedule = () => {
    timers.push(setTimeout(() => {
      action();
      schedule();
    }, min + Math.random() * (max - min)));
  };
  schedule();
}

const BUILDERS = {
  rain(ctx, bus, nodes, timers) {
    const hiss = noise(ctx, 'white');
    hiss.connect(filter(ctx, 'highpass', 900)).connect(filter(ctx, 'lowpass', 6500)).connect(gain(ctx, 0.22)).connect(bus);
    const rumble = noise(ctx, 'pink');
    rumble.connect(filter(ctx, 'lowpass', 420)).connect(gain(ctx, 0.35)).connect(bus);
    hiss.start();
    rumble.start();
    nodes.push(hiss, rumble);
    every(timers, 25, 110, () => burst(ctx, bus, { frequency: 2500 + Math.random() * 3500, q: 2, peak: 0.05 + Math.random() * 0.12, duration: 0.02 }));
  },
  // Chuva com trovões: a mesma chuva e, de tempos em tempos, um estalo e um ronco grave.
  storm(ctx, bus, nodes, timers) {
    BUILDERS.rain(ctx, bus, nodes, timers);
    every(timers, 9000, 22000, () => {
      const near = Math.random() < 0.4;
      if (near) {
        burst(ctx, bus, { frequency: 3000, type: 'highpass', peak: 0.35, duration: 0.12 });
      }
      setTimeout(() => thunder(ctx, bus, near ? 0.9 : 0.55), near ? 120 : 600 + Math.random() * 900);
    });
  },
  // Fogueira: ronco grave que respira de forma irregular, o "sopro" das chamas, um chiado
  // bem baixo, estalinhos que vêm sozinhos ou em rajadas e, de vez em quando, a madeira
  // estalando mais forte.
  fire(ctx, bus, nodes, timers) {
    const roar = noise(ctx, 'brown');
    const roarGain = gain(ctx, 0.42);
    roar.connect(filter(ctx, 'lowpass', 380)).connect(roarGain).connect(bus);
    const flame = noise(ctx, 'pink');
    const flameBand = filter(ctx, 'bandpass', 850, 0.6);
    const flameGain = gain(ctx, 0.1);
    flame.connect(flameBand).connect(flameGain).connect(bus);
    const sizzle = noise(ctx, 'white');
    sizzle.connect(filter(ctx, 'highpass', 5200)).connect(gain(ctx, 0.012)).connect(bus);
    roar.start();
    flame.start();
    sizzle.start();
    nodes.push(roar, flame, sizzle);
    // Tremulação irregular (fogo não pulsa como uma onda certinha).
    every(timers, 120, 420, () => {
      const now = ctx.currentTime;
      roarGain.gain.setTargetAtTime(0.3 + Math.random() * 0.25, now, 0.12);
      flameGain.gain.setTargetAtTime(0.05 + Math.random() * 0.1, now, 0.08);
      flameBand.frequency.setTargetAtTime(650 + Math.random() * 600, now, 0.2);
    });
    // Estalinhos: sozinhos ou em rajadas curtas.
    every(timers, 90, 650, () => {
      const count = Math.random() < 0.3 ? 2 + Math.floor(Math.random() * 5) : 1;
      let delay = 0;
      for (let index = 0; index < count; index += 1) {
        setTimeout(() => crackle(ctx, bus, 0.04 + Math.random() * 0.3), delay);
        delay += 12 + Math.random() * 55;
      }
    });
    // Estalo forte da madeira, seguido de faíscas.
    every(timers, 2500, 8000, () => {
      burst(ctx, bus, { frequency: 900 + Math.random() * 800, q: 1.4, peak: 0.25 + Math.random() * 0.2, duration: 0.04 + Math.random() * 0.05 });
      for (let index = 0; index < 3; index += 1) {
        setTimeout(() => crackle(ctx, bus, 0.08 + Math.random() * 0.15), 40 + index * (20 + Math.random() * 40));
      }
    });
  },
  wind(ctx, bus, nodes) {
    const air = noise(ctx, 'pink');
    const band = filter(ctx, 'bandpass', 600, 0.9);
    const airGain = gain(ctx, 0.5);
    air.connect(band).connect(airGain).connect(bus);
    air.start();
    nodes.push(air, lfo(ctx, 0.07, 380, band.frequency), lfo(ctx, 0.11, 0.3, airGain.gain));
  },
};

function stop(fadeSeconds = 1.2) {
  if (!playing || !context) {
    playing = null;
    return;
  }
  const { gain: bus, nodes, timers } = playing;
  playing = null;
  for (const timer of timers) {
    clearTimeout(timer);
  }
  const now = context.currentTime;
  bus.gain.cancelScheduledValues(now);
  bus.gain.setValueAtTime(bus.gain.value, now);
  bus.gain.linearRampToValueAtTime(0, now + fadeSeconds);
  setTimeout(() => {
    for (const node of nodes) {
      try {
        node.stop?.();
      } catch {
        // Já parado.
      }
    }
    bus.disconnect();
  }, fadeSeconds * 1000 + 100);
}

function start() {
  if (!scene || !getSettings().ambient) {
    return;
  }
  const ctx = audio();
  if (!ctx || ctx.state !== 'running' || playing) {
    return;
  }
  const bus = gain(ctx, 0);
  bus.connect(output);
  const nodes = [];
  const timers = [];
  BUILDERS[scene]?.(ctx, bus, nodes, timers);
  bus.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.5);
  playing = { gain: bus, nodes, timers };
}

export function setAmbientScene(next) {
  const value = AMBIENT_SCENES.includes(next) ? next : '';
  if (value === scene && (playing || !value)) {
    return;
  }
  scene = value;
  stop();
  start();
}

export function currentAmbientScene() {
  return scene;
}

// Para conferir se está tocando (cena, estado do áudio e se há som saindo).
export function ambientState() {
  return { scene, audio: context?.state || 'none', playing: Boolean(playing), level: output ? output.gain.value : 0 };
}

export function initAmbient() {
  // O navegador só libera áudio depois de um clique: começa no primeiro clique.
  window.addEventListener('pointerdown', () => {
    audio();
    setTimeout(start, 50);
  });
  window.addEventListener('room-ambient', (event) => setAmbientScene(event.detail || ''));
  window.addEventListener('room-state', (event) => {
    if (!event.detail?.code) {
      setAmbientScene('');
    }
  });
  window.addEventListener('settingschange', () => {
    previewLevel = null;
    if (output) {
      output.gain.setTargetAtTime(level(), context.currentTime, 0.2);
    }
    if (!getSettings().ambient) {
      stop(0.4);
    } else {
      start();
    }
  });
  window.addEventListener('ambient-volume-preview', (event) => {
    previewLevel = Number(event.detail);
    if (output) {
      output.gain.setTargetAtTime(level(), context.currentTime, 0.1);
    }
    start();
  });
}
