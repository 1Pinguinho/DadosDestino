// Configurações de cada pessoa: tema (e cores personalizadas), zoom, animações,
// som e volume, cor da mesa, cor dos dados e atalhos. Ficam no navegador; dentro do
// app, também em config/preferencias.json (o app confere e devolve ao abrir).
import { LANGUAGES, getLanguage, setLanguage, t, translatePage } from './i18n.js';
import { applyDiceColor } from './dice-animation.js';
import { DICE_STYLES, createDieElement } from './dice-shapes.js';

export { DICE_STYLES };

export const THEMES = ['purple', 'red', 'green', 'blue', 'teal', 'gold', 'pink', 'white', 'gray', 'black', 'custom'];
export const COLORS = ['violet', 'rose', 'amber', 'sky', 'emerald', 'crimson', 'teal', 'gold', 'blue', 'slate'];
const storeKey = 'dados-destino-settings';
const DICE_DEFAULTS = { edge: '#ffd86a', from: '#8e5bd6', to: '#2b1d45' };
const HEX = /^#[0-9a-f]{6}$/i;
const appBridge = window.chrome?.webview;
const palette = window.DadosPalette;

function defaults() {
  return {
    theme: 'purple',
    custom: { ...palette.defaults },
    zoom: 1,
    animations: true,
    fullscreen: false,
    sound: true,
    volume: 20,
    seatColor: null,
    diceColor: 'classic',
    diceCustom: { ...DICE_DEFAULTS },
    diceStyle: 'classic',
    shortcuts: null,
  };
}

function normalize(value) {
  const base = defaults();
  const result = { ...base, ...(value && typeof value === 'object' ? value : {}) };
  result.theme = THEMES.includes(result.theme) ? result.theme : base.theme;
  result.custom = palette.clean(result.custom);
  result.zoom = Number.isFinite(Number(result.zoom)) ? Math.min(1.5, Math.max(0.7, Math.round(Number(result.zoom) * 100) / 100)) : 1;
  result.animations = result.animations !== false;
  result.fullscreen = result.fullscreen === true;
  result.sound = result.sound !== false;
  result.volume = Number.isFinite(Number(result.volume)) ? Math.min(100, Math.max(0, Math.round(Number(result.volume)))) : base.volume;
  result.seatColor = COLORS.includes(result.seatColor) ? result.seatColor : null;
  result.diceColor = ['classic', 'custom'].includes(result.diceColor) || COLORS.includes(result.diceColor) ? result.diceColor : 'classic';
  result.diceStyle = DICE_STYLES.includes(result.diceStyle) ? result.diceStyle : 'classic';
  const dice = result.diceCustom && typeof result.diceCustom === 'object' ? result.diceCustom : {};
  result.diceCustom = Object.fromEntries(Object.entries(DICE_DEFAULTS).map(([key, fallback]) => [key, HEX.test(dice[key] || '') ? dice[key].toLowerCase() : fallback]));
  result.shortcuts = Array.isArray(result.shortcuts) ? result.shortcuts.slice(0, 12) : null;
  return result;
}

function load() {
  try {
    return normalize(JSON.parse(localStorage.getItem(storeKey) || 'null'));
  } catch {
    return normalize(null);
  }
}

let settings = load();

export function getSettings() {
  return settings;
}

// A cor dos dados como vai junto com cada rolagem: um nome da lista, "classic"
// ou "custom:#borda:#inicio:#fim" para os dados personalizados.
export function diceColorValue() {
  if (settings.diceColor !== 'custom') {
    return settings.diceColor;
  }
  const { edge, from, to } = settings.diceCustom;
  return `custom:${edge}:${from}:${to}`;
}

function persist() {
  try {
    localStorage.setItem(storeKey, JSON.stringify(settings));
  } catch {
    // Sem armazenamento: vale até fechar.
  }
}

function tellApp() {
  appBridge?.postMessage({ action: 'settings', settings: { ...settings, language: getLanguage() } });
}

