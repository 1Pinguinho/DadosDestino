// Idiomas da mesa: português do Brasil e inglês. Os textos ficam em src/locales/.
// No HTML, data-i18n="chave" troca o texto; data-i18n-placeholder, data-i18n-aria
// e data-i18n-title trocam o placeholder, o aria-label e o title.
import ptBR from './locales/pt-BR.js';
import en from './locales/en.js';

export const LANGUAGES = ['pt-BR', 'en'];
const dictionaries = { 'pt-BR': ptBR, en };
const storageKey = 'dados-destino-language';

function initialLanguage() {
  try {
    const saved = localStorage.getItem(storageKey);
    if (LANGUAGES.includes(saved)) {
      return saved;
    }
  } catch {
    // Sem armazenamento: usa o idioma do navegador.
  }
  return (navigator.language || '').toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
}

let current = initialLanguage();

export function getLanguage() {
  return current;
}

export function t(key, params = {}) {
  const text = dictionaries[current][key] ?? dictionaries['pt-BR'][key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) => (params[name] ?? '').toString());
}

export function translatePage(root = document) {
  for (const element of root.querySelectorAll('[data-i18n]')) {
    element.textContent = t(element.dataset.i18n);
  }
  for (const element of root.querySelectorAll('[data-i18n-placeholder]')) {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  }
  for (const element of root.querySelectorAll('[data-i18n-aria]')) {
    element.setAttribute('aria-label', t(element.dataset.i18nAria));
  }
  for (const element of root.querySelectorAll('[data-i18n-title]')) {
    element.title = t(element.dataset.i18nTitle);
  }
  document.documentElement.lang = current;
  document.title = t('meta.title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('meta.description'));
}

// Troca o idioma e avisa as partes da página que montam textos sozinhas.
export function setLanguage(language) {
  if (!LANGUAGES.includes(language) || language === current) {
    return false;
  }
  current = language;
  try {
    localStorage.setItem(storageKey, language);
  } catch {
    // Sem armazenamento: vale até fechar.
  }
  translatePage();
  window.dispatchEvent(new CustomEvent('languagechange-app', { detail: language }));
  return true;
}

// Erros do servidor chegam como códigos (ex.: ROOM_FULL), às vezes com o prefixo
// técnico do SignalR ("... HubException: ROOM_FULL").
export function errorCode(error) {
  const message = String(error?.message || error || '');
  const code = message.split('HubException:').pop().trim();
  return /^[A-Z_]+$/.test(code) ? code : '';
}

export function errorText(error, fallbackKey) {
  const code = errorCode(error);
  const key = `error.${code}`;
  return code && dictionaries[current][key] ? t(key) : t(fallbackKey);
}

export function formatTime(date) {
  return new Intl.DateTimeFormat(current, { hour: '2-digit', minute: '2-digit' }).format(date);
}
