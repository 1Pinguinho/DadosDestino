// Som dos dados, gerado na hora (sem arquivos de áudio): um "tec" quando cada dado
// cai, um brilho no acerto crítico e um tom grave na falha crítica.
// Respeita o liga/desliga e o volume das configurações (padrão baixo: 20%).
import { getSettings } from './settings.js';

let context = null;
let noise = null;

function audio() {
  if (!context) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      return null;
    }
    context = new AudioContext();
  }
  if (context.state === 'suspended') {
    context.resume().catch(() => {});
  }
  return context;
}

// O navegador só libera o som depois de um clique; prepara no primeiro clique.
window.addEventListener('pointerdown', () => audio(), { once: true });

function level() {
  const settings = getSettings();
  // Curva suave: 20% no controle soa realmente baixo.
  return settings.sound ? (settings.volume / 100) ** 2 : 0;
}

function noiseBuffer(ctx) {
  if (!noise) {
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.12), ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) {
      data[index] = Math.random() * 2 - 1;
    }
  }
  return noise;
}

function tone(ctx, frequency, start, duration, peak, endFrequency = frequency, type = 'sine') {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

export function playLand() {
  const volume = level();
  const ctx = volume > 0 ? audio() : null;
  if (!ctx || ctx.state !== 'running') {
    return;
  }
  const now = ctx.currentTime;
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  source.buffer = noiseBuffer(ctx);
  source.playbackRate.value = 0.85 + Math.random() * 0.4;
  filter.type = 'bandpass';
  filter.frequency.value = 1600 + Math.random() * 900;
  filter.Q.value = 1.4;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.55 * volume, now + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(now);
  source.stop(now + 0.1);
  tone(ctx, 150 + Math.random() * 40, now, 0.08, 0.35 * volume, 90);
}

export function playOutcome(outcome) {
  const volume = level();
  const ctx = volume > 0 ? audio() : null;
  if (!ctx || ctx.state !== 'running') {
    return;
  }
  const now = ctx.currentTime;
  if (outcome === 'crit') {
    // Sucesso crítico: fanfarra curta subindo (sol, dó, mi, sol) e um brilho no fim.
    [[392, 0], [523, 0.09], [659, 0.18]].forEach(([frequency, delay]) => {
      tone(ctx, frequency, now + delay, 0.16, 0.2 * volume, frequency, 'triangle');
    });
    tone(ctx, 784, now + 0.27, 0.55, 0.24 * volume, 784, 'triangle');
    tone(ctx, 1568, now + 0.27, 0.6, 0.07 * volume);
    tone(ctx, 2349, now + 0.36, 0.5, 0.05 * volume);
  } else if (outcome === 'jackpot') {
    // Arpejo de "máquina caça-níquel" subindo.
    [523, 659, 784, 1047, 1319].forEach((frequency, index) => {
      tone(ctx, frequency, now + index * 0.07, 0.28, 0.16 * volume, frequency, 'triangle');
    });
    tone(ctx, 2093, now + 0.4, 0.5, 0.08 * volume);
  } else if (outcome === 'fumble') {
    // Falha crítica: "trombone triste" descendo, com a última nota caindo devagar.
    [[311, 0], [294, 0.22], [277, 0.44]].forEach(([frequency, delay]) => {
      tone(ctx, frequency, now + delay, 0.2, 0.18 * volume, frequency * 0.97, 'sawtooth');
    });
    tone(ctx, 262, now + 0.66, 0.7, 0.2 * volume, 196, 'sawtooth');
    tone(ctx, 131, now + 0.66, 0.7, 0.12 * volume, 98, 'triangle');
  }
}

// Ao soltar o controle de volume, toca um "tec" para a pessoa ouvir como ficou.
window.addEventListener('volume-preview', () => playLand());

// Combate: dois toques curtos quando chega a sua vez (ou quando você é atacado).
export function playTurn() {
  const volume = level();
  const ctx = volume > 0 ? audio() : null;
  if (!ctx || ctx.state !== 'running') {
    return;
  }
  const now = ctx.currentTime;
  tone(ctx, 660, now, 0.12, 0.14 * volume, 660, 'triangle');
  tone(ctx, 880, now + 0.13, 0.18, 0.14 * volume, 880, 'triangle');
}
