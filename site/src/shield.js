// Aba "Escudo" (só o mestre vê): testes às cegas, chefes prontos e notas secretas.
// As notas secretas ficam com a mesa (salva) e nunca vão para os jogadores.
// Os chefes ficam na conta do mestre e servem para qualquer mesa dele.
import { t, errorText } from './i18n.js';
import { api, currentAccount, onAccountChange } from './account.js';
import { SKILLS } from './sheet.js';
import { AMBIENT_SCENES } from './ambient.js';

function el(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') {
      element.className = value;
    } else if (key === 'text') {
      element.textContent = value;
    } else if (key.startsWith('data-') || key.startsWith('aria-')) {
      element.setAttribute(key, value);
    } else {
      element[key] = value;
    }
  }
  element.append(...children.filter((child) => child !== null && child !== undefined));
  return element;
}

export function initShield({ manager }) {
  const view = document.querySelector('#shield-view');
  const tab = document.querySelector('#shield-tab');
  let room = null;
  let roomCode = '';
  let combatActive = false;
  let bosses = null;
  let editing = null; // chefe sendo editado (ou {} para um novo)
  let armedBoss = '';
  let notesTimer = 0;
  let notesText = '';
  let notesLoaded = false;
  let blindFeedback = '';
  let bossFeedback = '';
  let notesStatus = '';
  let ambientScene = '';
  // O que o mestre já escolheu no teste às cegas (a aba redesenha quando a sala muda).
  const blindChoice = { who: '', test: 'percepcao', notation: '1d20', label: '', sees: false };

  async function loadNotes() {
    notesLoaded = false;
    try {
      notesText = await manager.invoke('GetMasterNotes');
      notesLoaded = true;
    } catch {
      notesText = '';
    }
    render();
  }

  async function loadBosses() {
    if (!currentAccount()) {
      bosses = null;
      render();
      return;
    }
    try {
      bosses = await api('/api/account/bosses');
    } catch {
      bosses = [];
    }
    render();
  }

  async function saveBosses(next) {
    try {
      bosses = await api('/api/account/bosses', { method: 'PUT', body: next });
      bossFeedback = '';
    } catch (error) {
      bossFeedback = errorText(error, 'combat.failed');
    }
    render();
  }

  function section(titleKey, ...content) {
    return el('section', { class: 'shield-card' }, el('h3', { text: t(titleKey) }), ...content);
  }

  // ---------- teste às cegas ----------
  function blindSection() {
    const players = (room?.players || []).filter((player) => player.id !== room.myPlayerId);
    if (players.length === 0) {
      return section('shield.blindTitle', el('p', { class: 'field-hint', text: t('shield.noPlayers') }));
    }
    const who = el('select', { 'aria-label': t('shield.blindWho') },
      ...players.map((player) => el('option', { value: player.id, text: `${player.characterName} (${player.name})`, selected: player.id === blindChoice.who })));
    const test = el('select', { 'aria-label': t('shield.blindTest') },
      ...SKILLS.map(([id]) => el('option', { value: id, text: t(`skill.${id}`), selected: id === blindChoice.test })),
      el('option', { value: '', text: t('shield.otherRoll'), selected: blindChoice.test === '' }));
    const notation = el('input', { type: 'text', maxLength: 60, placeholder: '1d20+2', value: blindChoice.notation, 'aria-label': t('shortcut.notation'), hidden: blindChoice.test !== '' });
    const label = el('input', { type: 'text', maxLength: 40, value: blindChoice.label, placeholder: t('shield.blindLabel'), 'aria-label': t('shield.blindLabel'), hidden: blindChoice.test !== '' });
    const sees = el('input', { type: 'checkbox', id: 'blind-sees', checked: blindChoice.sees });
    const remember = () => {
      Object.assign(blindChoice, { who: who.value, test: test.value, notation: notation.value, label: label.value, sees: sees.checked });
      notation.hidden = test.value !== '';
      label.hidden = test.value !== '';
    };
    for (const control of [who, test, notation, label, sees]) {
      control.addEventListener('change', remember);
      control.addEventListener('input', remember);
    }
    const send = el('button', { class: 'room-button room-button-primary', type: 'button', text: t('shield.blindSend') });
    send.addEventListener('click', async () => {
      const skillId = test.value || null;
      const request = {
        playerId: who.value,
        label: skillId ? t(`skill.${skillId}`) : (label.value.trim() || notation.value.trim()),
        skillId,
        notation: skillId ? null : notation.value.trim(),
        playerSees: sees.checked,
      };
      try {
        await manager.invoke('RequestBlindRoll', request);
        blindFeedback = t('shield.blindSent', { name: who.selectedOptions[0]?.textContent || '' });
      } catch (error) {
        blindFeedback = errorText(error, 'combat.failed');
      }
      const line = view.querySelector('.blind-feedback');
      if (line) {
        line.textContent = blindFeedback;
      }
    });
    return section('shield.blindTitle',
      el('p', { class: 'field-hint', text: t('shield.blindHint') }),
      el('div', { class: 'shield-row' }, who, test, label, notation),
      el('label', { class: 'check-row' }, sees, el('span', {}, el('strong', { text: t('shield.blindSees') }), el('small', { text: t('shield.blindSeesHint') }))),
      el('div', { class: 'shield-row' }, send, el('span', { class: 'blind-feedback room-feedback', text: blindFeedback })));
  }

  // ---------- chefes prontos ----------
  function bossSection() {
    if (!currentAccount()) {
      return section('shield.bossesTitle', el('p', { class: 'field-hint', text: t('shield.bossesLogin') }));
    }
    if (!bosses) {
      return section('shield.bossesTitle', el('p', { class: 'field-hint', text: t('search.loading') }));
    }
    const list = el('ul', { class: 'boss-list' });
    for (const boss of bosses) {
      const put = el('button', { class: 'room-button room-button-primary', type: 'button', text: t('shield.bossToCombat') });
      put.disabled = !combatActive;
      put.title = combatActive ? '' : t('shield.bossNeedsCombat');
      put.addEventListener('click', async () => {
        try {
          await manager.invoke('AddBoss', {
            name: boss.name, hp: boss.hp, reflexBonus: boss.reflexBonus,
            resistPhysical: boss.resistPhysical, resistMagic: boss.resistMagic, resistPierce: boss.resistPierce,
          });
          bossFeedback = t('shield.bossAdded', { name: boss.name });
        } catch (error) {
          bossFeedback = errorText(error, 'combat.failed');
        }
        render();
      });
      const edit = el('button', { class: 'text-button', type: 'button', text: t('notes.edit') });
      edit.addEventListener('click', () => {
        editing = { ...boss };
        render();
      });
      const remove = el('button', { class: `text-button note-delete${armedBoss === boss.id ? ' is-armed' : ''}`, type: 'button', text: t(armedBoss === boss.id ? 'notes.confirmDelete' : 'notes.delete') });
      remove.addEventListener('click', () => {
        if (armedBoss !== boss.id) {
          armedBoss = boss.id;
          render();
          return;
        }
        armedBoss = '';
        saveBosses(bosses.filter((candidate) => candidate.id !== boss.id));
      });
      const stats = `${t('combat.bossHp')} ${boss.hp} · ${t('combat.bossReflex')} ${boss.reflexBonus >= 0 ? '+' : ''}${boss.reflexBonus}`
        + ` · ${t('resist.physical')} ${boss.resistPhysical} · ${t('resist.magic')} ${boss.resistMagic} · ${t('resist.pierce')} ${boss.resistPierce}`;
      list.append(el('li', { class: 'boss-card' },
        el('div', { class: 'boss-info' }, el('strong', { text: boss.name }), el('small', { text: stats }), boss.note ? el('p', { text: boss.note }) : null),
        el('div', { class: 'boss-actions' }, put, edit, remove)));
    }
    const add = el('button', { class: 'room-button', type: 'button', text: t('shield.bossNew') });
    add.addEventListener('click', () => {
      editing = { name: '', hp: 100, reflexBonus: 0, resistPhysical: 0, resistMagic: 0, resistPierce: 0, note: '' };
      render();
    });
    return section('shield.bossesTitle',
      bosses.length ? list : el('p', { class: 'field-hint', text: t('shield.bossesEmpty') }),
      editing ? bossForm() : add,
      el('p', { class: 'room-feedback', text: bossFeedback }));
  }

  function bossForm() {
    const field = (key, type, value, attributes = {}) => {
      const input = el('input', { type, value: String(value ?? ''), ...attributes });
      return { input, label: el('label', { class: 'sheet-field' }, el('span', { text: t(key) }), input) };
    };
    const name = field('combat.bossName', 'text', editing.name, { maxLength: 30 });
    const hp = field('combat.bossHp', 'number', editing.hp, { min: 1, max: 9999 });
    const reflex = field('combat.bossReflex', 'number', editing.reflexBonus, { min: -99, max: 99 });
    const physical = field('resist.physical', 'number', editing.resistPhysical, { min: 0, max: 999 });
    const magic = field('resist.magic', 'number', editing.resistMagic, { min: 0, max: 999 });
    const pierce = field('resist.pierce', 'number', editing.resistPierce, { min: 0, max: 999 });
    const note = el('textarea', { maxLength: 300, rows: 2, value: editing.note || '', placeholder: t('shield.bossNote'), 'aria-label': t('shield.bossNote') });
    const save = el('button', { class: 'room-button room-button-primary', type: 'submit', text: t('room.save') });
    const cancel = el('button', { class: 'room-button', type: 'button', text: t('shortcut.cancel') });
    cancel.addEventListener('click', () => {
      editing = null;
      render();
    });
    const form = el('form', { class: 'boss-form' },
      el('div', { class: 'boss-form-grid' }, name.label, hp.label, reflex.label, physical.label, magic.label, pierce.label), note,
      el('div', { class: 'note-form-actions' }, cancel, save));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!name.input.value.trim()) {
        name.input.focus();
        return;
      }
      const number = (input) => Number.parseInt(input.value, 10) || 0;
      const updated = {
        id: editing.id || '',
        name: name.input.value.trim(),
        hp: Math.max(1, number(hp.input)),
        reflexBonus: number(reflex.input),
        resistPhysical: number(physical.input),
        resistMagic: number(magic.input),
        resistPierce: number(pierce.input),
        note: note.value.trim(),
      };
      const next = editing.id ? bosses.map((boss) => (boss.id === editing.id ? updated : boss)) : [...bosses, updated];
      editing = null;
      saveBosses(next);
    });
    return form;
  }

  // ---------- trilha ambiente ----------
  function ambientSection() {
    const group = el('div', { class: 'segmented ambient-scenes', role: 'group', 'aria-label': t('shield.ambientTitle') });
    for (const value of ['', ...AMBIENT_SCENES]) {
      const option = el('button', { type: 'button', text: t(`ambient.${value || 'silence'}`), 'aria-pressed': String(value === ambientScene) });
      option.addEventListener('click', async () => {
        try {
          await manager.invoke('SetAmbient', value);
        } catch {
          // Sem conexão: fica como estava.
        }
      });
      group.append(option);
    }
    return section('shield.ambientTitle', el('p', { class: 'field-hint', text: t('shield.ambientHint') }), group);
  }

  // ---------- notas secretas ----------
  function notesSection() {
    const area = el('textarea', { class: 'shield-notes', rows: 8, maxLength: 6000, value: notesText, placeholder: t('shield.notesPlaceholder'), 'aria-label': t('shield.notesTitle'), disabled: !notesLoaded });
    const status = el('small', { class: 'sheet-save', text: notesStatus });
    area.addEventListener('input', () => {
      notesText = area.value;
      notesStatus = t('sheet.pending');
      status.textContent = notesStatus;
      clearTimeout(notesTimer);
      notesTimer = setTimeout(async () => {
        try {
          await manager.invoke('SaveMasterNotes', notesText);
          notesStatus = t('sheet.saved');
        } catch {
          notesStatus = t('sheet.saveFailed');
        }
        status.textContent = notesStatus;
      }, 900);
    });
    const hint = room && !room.isSaved ? t('shield.notesNotSaved') : t('shield.notesHint');
    return section('shield.notesTitle', el('p', { class: 'field-hint', text: hint }), area, status);
  }

  function render() {
    const master = Boolean(room?.code && room.isMaster);
    tab.hidden = !master;
    if (!master) {
      view.replaceChildren();
      if (document.querySelector('.workspace')?.dataset.view === 'shield') {
        document.querySelector('[data-view="table"]')?.click();
      }
      return;
    }
    // Não redesenha enquanto o mestre digita nas notas ou no formulário.
    const focused = document.activeElement;
    if (focused && view.contains(focused) && (focused.tagName === 'TEXTAREA' || focused.closest('.boss-form'))) {
      return;
    }
    view.replaceChildren(
      el('div', { class: 'view-head' }, el('div', {},
        el('p', { class: 'chapter', text: t('shield.chapter') }),
        el('h2', { id: 'shield-title', text: t('shield.title') }))),
      blindSection(),
      ambientSection(),
      bossSection(),
      notesSection());
  }

  window.addEventListener('room-state', (event) => {
    const next = event.detail || {};
    const wasMaster = Boolean(room?.isMaster);
    room = next.code ? next : null;
    if (next.code !== roomCode || (room?.isMaster && !wasMaster)) {
      roomCode = next.code || '';
      notesText = '';
      notesStatus = '';
      blindFeedback = '';
      if (room?.isMaster) {
        loadNotes();
        if (bosses === null) {
          loadBosses();
        }
      }
    }
    render();
  });
  window.addEventListener('room-ambient', (event) => {
    ambientScene = event.detail || '';
    render();
  });
  window.addEventListener('room-combat', (event) => {
    combatActive = Boolean(event.detail);
    render();
  });
  onAccountChange(() => {
    bosses = null;
    loadBosses();
  });
  window.addEventListener('languagechange-app', render);
}