function applyLook() {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  palette.apply(root, settings.theme, settings.custom);
  root.style.zoom = settings.zoom === 1 ? '' : String(settings.zoom);
  root.classList.toggle('reduce-motion', !settings.animations);
  const background = getComputedStyle(root).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', background || '#100e14');
}

// Muda uma ou mais configurações. fromApp: veio do app, não precisa devolver.
export function updateSettings(patch, { fromApp = false } = {}) {
  settings = normalize({ ...settings, ...patch });
  persist();
  applyLook();
  syncControls();
  window.dispatchEvent(new CustomEvent('settingschange', { detail: settings }));
  if (!fromApp) {
    tellApp();
  }
}

// ---------- painel ----------

const toggleButton = document.querySelector('#settings-toggle');
const panel = document.querySelector('#settings-panel');
const themeOptions = document.querySelector('#theme-options');
const customColors = document.querySelector('#custom-colors');
const seatColorOptions = document.querySelector('#seat-color-options');
const diceColorOptions = document.querySelector('#dice-color-options');
const diceCustom = document.querySelector('#dice-custom');
const diceStyleOptions = document.querySelector('#dice-style-options');
const zoomValue = document.querySelector('#zoom-value');
const motionButton = document.querySelector('#motion-toggle');
const fullscreenButton = document.querySelector('#fullscreen-toggle');
const soundButton = document.querySelector('#sound-toggle');
const volumeInput = document.querySelector('#volume');
const volumeValue = document.querySelector('#volume-value');
const resetButton = document.querySelector('#settings-reset');
let resetTimer = 0;
let mySeatColor = null;

function swatch(container, value, kind) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = kind === 'theme' ? 'theme-swatch' : 'color-dot';
  button.dataset.value = value;
  button.dataset.swatch = value;
  container.append(button);
}

function setSwatches(container, selected, labelFor) {
  for (const button of container.querySelectorAll('[data-value]')) {
    const label = labelFor(button.dataset.value);
    button.setAttribute('aria-pressed', String(button.dataset.value === selected));
    button.setAttribute('aria-label', label);
    button.title = label;
  }
}

function syncControls() {
  for (const button of panel.querySelectorAll('[data-language]')) {
    button.setAttribute('aria-pressed', String(button.dataset.language === getLanguage()));
  }
  setSwatches(themeOptions, settings.theme, (value) => t(`theme.${value}`));
  customColors.hidden = settings.theme !== 'custom';
  for (const input of customColors.querySelectorAll('input[type="color"]')) {
    input.value = settings.custom[input.dataset.custom];
  }
  setSwatches(seatColorOptions, settings.seatColor || mySeatColor || 'auto', (value) => t(`color.${value}`));
  setSwatches(diceColorOptions, settings.diceColor, (value) => t(`color.${value}`));
  for (const button of diceStyleOptions.querySelectorAll('[data-value]')) {
    button.setAttribute('aria-pressed', String(button.dataset.value === settings.diceStyle));
    button.querySelector('.dice-style-name').textContent = t(`diceStyle.${button.dataset.value}`);
    applyDiceColor(button.querySelector('.dice-preview'), diceColorValue());
  }
  syncFoldSummaries();
  diceCustom.hidden = settings.diceColor !== 'custom';
  for (const input of diceCustom.querySelectorAll('input[type="color"]')) {
    input.value = settings.diceCustom[input.dataset.dice];
  }
  zoomValue.textContent = `${Math.round(settings.zoom * 100)}%`;
  const fullscreenOn = appBridge ? settings.fullscreen : Boolean(document.fullscreenElement);
  fullscreenButton.setAttribute('aria-pressed', String(fullscreenOn));
  fullscreenButton.textContent = fullscreenOn ? t('settings.on') : t('settings.off');
  motionButton.setAttribute('aria-pressed', String(settings.animations));
  motionButton.textContent = settings.animations ? t('settings.on') : t('settings.off');
  soundButton.setAttribute('aria-pressed', String(settings.sound));
  soundButton.textContent = settings.sound ? t('settings.on') : t('settings.off');
  volumeInput.value = String(settings.volume);
  volumeInput.disabled = !settings.sound;
  volumeValue.textContent = `${settings.volume}%`;
}

