// Atalhos de rolagem: os três padrões (traduzidos) e os que cada jogador cria,
// como "Espada longa = 1d20+7". Ficam nas configurações (até 12).
import { t } from './i18n.js';
import { getSettings, updateSettings } from './settings.js';

const DEFAULT_SHORTCUTS = [
  { key: 'roller.perception', notation: '1d20+5' },
  { key: 'roller.advantage', notation: '2d20kh1' },
  { key: 'roller.disadvantage', notation: '2d20kl1' },
];
const MAX_SHORTCUTS = 12;

const list = document.querySelector('#quick-options');
const editButton = document.querySelector('#shortcut-edit');
const form = document.querySelector('#shortcut-form');
const nameInput = document.querySelector('#shortcut-name');
const notationInput = document.querySelector('#shortcut-notation');
const feedback = document.querySelector('#roll-feedback');
let editing = false;

function shortcuts() {
  return getSettings().shortcuts ?? DEFAULT_SHORTCUTS;
}

function labelOf(shortcut) {
  return shortcut.key ? t(shortcut.key) : shortcut.name || shortcut.notation;
}

function save(next) {
  updateSettings({ shortcuts: next });
}

function render(hooks) {
  const items = shortcuts();
  list.classList.toggle('is-editing', editing);
  editButton.textContent = t(editing ? 'shortcut.done' : 'shortcut.edit');
  editButton.setAttribute('aria-pressed', String(editing));
  editButton.hidden = items.length === 0 && !editing;
  list.replaceChildren();

  items.forEach((shortcut, index) => {
    const button = document.createElement('button');
    const label = document.createElement('span');
    const notation = document.createElement('b');
    button.type = 'button';
    button.className = 'quick-chip';
    label.textContent = labelOf(shortcut);
    notation.textContent = shortcut.notation;
    button.append(label, notation);
    if (editing) {
      button.classList.add('is-removable');
      button.setAttribute('aria-label', t('shortcut.remove', { name: labelOf(shortcut) }));
      button.addEventListener('click', () => {
        save(items.filter((_, position) => position !== index));
        render(hooks);
      });
    } else {
      button.addEventListener('click', () => hooks.onRoll(shortcut.notation));
    }
    list.append(button);
  });

  // "+" para criar um atalho novo.
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'quick-chip quick-add';
  add.textContent = '+';
  add.setAttribute('aria-label', t('shortcut.add'));
  add.title = t('shortcut.add');
  add.hidden = !form.hidden;
  add.addEventListener('click', () => {
    if (items.length >= MAX_SHORTCUTS) {
      feedback.textContent = t('shortcut.full');
      return;
    }
    form.hidden = false;
    add.hidden = true;
    nameInput.value = '';
    notationInput.value = '';
    nameInput.focus();
  });
  list.append(add);
}

export function initShortcuts(hooks) {
  const closeForm = () => {
    form.hidden = true;
    render(hooks);
  };
  const submit = () => {
    const name = nameInput.value.trim();
    const notation = notationInput.value.trim();
    if (!name || name.length > 24 || !notation || notation.length > 60 || !hooks.isValid(notation)) {
      feedback.textContent = t('shortcut.invalid');
      (name ? notationInput : nameInput).focus();
      return;
    }
    feedback.textContent = '';
    save([...shortcuts(), { name, notation }].slice(0, MAX_SHORTCUTS));
    closeForm();
  };

  editButton.addEventListener('click', () => {
    editing = !editing;
    render(hooks);
  });
  document.querySelector('#shortcut-save').addEventListener('click', submit);
  document.querySelector('#shortcut-cancel').addEventListener('click', closeForm);
  // Enter salva o atalho em vez de rolar os dados do formulário principal.
  for (const input of [nameInput, notationInput]) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      } else if (event.key === 'Escape') {
        closeForm();
      }
    });
  }
  window.addEventListener('languagechange-app', () => render(hooks));
  window.addEventListener('settingschange', () => {
    if (form.hidden) render(hooks);
  });
  render(hooks);
}
