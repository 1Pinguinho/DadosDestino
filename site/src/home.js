// Tela inicial (fora das salas): Jogar, Fichas, Personalização e Configurações.
// "Jogar" mostra o lobby (criar, entrar com código, procurar e minhas mesas).
// Personalização e Configurações usam as mesmas seções do painel de configurações:
// as seções vêm para a página enquanto ela está aberta e voltam ao painel depois.
import { t } from './i18n.js';

const SCREENS = ['home', 'play', 'sheets', 'look', 'config'];

export function initHome() {
  const workspace = document.querySelector('#inicio');
  const home = document.querySelector('#home');
  const lobby = document.querySelector('#lobby');
  const sheetView = document.querySelector('#sheet-view');
  const page = document.querySelector('#home-page');
  const pageTitle = document.querySelector('#home-page-title');
  const pageBody = document.querySelector('#home-page-body');
  const back = document.querySelector('#screen-back');
  const settingsToggle = document.querySelector('#settings-toggle');
  const accounts = document.querySelector('#home-accounts');
  const accountsList = document.querySelector('#home-accounts-list');
  const bridge = window.chrome?.webview;

  // Lugar de cada seção no painel, para devolver na mesma ordem.
  const sections = [...document.querySelectorAll('#settings-panel .settings-section[data-group]')].map((section) => {
    const marker = document.createComment('settings-section');
    section.before(marker);
    return { section, marker };
  });

  let screen = new URLSearchParams(location.search).get('room') ? 'play' : 'home';
  let inRoom = false;

  function placeSections() {
    const group = screen === 'look' || screen === 'config' ? screen : null;
    for (const { section, marker } of sections) {
      if (group && section.dataset.group === group) {
        pageBody.append(section);
      } else if (section.parentNode !== marker.parentNode) {
        marker.after(section);
      }
    }
  }

  function render() {
    workspace.dataset.screen = inRoom ? '' : screen;
    const active = {
      home, play: lobby, sheets: sheetView, look: page, config: page,
    }[screen];
    for (const element of [home, lobby, sheetView, page, back]) {
      element.classList.toggle('screen-active', !inRoom && (element === active || (element === back && screen !== 'home')));
    }
    if (!inRoom) {
      sheetView.hidden = screen !== 'sheets';
      placeSections();
    }
    pageTitle.textContent = screen === 'look' ? t('home.look') : screen === 'config' ? t('home.config') : '';
    // Nas páginas de Personalização e Configurações a engrenagem do topo não faz falta.
    if (settingsToggle) {
      settingsToggle.hidden = !inRoom && (screen === 'look' || screen === 'config');
    }
    accounts.hidden = !(bridge && !inRoom && screen === 'config' && accountRows.length > 0);
    renderAccounts();
  }

  function go(next) {
    if (SCREENS.includes(next)) {
      screen = next;
      render();
      window.scrollTo({ top: 0 });
    }
  }

  home.addEventListener('click', (event) => {
    const tile = event.target.closest('[data-screen]');
    if (tile) {
      go(tile.dataset.screen);
    }
  });
  back.addEventListener('click', () => go('home'));

  window.addEventListener('room-state', (event) => {
    const now = Boolean(event.detail?.code);
    if (now !== inRoom) {
      // Ao sair de uma sala, volta para o "Jogar".
      if (!now) {
        screen = 'play';
      } else {
        placeSections();
        screen = screen === 'home' ? 'play' : screen;
      }
      inRoom = now;
      if (now) {
        for (const element of [home, lobby, sheetView, page, back]) {
          element.classList.remove('screen-active');
        }
        for (const { section, marker } of sections) {
          marker.after(section);
        }
        if (settingsToggle) {
          settingsToggle.hidden = false;
        }
        workspace.dataset.screen = '';
        sheetView.hidden = workspace.dataset.view !== 'sheet';
        return;
      }
      render();
    }
  });

  // Contas guardadas neste computador (só no app, na mesa deste computador).
  let accountRows = [];
  let armed = '';
  function renderAccounts() {
    accountsList.replaceChildren(...accountRows.map((account) => {
      const item = document.createElement('li');
      item.className = 'room-result';
      const name = document.createElement('strong');
      name.textContent = account.username;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = `room-button room-delete${armed === account.id ? ' is-armed' : ''}`;
      remove.textContent = t(armed === account.id ? 'home.confirmDelete' : 'home.deleteAccount');
      remove.addEventListener('click', () => {
        if (armed !== account.id) {
          armed = account.id;
          renderAccounts();
          return;
        }
        armed = '';
        bridge.postMessage({ action: 'deleteAccount', id: account.id });
      });
      item.append(name, remove);
      return item;
    }));
  }
  if (bridge) {
    bridge.addEventListener('message', (event) => {
      if (event.data && Array.isArray(event.data.accounts)) {
        accountRows = event.data.accounts;
        render();
      }
    });
    bridge.postMessage({ action: 'accounts' });
  }

  window.addEventListener('languagechange-app', render);
  render();

  return { go };
}
