// Visual da mesa de cada jogador: superfície (o "tecido" onde os dados caem), moldura,
// brasão em marca-d'água, efeito de clima e cores próprias. Todos na sala veem a mesa
// de cada um como o dono deixou. Tudo é desenhado em CSS, sem imagens.
import { t } from './i18n.js';
import { SEAT_LOOK, cleanSeatLook, getSettings, updateSettings } from './settings.js';

// "︎" pede a versão de texto (sem emoji colorido), para o brasão pegar a cor da mesa.
export const CRESTS = {
  none: '', swords: '⚔︎', skull: '☠︎', moon: '☾', crown: '♛', star: '✦', sun: '☀︎',
  anchor: '⚓︎', leaf: '❦', cross: '✠', fleur: '⚜︎', knight: '♞', yinyang: '☯︎',
};
const CORNERS = { carved: '◆', runic: 'ᚱ', gold: '✦', thorns: '✠' };
const WEATHER_PARTICLES = 10;

export const PRESETS = {
  tavern: { surface: 'wood', frame: 'carved', crest: 'fleur', weather: 'embers', bg: '#3a2414', accent: '#d9a35b' },
  crypt: { surface: 'stone', frame: 'thorns', crest: 'skull', weather: 'mist', bg: '#1d2326', accent: '#8fa3a8' },
  forest: { surface: 'felt', frame: 'carved', crest: 'leaf', weather: 'petals', bg: '#16301f', accent: '#8fd18a' },
  arcane: { surface: 'starry', frame: 'runic', crest: 'star', weather: 'sparks', bg: '#1b1438', accent: '#a98bff' },
  infernal: { surface: 'stone', frame: 'thorns', crest: 'sun', weather: 'embers', bg: '#3a0f0f', accent: '#ff6a3d' },
  royal: { surface: 'marble', frame: 'gold', crest: 'crown', weather: 'sparks', bg: '#2a2438', accent: '#e8c45a' },
  clear: { surface: 'plain', frame: 'simple', crest: 'none', weather: 'none', bg: null, accent: null },
};

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const channel = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function presetOf(look) {
  return Object.entries(PRESETS).find(([, preset]) => Object.keys(preset).every((key) => preset[key] === look[key]))?.[0] || '';
}

// Aplica o visual num elemento de mesa (a mesa de verdade ou a prévia).
export function applySeatLook(element, rawLook) {
  const look = cleanSeatLook(rawLook);
  const key = JSON.stringify(look);
  if (element.dataset.lookKey === key) {
    return;
  }
  element.dataset.lookKey = key;
  element.dataset.surface = look.surface;
  element.dataset.frame = look.frame;
  element.dataset.weather = look.weather;
  element.style.setProperty('--look-bg', look.bg || '');
  element.style.setProperty('--look-accent', look.accent || '');
  if (!look.bg) {
    element.style.removeProperty('--look-bg');
  }
  // Com fundo próprio, o texto da mesa segue o fundo (claro ou escuro), em qualquer tema.
  element.dataset.tone = look.bg ? (luminance(look.bg) < 0.4 ? 'dark' : 'light') : '';
  if (!look.accent) {
    element.style.removeProperty('--look-accent');
  }

  element.querySelector(':scope > .seat-crest')?.remove();
  element.querySelector(':scope > .seat-corners')?.remove();
  element.querySelector(':scope > .seat-weather')?.remove();

  if (CRESTS[look.crest]) {
    const crest = document.createElement('span');
    crest.className = 'seat-crest';
    crest.setAttribute('aria-hidden', 'true');
    crest.textContent = CRESTS[look.crest];
    element.prepend(crest);
  }
  if (CORNERS[look.frame]) {
    const corners = document.createElement('span');
    corners.className = 'seat-corners';
    corners.setAttribute('aria-hidden', 'true');
    for (const position of ['tl', 'tr', 'bl', 'br']) {
      const corner = document.createElement('i');
      corner.dataset.corner = position;
      corner.textContent = CORNERS[look.frame];
      corners.append(corner);
    }
    element.prepend(corners);
  }
  if (look.weather !== 'none') {
    const weather = document.createElement('span');
    weather.className = 'seat-weather';
    weather.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < WEATHER_PARTICLES; index += 1) {
      const particle = document.createElement('i');
      particle.style.setProperty('--x', `${Math.round(Math.random() * 96) + 2}%`);
      particle.style.setProperty('--y', `${Math.round(Math.random() * 90) + 5}%`);
      particle.style.setProperty('--delay', `${(Math.random() * 6).toFixed(2)}s`);
      particle.style.setProperty('--speed', `${(4 + Math.random() * 5).toFixed(2)}s`);
      particle.style.setProperty('--size', `${(0.6 + Math.random() * 0.9).toFixed(2)}`);
      weather.append(particle);
    }
    element.prepend(weather);
  }
}