// Seções recolhíveis (tema, cor da mesa, modelo e cor dos dados): o título mostra
// a escolha atual, e o painel lembra quais seções ficaram abertas.
const foldsKey = 'dados-destino-folds';

function syncFoldSummaries() {
  const seat = settings.seatColor || mySeatColor || 'auto';
  document.querySelector('#theme-current').textContent = t(`theme.${settings.theme}`);
  document.querySelector('#theme-current-swatch').dataset.swatch = settings.theme;
  document.querySelector('#seat-color-current').textContent = t(`color.${seat}`);
  document.querySelector('#seat-color-current-swatch').dataset.swatch = seat;
  document.querySelector('#dice-style-current').textContent = t(`diceStyle.${settings.diceStyle}`);
  document.querySelector('#dice-color-current').textContent = t(`color.${settings.diceColor}`);
  document.querySelector('#dice-color-current-swatch').dataset.swatch = settings.diceColor;
}

function initFolds() {
  let open = [];
  try {
    open = JSON.parse(localStorage.getItem(foldsKey) || '[]');
  } catch {
    open = [];
  }
  for (const fold of panel.querySelectorAll('.settings-fold')) {
    fold.open = Array.isArray(open) && open.includes(fold.dataset.fold);
    fold.addEventListener('toggle', () => {
      const now = [...panel.querySelectorAll('.settings-fold')].filter((item) => item.open).map((item) => item.dataset.fold);
      try {
        localStorage.setItem(foldsKey, JSON.stringify(now));
      } catch {
        // Sem armazenamento: vale até fechar.
      }
    });
  }
}

// No app: tela cheia sem bordas, salva nas configurações. No navegador: a tela
// cheia do próprio navegador (não fica salva, o navegador exige um clique).
function toggleFullscreen() {
  if (appBridge) {
    updateSettings({ fullscreen: !settings.fullscreen });
    return;
  }
  if (document.fullscreenElement) {
    document.exitFullscreen?.();
  } else {
    document.documentElement.requestFullscreen?.().catch(() => {});
  }
}

function openPanel(open) {
  panel.hidden = !open;
  toggleButton.setAttribute('aria-expanded', String(open));
  if (open) {
    syncControls();
    panel.querySelector('button')?.focus();
  } else {
    disarmReset();
  }
}

function disarmReset() {
  clearTimeout(resetTimer);
  resetButton.classList.remove('is-armed');
  resetButton.textContent = t('settings.reset');
}

