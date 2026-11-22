// Notas da mesa: cartões com título e texto, numa aba separada da mesa de rolagens.
// Quem escreveu edita e apaga a sua; o mestre apaga qualquer uma. Em mesa salva
// (mestre com conta), as notas ficam guardadas até alguém apagar.
import { t, errorText, formatTime } from './i18n.js';
import { currentAccount, onAccountChange } from './account.js';

export function initNotes(manager) {
  const view = document.querySelector('#notes-view');
  const count = document.querySelector('#notes-count');
  let notes = [];
  let room = null;
  let editing = null; // null = fechado; '' = nova; id = editando
  let armed = '';

  view.innerHTML = `
    <div class="view-head">
      <div>
        <p class="chapter" data-i18n="notes.chapter">CADERNO DA MESA</p>
        <h2 id="notes-title" data-i18n="notes.title">Notas</h2>
      </div>
      <button id="note-new" class="room-button room-button-primary" type="button" data-i18n="notes.new">Nova nota</button>
    </div>
    <p id="notes-hint" class="field-hint"></p>
    <form id="note-form" class="note-form" hidden>
      <input id="note-title" type="text" maxlength="60" autocomplete="off" data-i18n-placeholder="notes.titlePlaceholder" data-i18n-aria="notes.titlePlaceholder" />
      <textarea id="note-text" maxlength="2000" rows="6" data-i18n-placeholder="notes.textPlaceholder" data-i18n-aria="notes.textPlaceholder"></textarea>
      <div class="note-form-actions">
        <span id="note-chars" class="note-chars"></span>
        <button id="note-cancel" class="room-button" type="button" data-i18n="shortcut.cancel">Cancelar</button>
        <button class="room-button room-button-primary" type="submit" data-i18n="room.save">Salvar</button>
      </div>
    </form>
    <p id="notes-feedback" class="room-feedback" role="status" aria-live="polite"></p>
    <ul id="notes-list" class="notes-list"></ul>
    <p id="notes-empty" class="notes-empty" data-i18n="notes.empty">Nenhuma nota ainda. Pistas, nomes, combinados: anote aqui.</p>`;

  const form = view.querySelector('#note-form');
  const title = view.querySelector('#note-title');
  const text = view.querySelector('#note-text');
  const chars = view.querySelector('#note-chars');
  const feedback = view.querySelector('#notes-feedback');
  const list = view.querySelector('#notes-list');
  const newButton = view.querySelector('#note-new');

  function translate() {
    for (const element of view.querySelectorAll('[data-i18n]')) {
      element.textContent = t(element.dataset.i18n);
    }
    for (const element of view.querySelectorAll('[data-i18n-placeholder]')) {
      element.placeholder = t(element.dataset.i18nPlaceholder);
    }
    for (const element of view.querySelectorAll('[data-i18n-aria]')) {
      element.setAttribute('aria-label', t(element.dataset.i18nAria));
    }
  }

  function render() {
    const account = currentAccount();
    count.textContent = notes.length ? String(notes.length) : '';
    newButton.disabled = !account;
    const hints = [];
    if (!account) {
      hints.push(t('notes.loginHint'));
    }
    if (room && !room.isSaved) {
      hints.push(t('notes.notSaved'));
    }
    view.querySelector('#notes-hint').textContent = hints.join(' ');
    form.hidden = editing === null;
    list.replaceChildren();
    view.querySelector('#notes-empty').hidden = notes.length > 0;
    for (const note of [...notes].sort((left, right) => right.updatedAt - left.updatedAt)) {
      const item = document.createElement('li');
      const heading = document.createElement('h3');
      const body = document.createElement('p');
      const foot = document.createElement('div');
      const meta = document.createElement('small');
      item.className = 'note-card';
      heading.textContent = note.title;
      body.className = 'note-text';
      body.textContent = note.text;
      foot.className = 'note-foot';
      meta.textContent = `${note.authorName} · ${formatTime(new Date(note.updatedAt))}`;
      foot.append(meta);
      const mine = account && note.authorAccountId === account.id;
      if (mine) {
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'text-button';
        edit.textContent = t('notes.edit');
        edit.addEventListener('click', () => openEditor(note));
        foot.append(edit);
      }
      if (account && (mine || room?.isMaster)) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'text-button note-delete';
        remove.classList.toggle('is-armed', armed === note.id);
        remove.textContent = t(armed === note.id ? 'notes.confirmDelete' : 'notes.delete');
        remove.addEventListener('click', async () => {
          if (armed !== note.id) {
            armed = note.id;
            render();
            return;
          }
          armed = '';
          try {
            await manager.invoke('DeleteNote', note.id);
          } catch (error) {
            feedback.textContent = errorText(error, 'notes.failed');
          }
        });
        foot.append(remove);
      }
      item.append(heading, body, foot);
      list.append(item);
    }
  }

  function openEditor(note) {
    editing = note ? note.id : '';
    title.value = note ? note.title : '';
    text.value = note ? note.text : '';
    feedback.textContent = '';
    updateChars();
    render();
    title.focus();
  }

  function updateChars() {
    chars.textContent = `${text.value.length} / 2000`;
  }

  newButton.addEventListener('click', () => openEditor(null));
  view.querySelector('#note-cancel').addEventListener('click', () => {
    editing = null;
    render();
  });
  text.addEventListener('input', updateChars);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!title.value.trim() || !text.value.trim()) {
      feedback.textContent = t('error.INVALID_NOTE');
      return;
    }
    try {
      const request = { id: editing || null, title: title.value.trim(), text: text.value.trim() };
      await manager.invoke(editing ? 'EditNote' : 'AddNote', request);
      editing = null;
      feedback.textContent = '';
      render();
    } catch (error) {
      feedback.textContent = errorText(error, 'notes.failed');
    }
  });

  window.addEventListener('room-notes', (event) => {
    notes = Array.isArray(event.detail) ? event.detail : [];
    render();
  });
  window.addEventListener('room-state', (event) => {
    const next = event.detail || {};
    if (next.code !== room?.code) {
      notes = [];
      editing = null;
    }
    room = next.code ? next : null;
    render();
  });
  window.addEventListener('languagechange-app', () => {
    translate();
    render();
  });
  onAccountChange(render);
  translate();
  render();
}