// Seção "Visual da sua mesa" nas configurações: prévia, combinações prontas e opções.
export function initSeatLookSettings() {
  const container = document.querySelector('#seat-look');
  const current = document.querySelector('#seat-look-current');

  const chips = (key, labelOf) => {
    const group = document.createElement('div');
    group.className = 'look-chips';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', t(`look.${key}`));
    for (const value of SEAT_LOOK[key]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'look-chip';
      button.dataset.key = key;
      button.dataset.value = value;
      button.textContent = labelOf(value);
      button.title = t(`look.${key}.${value}`);
      group.append(button);
    }
    return group;
  };

  function update(patch) {
    updateSettings({ seatLook: cleanSeatLook({ ...getSettings().seatLook, ...patch }) });
  }

  function build() {
    container.replaceChildren();
    const preview = document.createElement('div');
    preview.className = 'player-seat look-preview';
    const name = document.createElement('strong');
    name.className = 'look-preview-name';
    name.textContent = t('look.preview');
    preview.append(name);

    const presets = document.createElement('div');
    presets.className = 'look-presets';
    for (const id of Object.keys(PRESETS)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'look-preset';
      button.dataset.preset = id;
      button.textContent = t(`look.preset.${id}`);
      button.addEventListener('click', () => updateSettings({ seatLook: { ...PRESETS[id] } }));
      presets.append(button);
    }

    const label = (key) => {
      const element = document.createElement('span');
      element.className = 'field-label';
      element.textContent = t(`look.${key}`);
      return element;
    };
    const colors = document.createElement('div');
    colors.className = 'look-colors';
    const own = document.createElement('input');
    own.type = 'checkbox';
    own.id = 'look-own-colors';
    const ownLabel = document.createElement('label');
    ownLabel.className = 'check-row';
    ownLabel.htmlFor = 'look-own-colors';
    const ownText = document.createElement('span');
    ownText.append(Object.assign(document.createElement('strong'), { textContent: t('look.ownColors') }),
      Object.assign(document.createElement('small'), { textContent: t('look.ownColorsHint') }));
    ownLabel.append(own, ownText);
    const bg = Object.assign(document.createElement('input'), { type: 'color', id: 'look-bg' });
    const accent = Object.assign(document.createElement('input'), { type: 'color', id: 'look-accent' });
    const bgLabel = Object.assign(document.createElement('label'), { className: 'look-color' });
    bgLabel.append(Object.assign(document.createElement('span'), { textContent: t('look.bg') }), bg);
    const accentLabel = Object.assign(document.createElement('label'), { className: 'look-color' });
    accentLabel.append(Object.assign(document.createElement('span'), { textContent: t('look.accent') }), accent);
    colors.append(ownLabel, bgLabel, accentLabel);

    own.addEventListener('change', () => update(own.checked
      ? { bg: getSettings().seatLook.bg || '#2a2140', accent: getSettings().seatLook.accent || '#c9a3ff' }
      : { bg: null, accent: null }));
    bg.addEventListener('input', () => applySeatLook(preview, { ...getSettings().seatLook, bg: bg.value }));
    accent.addEventListener('input', () => applySeatLook(preview, { ...getSettings().seatLook, accent: accent.value }));
    bg.addEventListener('change', () => update({ bg: bg.value }));
    accent.addEventListener('change', () => update({ accent: accent.value }));

    container.append(
      preview,
      label('presets'), presets,
      label('surface'), chips('surface', (value) => t(`look.surface.${value}`)),
      label('frame'), chips('frame', (value) => t(`look.frame.${value}`)),
      label('crest'), chips('crest', (value) => CRESTS[value] || t('look.crest.none')),
      label('weather'), chips('weather', (value) => t(`look.weather.${value}`)),
      colors);
    container.addEventListener('click', (event) => {
      const chip = event.target.closest('.look-chip');
      if (chip) {
        update({ [chip.dataset.key]: chip.dataset.value });
      }
    });
    sync();
  }

  function sync() {
    const look = getSettings().seatLook;
    const preview = container.querySelector('.look-preview');
    if (!preview) {
      return;
    }
    applySeatLook(preview, look);
    for (const chip of container.querySelectorAll('.look-chip')) {
      chip.setAttribute('aria-pressed', String(look[chip.dataset.key] === chip.dataset.value));
    }
    const preset = presetOf(look);
    for (const button of container.querySelectorAll('.look-preset')) {
      button.setAttribute('aria-pressed', String(button.dataset.preset === preset));
    }
    const own = container.querySelector('#look-own-colors');
    own.checked = Boolean(look.bg || look.accent);
    container.querySelector('#look-bg').value = look.bg || '#2a2140';
    container.querySelector('#look-accent').value = look.accent || '#c9a3ff';
    container.querySelector('#look-bg').disabled = !own.checked;
    container.querySelector('#look-accent').disabled = !own.checked;
    current.textContent = t(preset ? `look.preset.${preset}` : 'look.custom');
  }

  window.addEventListener('settingschange', sync);
  window.addEventListener('languagechange-app', build);
  build();
}
