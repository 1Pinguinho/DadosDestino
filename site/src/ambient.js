// Trilha ambiente: sons gerados na hora pelo próprio app (sem arquivos de áudio),
// tocando em ciclo. O mestre escolhe a cena e todos ouvem; cada pessoa tem o próprio
// liga/desliga e volume (configurações). Cenas: chuva, fogueira, vento, taverna, tensão.
import { getSettings } from './settings.js';

export const AMBIENT_SCENES = ['rain', 'fire', 'wind', 'tavern', 'tension'];

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

function ping(ctx, destination, frequency, peak, duration) {
  const oscillator = ctx.createOscillator();
  const envelope = gain(ctx, 0.0001);
  const now = ctx.currentTime;
  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;
  envelope.gain.setValueAtTime(0.0001, now);
  envelope.gain.exponentialRampToValueAtTime(peak, now + 0.005);
  envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(envelope).connect(destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.05);
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
  fire(ctx, bus, nodes, timers) {
    const roar = noise(ctx, 'brown');
    const roarGain = gain(ctx, 0.5);
    roar.connect(filter(ctx, 'lowpass', 520)).connect(roarGain).connect(bus);
    roar.start();
    nodes.push(roar, lfo(ctx, 0.18, 0.18, roarGain.gain));
    every(timers, 50, 420, () => burst(ctx, bus, { frequency: 1800 + Math.random() * 2500, type: 'highpass', peak: 0.1 + Math.random() * 0.35, duration: 0.008 + Math.random() * 0.02 }));
  },
  wind(ctx, bus, nodes) {
    const air = noise(ctx, 'pink');
    const band = filter(ctx, 'bandpass', 600, 0.9);
    const airGain = gain(ctx, 0.5);
    air.connect(band).connect(airGain).connect(bus);
    air.start();
    nodes.push(air, lfo(ctx, 0.07, 380, band.frequency), lfo(ctx, 0.11, 0.3, airGain.gain));
  },
  tavern(ctx, bus, nodes, timers) {
    const crowd = noise(ctx, 'pink');
    const voices = filter(ctx, 'bandpass', 420, 0.8);
    const crowdGain = gain(ctx, 0.32);
    crowd.connect(voices).connect(crowdGain).connect(bus);
    crowd.start();
    nodes.push(crowd, lfo(ctx, 0.35, 0.1, crowdGain.gain), lfo(ctx, 0.23, 120, voices.frequency));
    // Canecas batendo de vez em quando.
    every(timers, 1800, 6000, () => {
      ping(ctx, bus, 2200 + Math.random() * 900, 0.05, 0.25);
      if (Math.random() < 0.5) {
        setTimeout(() => ping(ctx, bus, 2600 + Math.random() * 700, 0.04, 0.2), 70);
      }
    });
  },
  tension(ctx, bus, nodes, timers) {
    const drone = gain(ctx, 0.16);
    const tone = filter(ctx, 'lowpass', 320, 1.2);
    tone.connect(drone).connect(bus);
    for (const [frequency, type] of [[55, 'sawtooth'], [55.6, 'sawtooth'], [82.4, 'sine']]) {
      const oscillator = ctx.createOscillator();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      oscillator.connect(tone);
      oscillator.start();
      nodes.push(oscillator);
    }
    nodes.push(lfo(ctx, 0.05, 140, tone.frequency));
    // Batidas de coração, graves e espaçadas.
    every(timers, 1400, 2200, () => {
      ping(ctx, bus, 58, 0.35, 0.22);
      setTimeout(() => ping(ctx, bus, 52, 0.25, 0.2), 230);
    });
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