export function initSettings() {
  THEMES.forEach((theme) => swatch(themeOptions, theme, 'theme'));
  ['auto', ...COLORS].forEach((color) => swatch(seatColorOptions, color, 'color'));
  ['classic', ...COLORS, 'custom'].forEach((color) => swatch(diceColorOptions, color, 'color'));
  // Modelos de dados: cada botão mostra um d20 parado naquele modelo, já na sua cor.
  DICE_STYLES.forEach((style) => {
    const button = document.createElement('button');
    const preview = document.createElement('span');
    const name = document.createElement('small');
    const { element: die, face } = createDieElement(20, style);
    button.type = 'button';
    button.className = 'dice-style';
    button.dataset.value = style;
    preview.className = 'dice-preview dice-skin';
    preview.dataset.diceStyle = style;
    preview.setAttribute('aria-hidden', 'true');
    die.classList.add('is-landed');
    face.textContent = '20';
    name.className = 'dice-style-name';
    preview.append(die);
    button.append(preview, name);
    diceStyleOptions.append(button);
  });

  initFolds();
  translatePage();
  applyLook();
  syncControls();

  diceStyleOptions.addEventListener('click', (event) => {
    const button = event.target.closest('[data-value]');
    if (button) updateSettings({ diceStyle: button.dataset.value });
  });

  toggleButton.addEventListener('click', (event) => {
    event.stopPropagation();
    openPanel(panel.hidden);
  });
  panel.addEventListener('click', (event) => event.stopPropagation());
  document.addEventListener('click', () => {
    if (!panel.hidden) openPanel(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) {
      openPanel(false);
      toggleButton.focus();
    }
  });
  panel.querySelector('#settings-close').addEventListener('click', () => openPanel(false));

  for (const button of panel.querySelectorAll('[data-language]')) {
    button.addEventListener('click', () => {
      if (setLanguage(button.dataset.language)) {
        tellApp();
      }
      syncControls();
    });
  }
  themeOptions.addEventListener('click', (event) => {
    const button = event.target.closest('[data-value]');
    if (button) updateSettings({ theme: button.dataset.value });
  });
  for (const input of customColors.querySelectorAll('input[type="color"]')) {
    input.addEventListener('input', () => {
      updateSettings({ custom: { ...settings.custom, [input.dataset.custom]: input.value } });
    });
  }
  seatColorOptions.addEventListener('click', (event) => {
    const button = event.target.closest('[data-value]');
    if (!button) return;
    const color = button.dataset.value === 'auto' ? null : button.dataset.value;
    updateSettings({ seatColor: color });
    if (color) {
      window.dispatchEvent(new CustomEvent('seat-color-pick', { detail: color }));
    }
  });
  diceColorOptions.addEventListener('click', (event) => {
    const button = event.target.closest('[data-value]');
    if (button) updateSettings({ diceColor: button.dataset.value });
  });
  for (const input of diceCustom.querySelectorAll('input[type="color"]')) {
    input.addEventListener('input', () => {
      updateSettings({ diceCustom: { ...settings.diceCustom, [input.dataset.dice]: input.value } });
    });
  }
  document.querySelector('#zoom-out').addEventListener('click', () => updateSettings({ zoom: settings.zoom - 0.1 }));
  document.querySelector('#zoom-in').addEventListener('click', () => updateSettings({ zoom: settings.zoom + 0.1 }));
  document.querySelector('#zoom-reset').addEventListener('click', () => updateSettings({ zoom: 1 }));
  motionButton.addEventListener('click', () => updateSettings({ animations: !settings.animations }));
  fullscreenButton.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', syncControls);
  // No app, F11 liga e desliga a tela cheia sem bordas (no navegador, o F11 é do próprio navegador).
  if (appBridge) {
    document.addEventListener('keydown', (event) => {
      if (event.key === 'F11') {
        event.preventDefault();
        toggleFullscreen();
      }
    });
  }
  soundButton.addEventListener('click', () => updateSettings({ sound: !settings.sound }));
  volumeInput.addEventListener('input', () => {
    volumeValue.textContent = `${volumeInput.value}%`;
  });
  volumeInput.addEventListener('change', () => {
    updateSettings({ volume: Number(volumeInput.value) });
    window.dispatchEvent(new CustomEvent('volume-preview'));
  });

  // Restaurar padrões pede um segundo clique para confirmar. Idioma e atalhos ficam.
  resetButton.addEventListener('click', () => {
    if (!resetButton.classList.contains('is-armed')) {
      resetButton.classList.add('is-armed');
      resetButton.textContent = t('settings.resetConfirm');
      resetTimer = setTimeout(disarmReset, 4000);
      return;
    }
    disarmReset();
    updateSettings({ ...defaults(), shortcuts: settings.shortcuts });
  });

  window.addEventListener('languagechange-app', () => {
    disarmReset();
    syncControls();
  });
  // A sala avisa qual cor o servidor deu à mesa desta pessoa.
  window.addEventListener('my-seat-color', (event) => {
    mySeatColor = event.detail || null;
    syncControls();
  });

  // O app manda as configurações salvas nele assim que a página carrega.
  if (appBridge) {
    appBridge.addEventListener('message', (event) => {
      const incoming = event.data?.settings;
      if (!incoming || typeof incoming !== 'object') {
        return;
      }
      if (LANGUAGES.includes(incoming.language)) {
        setLanguage(incoming.language);
      }
      updateSettings(incoming, { fromApp: true });
    });
    appBridge.postMessage({ action: 'getSettings' });
  }
}
