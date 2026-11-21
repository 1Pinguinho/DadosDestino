// Barra de título do app: substitui a do Windows, na cor do tema. Arrasta a janela
// (CSS app-region: drag), e os botões minimizam, maximizam e fecham. Some na tela
// cheia. No navegador comum ela não aparece.
import { t } from './i18n.js';

const appBridge = window.chrome?.webview;
const bar = document.querySelector('#app-titlebar');
const title = document.querySelector('#titlebar-title');
const maximizeButton = bar.querySelector('[data-window="maximize"]');
let windowState = { maximized: false, fullscreen: false };

function render() {
  bar.hidden = windowState.fullscreen;
  document.documentElement.classList.toggle('has-titlebar', !windowState.fullscreen);
  bar.classList.toggle('is-maximized', windowState.maximized);
  const key = windowState.maximized ? 'window.restore' : 'window.maximize';
  maximizeButton.setAttribute('aria-label', t(key));
  maximizeButton.title = t(key);
}

export function initTitlebar() {
  if (!appBridge) {
    return;
  }
  bar.addEventListener('click', (event) => {
    const button = event.target.closest('[data-window]');
    if (button) {
      appBridge.postMessage({ action: 'window', command: button.dataset.window });
    }
  });
  appBridge.addEventListener('message', (event) => {
    if (event.data?.window) {
      windowState = event.data.window;
      render();
    }
  });
  // O nome da sala aparece na barra quando a pessoa está numa sala.
  window.addEventListener('room-state', (event) => {
    title.textContent = event.detail?.name ? `Dados & Destino · ${event.detail.name}` : 'Dados & Destino';
  });
  window.addEventListener('languagechange-app', render);
  appBridge.postMessage({ action: 'getWindow' });
  render();
}
