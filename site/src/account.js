// Conta do jogador: entrar, criar conta, foto e sair. A conta fica no computador de
// quem hospeda a mesa. A sessão é um token: com "Lembrar de mim" fica guardado neste
// navegador (90 dias); sem, some ao fechar o navegador.
import { t } from './i18n.js';

const storageKey = 'dados-destino-session';
const listeners = new Set();
let session = readSession();
let account = null;

function readSession() {
  for (const storage of [safeStorage('local'), safeStorage('session')]) {
    try {
      const saved = JSON.parse(storage?.getItem(storageKey) || 'null');
      if (saved && typeof saved.token === 'string' && saved.token.length <= 100) {
        return saved;
      }
    } catch {
      // Guardado estragado: ignora.
    }
  }
  return null;
}

function safeStorage(kind) {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function storeSession(value) {
  for (const kind of ['local', 'session']) {
    try {
      safeStorage(kind)?.removeItem(storageKey);
    } catch {
      // Sem armazenamento: a sessão vale só enquanto a página estiver aberta.
    }
  }
  session = value;
  if (value) {
    try {
      safeStorage(value.remember ? 'local' : 'session')?.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Idem.
    }
  }
}

export function sessionToken() {
  return session?.token || '';
}

export function currentAccount() {
  return account;
}

export function onAccountChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  for (const listener of listeners) {
    listener(account);
  }
}

export function avatarUrl(accountId, version) {
  return accountId && version ? `/api/avatars/${encodeURIComponent(accountId)}?v=${version}` : '';
}

// Chamada à API com o token. Devolve o JSON; erros viram Error com o código do servidor.
export async function api(path, { method = 'GET', body, raw } = {}) {
  const headers = {};
  if (session?.token) {
    headers.Authorization = `Bearer ${session.token}`;
  }
  if (body !== undefined && !raw) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(path, {
    method,
    headers,
    body: raw ? body : body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && session) {
      storeSession(null);
      account = null;
      notify();
    }
    throw new Error(data?.error || 'NETWORK');
  }
  return data;
}

function accountError(error) {
  const key = `account.error.${error?.message}`;
  const text = t(key);
  return text === key ? t('account.error.generic') : text;
}

// Reduz a foto para 128×128 (corta o centro) e converte para webp.
async function shrinkImage(file) {
  const bitmap = await createImageBitmap(file);
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const side = Math.min(bitmap.width, bitmap.height);
  canvas.getContext('2d').drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close?.();
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('INVALID_IMAGE'))), 'image/webp', 0.86));
}

function fillAvatar(element, info) {
  element.replaceChildren();
  const url = info ? avatarUrl(info.id, info.avatarVersion) : '';
  if (url) {
    const image = document.createElement('img');
    image.src = url;
    image.alt = '';
    element.append(image);
  } else {
    element.textContent = info ? info.username.slice(0, 1).toUpperCase() : '';
  }
}

export function initAccount({ exportSheets, importSheets } = {}) {
  const $ = (selector) => document.querySelector(selector);
  const toggle = $('#account-toggle');
  const panel = $('#account-panel');
  const form = $('#account-form');
  const info = $('#account-info');
  const username = $('#account-username');
  const password = $('#account-password');
  const remember = $('#account-remember');
  const submit = $('#account-submit');
  const feedback = $('#account-feedback');
  const modeGroup = $('#account-mode');
  let mode = 'login';

  function say(key) {
    feedback.textContent = key ? t(key) : '';
  }

  function render() {
    const logged = Boolean(account);
    form.hidden = logged;
    info.hidden = !logged;
    $('#account-label').textContent = logged ? account.username : t('account.signIn');
    toggle.classList.toggle('is-logged', logged);
    fillAvatar($('#account-avatar'), account);
    if (logged) {
      $('#account-name').textContent = account.username;
      fillAvatar($('#account-photo'), account);
    }
    submit.textContent = t(mode === 'login' ? 'account.login' : 'account.register');
    password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    for (const button of modeGroup.querySelectorAll('[data-mode]')) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    }
  }

  function open(show) {
    panel.hidden = !show;
    toggle.setAttribute('aria-expanded', String(show));
    if (show) {
      say('');
      (account ? $('#account-photo-change') : username).focus();
    }
  }

  toggle.addEventListener('click', () => open(panel.hidden));
  $('#account-close').addEventListener('click', () => open(false));
  document.addEventListener('click', (event) => {
    if (!panel.hidden && !event.target.closest('.account-anchor')) {
      open(false);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) {
      open(false);
      toggle.focus();
    }
  });

  modeGroup.addEventListener('click', (event) => {
    const button = event.target.closest('[data-mode]');
    if (button) {
      mode = button.dataset.mode;
      say(mode === 'register' ? 'account.passwordRule' : '');
      render();
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    say('account.working');
    try {
      const result = await api(`/api/account/${mode === 'login' ? 'login' : 'register'}`, {
        method: 'POST',
        body: { username: username.value.trim(), password: password.value, remember: remember.checked },
      });
      storeSession({ token: result.token, remember: result.remember });
      account = result.account;
      password.value = '';
      say('');
      render();
      notify();
      open(false);
    } catch (error) {
      feedback.textContent = accountError(error);
    } finally {
      submit.disabled = false;
    }
  });

  $('#account-logout').addEventListener('click', async () => {
    try {
      await api('/api/account/logout', { method: 'POST' });
    } catch {
      // Sai mesmo assim.
    }
    storeSession(null);
    account = null;
    render();
    notify();
    open(false);
  });

  const photoFile = $('#account-photo-file');
  $('#account-photo-change').addEventListener('click', () => photoFile.click());
  photoFile.addEventListener('change', async () => {
    const file = photoFile.files?.[0];
    photoFile.value = '';
    if (!file) {
      return;
    }
    say('account.working');
    try {
      const blob = await shrinkImage(file);
      account = await api('/api/account/avatar', { method: 'POST', body: blob, raw: true });
      say('account.photoSaved');
      render();
      notify();
    } catch (error) {
      feedback.textContent = accountError(error);
    }
  });

  $('#account-export').addEventListener('click', async () => {
    try {
      const document_ = await exportSheets();
      const blob = new Blob([JSON.stringify(document_, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `fichas-${account.username}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 4000);
      say('account.exported');
    } catch (error) {
      feedback.textContent = accountError(error);
    }
  });

  const importFile = $('#account-import-file');
  $('#account-import').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async () => {
    const file = importFile.files?.[0];
    importFile.value = '';
    if (!file) {
      return;
    }
    try {
      if (file.size > 512 * 1024) {
        throw new Error('INVALID_SHEET');
      }
      const parsed = JSON.parse(await file.text());
      const count = await importSheets(parsed);
      feedback.textContent = t('account.imported', { count });
    } catch (error) {
      feedback.textContent = accountError(error instanceof SyntaxError ? new Error('INVALID_SHEET') : error);
    }
  });

  window.addEventListener('languagechange-app', render);
  render();

  // Confere se a sessão guardada ainda vale.
  if (session) {
    api('/api/account/me')
      .then((result) => {
        account = result;
        render();
        notify();
      })
      .catch(() => {
        render();
        notify();
      });
  } else {
    queueMicrotask(notify);
  }
}
