// Aba "Escudo" (só o mestre vê): testes às cegas, chefes prontos e notas secretas.
// As notas secretas ficam com a mesa (salva) e nunca vão para os jogadores.
// Os chefes ficam na conta do mestre e servem para qualquer mesa dele.
import { t, errorText } from './i18n.js';
import { api, currentAccount, onAccountChange } from './account.js';
import { SKILLS } from './sheet.js';
import { STATUS_ICONS } from './combat.js';
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

  async function saveBosses(next, changedId = '') {
    try {
      bosses = await api('/api/account/bosses', { method: 'PUT', body: next });
      bossFeedback = '';
      // Chefe editado que já está no combate: atualiza na mesa (sem mexer na vida e na EA atuais).
      if (changedId && combatActive) {
        await manager.invoke('RefreshBoss', changedId).catch(() => {});
      }
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
            templateId: boss.id,
          });
          bossFeedback = t('shield.bossAdded', { name: boss.name });
        } catch (error) {
          bossFeedback = errorText(error, 'combat.failed');
        }
        render();
      });
      const edit = el('button', { class: 'text-button', type: 'button', text: t('notes.edit') });
      edit.addEventListener('click', () => {
        editing = { ...boss, skills: { ...(boss.skills || {}) }, powers: (boss.powers || []).map((power) => ({ ...power })) };
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
      const combatInfo = [
        boss.weaponName || boss.weaponDamage ? `⚔ ${boss.weaponName || t('boss.weapon')} ${boss.weaponDamage}` : '',
        boss.ea ? `${t('boss.ea')} ${boss.ea}` : '',
        (boss.actions || 1) > 1 ? t('boss.actionsCount', { count: boss.actions }) : '',
        boss.powers?.length ? t('boss.powersCount', { count: boss.powers.length }) : '',
      ].filter(Boolean).join(' · ');
      list.append(el('li', { class: 'boss-card' },
        el('div', { class: 'boss-info' }, el('strong', { text: boss.name }), el('small', { text: stats }), combatInfo ? el('small', { text: combatInfo }) : null, boss.note ? el('p', { text: boss.note }) : null),
        el('div', { class: 'boss-actions' }, put, edit, remove)));
    }
    const add = el('button', { class: 'room-button', type: 'button', text: t('shield.bossNew') });
    add.addEventListener('click', () => {
      editing = { name: '', hp: 100, ea: 0, actions: 1, reflexBonus: 0, resistPhysical: 0, resistMagic: 0, resistPierce: 0, weaponName: '', weaponDamage: 0, weaponType: 'physical', skills: {}, powers: [], note: '' };
      render();
    });
    return section('shield.bossesTitle',
      bosses.length ? list : el('p', { class: 'field-hint', text: t('shield.bossesEmpty') }),
      editing ? bossForm() : add,
      el('p', { class: 'room-feedback', text: bossFeedback }));
  }

  function bossForm() {
    editing.skills ||= {};
    editing.powers ||= [];
    const field = (key, type, value, attributes = {}) => {
      const input = el('input', { type, value: String(value ?? ''), ...attributes });
      return { input, label: el('label', { class: 'sheet-field' }, el('span', { text: t(key) }), input) };
    };
    const choose = (options, value, label) => el('select', { 'aria-label': label },
      ...options.map(([id, text]) => el('option', { value: id, text, selected: id === value })));
    const name = field('combat.bossName', 'text', editing.name, { maxLength: 30 });
    const hp = field('combat.bossHp', 'number', editing.hp, { min: 1, max: 9999 });
    const ea = field('boss.ea', 'number', editing.ea ?? 0, { min: 0, max: 9999 });
    const actions = field('boss.actions', 'number', editing.actions ?? 1, { min: 1, max: 5 });
    const reflex = field('combat.bossReflex', 'number', editing.reflexBonus, { min: -99, max: 99 });
    const physical = field('resist.physical', 'number', editing.resistPhysical, { min: 0, max: 999 });
    const magic = field('resist.magic', 'number', editing.resistMagic, { min: 0, max: 999 });
    const pierce = field('resist.pierce', 'number', editing.resistPierce, { min: 0, max: 999 });
    // Arma principal: o ataque básico do chefe, com dano fixo.
    const weaponName = field('boss.weaponName', 'text', editing.weaponName || '', { maxLength: 30, placeholder: t('boss.weaponPlaceholder') });
    const weaponDamage = field('boss.weaponDamage', 'number', editing.weaponDamage ?? 0, { min: 0, max: 9999 });
    const weaponType = choose(['physical', 'magic', 'pierce'].map((id) => [id, t(`kind.${id}`)]), editing.weaponType || 'physical', t('boss.weaponType'));
    const note = el('textarea', { maxLength: 300, rows: 2, value: editing.note || '', placeholder: t('shield.bossNote'), 'aria-label': t('shield.bossNote') });

    // Perícias do chefe: bônus no teste de ataque (luta, pontaria, magia...) e outros.
    const skillsBox = el('div', { class: 'boss-skills' });
    const drawSkills = () => {
      skillsBox.replaceChildren(...Object.entries(editing.skills).map(([id, value]) => {
        const input = el('input', { type: 'number', min: -99, max: 99, value: String(value), 'aria-label': t(`skill.${id}`) });
        input.addEventListener('input', () => { editing.skills[id] = Number.parseInt(input.value, 10) || 0; });
        const remove = el('button', { class: 'text-button', type: 'button', text: '×', 'aria-label': t('sheet.removeItem') });
        remove.addEventListener('click', () => { delete editing.skills[id]; drawSkills(); });
        return el('span', { class: 'boss-skill' }, el('span', { text: t(`skill.${id}`) }), input, remove);
      }));
      const free = SKILLS.filter(([id]) => !(id in editing.skills));
      if (free.length && Object.keys(editing.skills).length < 12) {
        const add = choose([['', t('boss.addSkill')], ...free.map(([id]) => [id, t(`skill.${id}`)])], '', t('boss.addSkill'));
        add.addEventListener('change', () => {
          if (add.value) {
            editing.skills[add.value] = 0;
            drawSkills();
          }
        });
        skillsBox.append(add);
      }
    };
    drawSkills();

    // Habilidades do chefe: como as dos jogadores, mais o máximo de usos no combate.
    const powersBox = el('div', { class: 'power-list' });
    const drawPowers = () => {
      powersBox.replaceChildren(...editing.powers.map((power, index) => {
        const set = (key, parse = (value) => value) => (event) => { power[key] = parse(event.target.value); };
        const number = (key, min, max, labelKey) => {
          const input = el('input', { type: 'number', min, max, value: String(power[key] ?? 0) });
          input.addEventListener('input', set(key, (value) => Number.parseInt(value, 10) || 0));
          return el('label', { class: 'power-field' }, el('span', { text: t(labelKey) }), input);
        };
        const kind = choose(['physical', 'magic', 'pierce', 'recovery'].map((id) => [id, t(`power.kind.${id}`)]), power.kind, t('power.kind'));
        kind.addEventListener('change', () => { power.kind = kind.value; drawPowers(); });
        const pname = el('input', { type: 'text', maxLength: 30, value: power.name || '', placeholder: t('power.name'), 'aria-label': t('power.name') });
        pname.addEventListener('input', set('name'));
        const notation = el('input', { type: 'text', maxLength: 60, value: power.notation || '', placeholder: '2d8+4', 'aria-label': t('power.notation') });
        notation.addEventListener('input', set('notation', (value) => value.replace(/\s+/g, '')));
        const remove = el('button', { class: 'text-button', type: 'button', text: '×', 'aria-label': t('sheet.removeItem') });
        remove.addEventListener('click', () => { editing.powers.splice(index, 1); drawPowers(); });
        const extra = [number('eaCost', 0, 9999, 'power.ea'), number('usesPerTurn', 0, 10, 'power.uses'),
          number('cooldown', 0, 20, 'power.cooldown'), number('maxUses', 0, 99, 'boss.maxUses')];
        if (power.kind === 'recovery') {
          const stat = choose([['hp', t('kind.hp')], ['ea', t('kind.ea')]], power.recoverStat || 'hp', t('power.recover'));
          stat.addEventListener('change', set('recoverStat'));
          extra.unshift(el('label', { class: 'power-field' }, el('span', { text: t('power.recover') }), stat));
        } else {
          const skill = choose(SKILLS.map(([id]) => [id, t(`skill.${id}`)]), power.skill || 'luta', t('power.skill'));
          skill.addEventListener('change', set('skill'));
          const status = choose([['', t('power.noStatus')], ...Object.keys(STATUS_ICONS).map((id) => [id, `${STATUS_ICONS[id]} ${t(`status.${id}`)}`])],
            power.statusId || '', t('power.status'));
          status.addEventListener('change', set('statusId', (value) => value || null));
          extra.unshift(el('label', { class: 'power-field' }, el('span', { text: t('power.skill') }), skill));
          extra.push(el('label', { class: 'power-field' }, el('span', { text: t('power.status') }), status));
        }
        return el('div', { class: 'power-card', 'data-kind': power.kind },
          el('div', { class: 'power-row' }, pname, kind, notation, remove),
          el('div', { class: 'power-row power-details' }, ...extra));
      }));
    };
    drawPowers();
    const addPower = el('button', { class: 'room-button', type: 'button', text: t('power.add') });
    addPower.addEventListener('click', () => {
      if (editing.powers.length < 12) {
        editing.powers.push({ id: crypto.randomUUID().replaceAll('-', ''), name: '', kind: 'physical', notation: '', skill: 'luta',
          eaCost: 0, usesPerTurn: 0, cooldown: 0, maxUses: 0, statusId: null, recoverStat: 'hp', area: 'single' });
        drawPowers();
      }
    });

    const save = el('button', { class: 'room-button room-button-primary', type: 'submit', text: t('room.save') });
    const cancel = el('button', { class: 'room-button', type: 'button', text: t('shortcut.cancel') });
    cancel.addEventListener('click', () => {
      editing = null;
      render();
    });
    const form = el('form', { class: 'boss-form' },
      el('div', { class: 'boss-form-grid' }, name.label, hp.label, ea.label, actions.label, reflex.label, physical.label, magic.label, pierce.label),
      el('span', { class: 'field-label', text: t('boss.weapon') }),
      el('div', { class: 'boss-form-grid' }, weaponName.label, weaponDamage.label,
        el('label', { class: 'sheet-field' }, el('span', { text: t('boss.weaponType') }), weaponType)),
      el('span', { class: 'field-label', text: t('boss.skills') }), skillsBox,
      el('span', { class: 'field-label', text: t('power.title') }), powersBox, addPower,
      note,
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
        ea: Math.max(0, number(ea.input)),
        actions: Math.min(5, Math.max(1, number(actions.input))),
        weaponName: weaponName.input.value.trim(),
        weaponDamage: Math.max(0, number(weaponDamage.input)),
        weaponType: weaponType.value,
        skills: { ...editing.skills },
        powers: editing.powers.filter((power) => (power.name || '').trim() && (power.notation || '').trim()),
        note: note.value.trim(),
      };
      const next = editing.id ? bosses.map((boss) => (boss.id === editing.id ? updated : boss)) : [...bosses, updated];
      const changedId = editing.id || '';
      editing = null;
      saveBosses(next, changedId);
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
