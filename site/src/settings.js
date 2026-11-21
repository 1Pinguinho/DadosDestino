// Painel de configurações (engrenagem no topo): idioma, tema e animações.
// Dentro do app, idioma e tema também ficam salvos no app (config/preferencias.json)
// e valem para a tela inicial e para as mesas de amigos.
import { LANGUAGES, getLanguage, setLanguage, t, translatePage } from './i18n.js';

export const THEMES = ['purple', 'red', 'green', 'white', 'gray', 'black'];
const themeKey = 'dados-destino-theme';
const motionKey = 'dados-destino-animations';
const appBridge = window.chrome?.webview;

const toggleButton = document.querySelector('#settings-toggle');
const panel = document.querySelector('#settings-panel');
const themeOptions = document.querySelector('#theme-options');
const motionButton = document.querySelector('#motion-toggle');

function save(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Sem armazenamento: vale até fechar.
  }
}

function currentTheme() {
  return THEMES.includes(document.documentElement.dataset.theme) ? document.documentElement.dataset.theme : 'purple';
}

function applyTheme(theme) {
  if (!THEMES.includes(theme)) {
    return false;
  }
  const changed = theme !== currentTheme();
  document.documentElement.dataset.theme = theme;
  save(themeKey, theme);
  const background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', background || '#100e14');
  syncControls();
  return changed;
}

function motionEnabled() {
  return !document.documentElement.classList.contains('reduce-motion');
}

function syncControls() {
  for (const button of panel.querySelectorAll('[data-language]')) {
    button.setAttribute('aria-pressed', String(button.dataset.language === getLanguage()));
  }
  for (const button of themeOptions.querySelectorAll('[data-theme-option]')) {
    const selected = button.dataset.themeOption === currentTheme();
    button.setAttribute('aria-pressed', String(selected));
    button.title = t(`theme.${button.dataset.themeOption}`);
    button.setAttribute('aria-label', t(`theme.${button.dataset.themeOption}`));
  }
  motionButton.setAttribute('aria-pressed', String(motionEnabled()));
  motionButton.textContent = motionEnabled() ? t('settings.on') : t('settings.off');
}

function tellApp() {
  appBridge?.postMessage({ action: 'settings', language: getLanguage(), theme: currentTheme() });
}

function openPanel(open) {
  panel.hidden = !open;
  toggleButton.setAttribute('aria-expanded', String(open));
  if (open) {
    syncControls();
    panel.querySelector('button')?.focus();
  }
}

export function initSettings() {
  for (const theme of THEMES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'theme-swatch';
    button.dataset.themeOption = theme;
    button.dataset.swatch = theme;
    themeOptions.append(button);
  }

  translatePage();
  applyTheme(currentTheme());

  toggleButton.addEventListener('click', (event) => {
    event.stopPropagation();
    openPanel(panel.hidden);
  });
  panel.addEventListener('click', (event) => event.stopPropagation());
  document.addEventListener('click', () => openPanel(false));
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
    const button = event.target.closest('[data-theme-option]');
    if (button && applyTheme(button.dataset.themeOption)) {
      tellApp();
    }
  });
  motionButton.addEventListener('click', () => {
    const enabled = !motionEnabled();
    document.documentElement.classList.toggle('reduce-motion', !enabled);
    save(motionKey, enabled ? 'on' : 'off');
    syncControls();
  });
  window.addEventListener('languagechange-app', syncControls);

  // O app manda o idioma e o tema salvos nele assim que a página carrega.
  if (appBridge) {
    appBridge.addEventListener('message', (event) => {
      const settings = event.data?.settings;
      if (!settings) {
        return;
      }
      if (LANGUAGES.includes(settings.language)) {
        setLanguage(settings.language);
      }
      applyTheme(settings.theme);
    });
    appBridge.postMessage({ action: 'getSettings' });
  }
}
