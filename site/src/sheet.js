// Aba "Ficha": as fichas da conta, no formato da ficha do grupo. A ficha não rola
// dados: ela só guarda o personagem (as rolagens rápidas aparecem no rolador).
// Tudo salva sozinho. HP, EA e San atuais vão direto para o servidor, porque também
// mudam pela mesa (poções, magias e, em combate, dano).
import { t } from './i18n.js';
import { api, currentAccount, onAccountChange } from './account.js';
import { STATUS_ICONS } from './combat.js';
import { BUILT_IN_SYSTEMS, shapeDefaults, systemName, systemShape, systemSkillTest } from './systems.js';

export const SKILLS = [
  ['acrobacia', 'agl'], ['crime', 'agl'], ['furtividade', 'agl'], ['pilotagem', 'agl'],
  ['pontaria', 'agl'], ['reflexos', 'agl'], ['luta', 'agl'],
  ['atletismo', 'for'],
  ['atualidades', 'int'], ['magia', 'int'], ['artes', 'int'], ['enganacao', 'int'],
  ['ciencias', 'int'], ['investigacao', 'int'], ['medicina', 'int'], ['sobrevivencia', 'int'],
  ['ferraria', 'int'], ['tecnologia', 'int'], ['armeiro', 'int'],
  ['arcano', 'pre'], ['intimidacao', 'pre'], ['religiao', 'pre'], ['vontade', 'pre'],
  ['intuicao', 'pre'], ['percepcao', 'pre'], ['diplomacia', 'pre'],
  ['fortitude', 'con'],
];
const ATTRIBUTES = ['agl', 'for', 'int', 'pre', 'con'];
const STATS = ['hp', 'ea', 'san'];
const ALL_STATS = ['hp', 'ea', 'san', 'vig'];
// Listas do sistema da ficha (Abismo usa as listas daqui).
const statsOf = (sheet) => systemShape(sheet)?.stats.map(([id]) => id) || STATS;
const attributesOf = (sheet) => systemShape(sheet)?.attributes.map(([id]) => id) || ATTRIBUTES;
const skillsOf = (sheet) => systemShape(sheet)?.skills.map(([id, attribute]) => [id, attribute]) || SKILLS;
const LISTS = ['effects', 'abilities', 'inventory'];
export const QUICK_KINDS = ['test', 'attack', 'physical', 'magic', 'pierce', 'recovery'];
const MAX_SHEETS = 20;

// Teste da perícia, pela conta do sistema da ficha (Abismo: treinado + outros +
// metade do atributo, para baixo).
export function skillTest(sheet, skillId) {
  return systemSkillTest(sheet, skillId, (id) => SKILLS.find(([skill]) => skill === id)?.[1]);
}

function blankSheet(system = 'abismo', template = null) {
  const shaped = shapeDefaults(system, template);
  return {
    id: crypto.randomUUID().replaceAll('-', ''),
    name: '', age: '', level: 1, race: '', class: '', defense: 0,
    hp: { max: 0, current: 0, other: 0 },
    ea: { max: 0, current: 0, other: 0 },
    san: { max: 0, current: 0, other: 0 },
    vig: { max: 0, current: 0, other: 0 },
    attributes: shaped?.attributes || Object.fromEntries(ATTRIBUTES.map((id) => [id, { value: 0, bonus: 0 }])),
    skills: shaped?.skills || Object.fromEntries(SKILLS.map(([id]) => [id, { trained: 0, other: 0 }])),
    resist: { physical: 0, magic: 0, pierce: 0 },
    elements: '', extraElements: '',
    abilityPoints: 0,
    initiative: '',
    system, template: system === 'custom' ? template : null, labels: {},
    effects: [], abilities: [], inventory: [],
    quickRolls: [],
    powers: [],
  };
}

// Mesma ficha do sistema? (personalizado: o mesmo modelo).
export function sameSystem(sheet, system, customId = null) {
  const own = sheet?.system || 'abismo';
  return own === system && (system !== 'custom' || sheet.template?.id === customId);
}

// Nome que aparece na ficha: o que o jogador escolheu ou o padrão do sistema e idioma.
export function sheetLabel(sheet, key) {
  if (sheet?.labels?.[key]) {
    return sheet.labels[key];
  }
  const shape = systemShape(sheet);
  if (shape) {
    const [kind, id] = key.split('.');
    const found = kind === 'skill' ? shape.skills.find(([skill]) => skill === id)?.[2]
      : kind === 'attr' ? shape.attributes.find(([attribute]) => attribute === id)?.[1]
        : kind === 'stat' ? shape.stats.find(([stat]) => stat === id)?.[1] : null;
    if (found) {
      return found;
    }
  }
  return t(key);
}

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

export function initSheet() {
  const view = document.querySelector('#sheet-view');
  const listeners = new Set();
  let documentState = null; // { version, activeId, sheets }
  let loading = false;
  let saveTimer = 0;
  let saving = false;
  let pendingSave = false;
  let armedDelete = false;
  let renaming = false;
  let roomSystem = null; // { system, custom } da mesa atual (null fora de mesa)
  let customSystems = []; // sistemas personalizados da conta
  let newSystem = 'abismo';
  let myPlayer = null;
  let roomPlayers = [];
  let statusLine = null;

  const active = () => documentState?.sheets.find((sheet) => sheet.id === documentState.activeId) || null;

  function emit() {
    for (const listener of listeners) {
      listener(active());
    }
  }

  async function load() {
    if (!currentAccount()) {
      documentState = null;
      render();
      emit();
      return;
    }
    loading = true;
    render();
    try {
      documentState = await api('/api/account/sheets');
    } catch {
      documentState = { version: 0, activeId: null, sheets: [] };
    }
    customSystems = await api('/api/account/systems').catch(() => []);
    followRoomSystem();
    loading = false;
    render();
    emit();
  }

  function setStatus(key) {
    if (statusLine) {
      statusLine.textContent = key ? t(key) : '';
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    setStatus('sheet.pending');
    saveTimer = setTimeout(save, 800);
    emit();
  }

  // Espera o que estiver salvando e salva o estado atual (antes de mudar HP/EA/San
  // atuais, o máximo novo precisa já estar no servidor).
  async function flush() {
    clearTimeout(saveTimer);
    while (saving) {
      await currentSave;
    }
    await save();
  }

  let currentSave = Promise.resolve();
  function save() {
    if (saving) {
      pendingSave = true;
      return currentSave;
    }
    currentSave = saveNow();
    return currentSave;
  }

  async function saveNow() {
    if (!documentState) {
      return;
    }
    saving = true;
    setStatus('sheet.saving');
    try {
      const saved = await api('/api/account/sheets', { method: 'PUT', body: documentState });
      // Mantém o que foi digitado enquanto salvava; atualiza só os valores atuais vindos do servidor.
      for (const sheet of documentState.sheets) {
        const server = saved.sheets.find((candidate) => candidate.id === sheet.id);
        if (server) {
          for (const stat of ALL_STATS) {
            if (sheet[stat] && server[stat]) {
              sheet[stat].current = server[stat].current;
            }
          }
        }
      }
      documentState.version = saved.version;
      setStatus('sheet.saved');
      refreshComputed();
    } catch {
      setStatus('sheet.saveFailed');
    } finally {
      saving = false;
    }
    if (pendingSave) {
      pendingSave = false;
      await saveNow();
    }
  }

  async function setCurrent(stat, value) {
    const sheet = active();
    if (!sheet) {
      return;
    }
    setStatus('sheet.saving');
    try {
      await flush();
      const saved = await api('/api/account/status', { method: 'POST', body: { sheetId: sheet.id, stat, value } });
      const server = saved.sheets.find((candidate) => candidate.id === sheet.id);
      if (server) {
        sheet[stat].current = server[stat].current;
      }
      setStatus('sheet.saved');
    } catch {
      setStatus('sheet.saveFailed');
    }
    refreshComputed();
    emit();
  }

  // ---------- desenho ----------

  function numberInput(value, onChange, { min = -9999, max = 9999, label = '', commit = 'input' } = {}) {
    const input = el('input', { type: 'number', min, max, value: String(value ?? 0), inputMode: 'numeric', 'aria-label': label });
    // Campo vazio (ou só "-") conta como 0.
    input.addEventListener(commit, () => {
      const parsed = Number.parseInt(input.value, 10);
      onChange(Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : 0)));
    });
    return input;
  }

  // Nome de um campo. No modo "Renomear" vira uma caixa de texto (vazia = nome padrão).
  function labelNode(sheet, key, tag = 'span', className = '') {
    if (!renaming) {
      return el(tag, { class: className, text: sheetLabel(sheet, key) });
    }
    const input = el('input', {
      type: 'text', class: `label-edit ${className}`.trim(), maxLength: 30, value: sheet.labels?.[key] || '',
      placeholder: t(key), autocomplete: 'off', 'aria-label': `${t('sheet.renameField')}: ${t(key)}`,
    });
    input.addEventListener('input', () => {
      sheet.labels ||= {};
      const value = input.value.trim();
      if (value) {
        sheet.labels[key] = value;
      } else {
        delete sheet.labels[key];
      }
      scheduleSave();
    });
    return input;
  }

  function textInput(value, onChange, { max = 40, label = '', placeholder = '' } = {}) {
    const input = el('input', { type: 'text', maxLength: max, value: value || '', 'aria-label': label, placeholder, autocomplete: 'off' });
    input.addEventListener('input', () => onChange(input.value));
    return input;
  }

  function field(labelKey, input, sheet = null) {
    if (sheet && renaming) {
      return el('div', { class: 'sheet-field' }, labelNode(sheet, labelKey), input);
    }
    return el('label', { class: 'sheet-field' }, el('span', { text: sheet ? sheetLabel(sheet, labelKey) : t(labelKey) }), input);
  }

  function fold(key, open, ...content) {
    const details = el('details', { class: 'sheet-fold', open });
    details.append(el('summary', { text: t(key) }), el('div', { class: 'sheet-fold-body' }, ...content));
    return details;
  }

  // Habilidades prontas: ataques, magias e curas, com custo de EA, usos por turno,
  // recarga e status. Na mesa elas aparecem no rolador, prontas para usar.
  function powersEditor(sheet) {
    sheet.powers ||= [];
    const list = el('div', { class: 'power-list' });
    const select = (options, value, label, onChange) => {
      const element = el('select', { 'aria-label': label },
        ...options.map(([id, text]) => el('option', { value: id, text, selected: id === value })));
      element.addEventListener('change', () => onChange(element.value));
      return element;
    };
    const small = (labelKey, input) => el('label', { class: 'power-field' }, el('span', { text: t(labelKey) }), input);

    const draw = () => {
      list.replaceChildren(...sheet.powers.map((power, index) => {
        const changed = () => scheduleSave();
        const remove = el('button', { class: 'text-button', type: 'button', text: '×', 'aria-label': t('sheet.removeItem') });
        remove.addEventListener('click', () => {
          sheet.powers.splice(index, 1);
          draw();
          scheduleSave();
        });
        const kind = select(['physical', 'magic', 'pierce', 'recovery'].map((id) => [id, t(`power.kind.${id}`)]), power.kind, t('power.kind'), (value) => {
          power.kind = value;
          if (value !== 'recovery') {
            power.skill = { magic: 'magia', pierce: 'pontaria' }[value] || 'luta';
          }
          draw();
          scheduleSave();
        });
        const top = el('div', { class: 'power-row' },
          textInput(power.name, (value) => { power.name = value; changed(); }, { max: 30, label: t('power.name'), placeholder: t('power.name') }),
          kind,
          textInput(power.notation, (value) => { power.notation = value.replace(/\s+/g, ''); changed(); }, { max: 60, label: t('power.notation'), placeholder: power.kind === 'recovery' ? '2d8+2' : '2d6+3' }),
          remove);
        const common = [
          small('power.ea', numberInput(power.eaCost, (value) => { power.eaCost = value; changed(); }, { min: 0, max: 9999 })),
          small('power.uses', numberInput(power.usesPerTurn, (value) => { power.usesPerTurn = value; changed(); }, { min: 0, max: 10 })),
          small('power.cooldown', numberInput(power.cooldown, (value) => { power.cooldown = value; changed(); }, { min: 0, max: 20 })),
        ];
        const details = power.kind === 'recovery'
          ? [
            small('power.recover', select([['hp', t('kind.hp')], ['ea', t('kind.ea')]], power.recoverStat, t('power.recover'), (value) => { power.recoverStat = value; changed(); })),
            small('power.area', select([['single', t('power.area.single')], ['area', t('power.area.area')]], power.area, t('power.area'), (value) => { power.area = value; changed(); })),
            ...common,
          ]
          : [
            small('power.skill', select(skillsOf(sheet).map(([id]) => [id, sheetLabel(sheet, `skill.${id}`)]), power.skill, t('power.skill'), (value) => { power.skill = value; changed(); })),
            ...common,
            small('power.status', select([['', t('power.noStatus')], ...Object.keys(STATUS_ICONS).map((id) => [id, `${STATUS_ICONS[id]} ${t(`status.${id}`)}`])],
              power.statusId || '', t('power.status'), (value) => { power.statusId = value || null; changed(); })),
          ];
        return el('div', { class: 'power-card', 'data-kind': power.kind }, top, el('div', { class: 'power-row power-details' }, ...details));
      }));
    };
    draw();
    const add = el('button', { class: 'room-button', type: 'button', text: t('power.add') });
    add.addEventListener('click', () => {
      if (sheet.powers.length >= 30) {
        return;
      }
      sheet.powers.push({
        id: crypto.randomUUID().replaceAll('-', ''), name: '', kind: 'physical', notation: '', skill: 'luta',
        eaCost: 0, usesPerTurn: 0, cooldown: 0, statusId: null, recoverStat: 'hp', area: 'single',
      });
      draw();
      list.lastElementChild?.querySelector('input')?.focus();
    });
    return fold('power.title', true, el('p', { class: 'field-hint', text: t('power.hint') }), list, add);
  }

  // Sistemas personalizados (fora da mesa): o mestre monta atributos, perícias e barras.
  // Ficam na conta; na mesa, o mestre escolhe um deles e as fichas seguem esse modelo.
  const slug = (text) => text.normalize('NFD').replace(/[^A-Za-z0-9]/g, '').toLowerCase().slice(0, 40);
  function defaultCustomSystem() {
    const attributes = [['forca', 'Força'], ['agilidade', 'Agilidade'], ['intelecto', 'Intelecto'], ['presenca', 'Presença'], ['vigor', 'Vigor']]
      .map(([id, label]) => ({ id, name: label }));
    const skills = [['atletismo', 'Atletismo', 'forca'], ['luta', 'Luta', 'forca'], ['acrobacia', 'Acrobacia', 'agilidade'],
      ['furtividade', 'Furtividade', 'agilidade'], ['pontaria', 'Pontaria', 'agilidade'], ['reflexos', 'Reflexos', 'agilidade'],
      ['investigacao', 'Investigação', 'intelecto'], ['medicina', 'Medicina', 'intelecto'], ['percepcao', 'Percepção', 'presenca'],
      ['vontade', 'Vontade', 'presenca'], ['fortitude', 'Fortitude', 'vigor']].map(([id, label, attribute]) => ({ id, name: label, attribute }));
    return { id: crypto.randomUUID().replaceAll('-', ''), name: t('system.newCustom'), attributes, skills, stats: ['hp', 'ea', 'san', 'vig'], statNames: {} };
  }

  function customSystemsEditor() {
    let feedback = '';
    const body = el('div', { class: 'custom-systems' });
    const draw = () => {
      body.replaceChildren(...customSystems.map((system, index) => {
        const nameInput = textInput(system.name, (value) => { system.name = value; }, { max: 30, label: t('system.name'), placeholder: t('system.name') });
        const remove = el('button', { class: 'text-button note-delete', type: 'button', text: t('notes.delete') });
        remove.addEventListener('click', () => { customSystems.splice(index, 1); draw(); });
        // Atributos.
        const attributes = el('div', { class: 'custom-list' }, ...system.attributes.map((attribute, attrIndex) => {
          const input = textInput(attribute.name, (value) => { attribute.name = value; }, { max: 20, label: t('sheet.attribute') });
          const drop = el('button', { class: 'text-button', type: 'button', text: '×', 'aria-label': t('sheet.removeItem') });
          drop.addEventListener('click', () => { system.attributes.splice(attrIndex, 1); draw(); });
          return el('span', { class: 'custom-item' }, input, drop);
        }));
        const addAttribute = el('button', { class: 'text-button', type: 'button', text: t('system.addAttribute') });
        addAttribute.addEventListener('click', () => {
          if (system.attributes.length < 12) {
            system.attributes.push({ id: crypto.randomUUID().replaceAll('-', '').slice(0, 12), name: '' });
            draw();
          }
        });
        // Perícias (cada uma ligada a um atributo).
        const skills = el('div', { class: 'custom-list' }, ...system.skills.map((skill, skillIndex) => {
          const input = textInput(skill.name, (value) => { skill.name = value; }, { max: 30, label: t('sheet.skill') });
          const attribute = el('select', { 'aria-label': t('sheet.attribute') },
            ...system.attributes.map((item) => el('option', { value: item.id, text: item.name || '?', selected: item.id === skill.attribute })));
          attribute.addEventListener('change', () => { skill.attribute = attribute.value; });
          const drop = el('button', { class: 'text-button', type: 'button', text: '×', 'aria-label': t('sheet.removeItem') });
          drop.addEventListener('click', () => { system.skills.splice(skillIndex, 1); draw(); });
          return el('span', { class: 'custom-item' }, input, attribute, drop);
        }));
        const addSkill = el('button', { class: 'text-button', type: 'button', text: t('system.addSkill') });
        addSkill.addEventListener('click', () => {
          if (system.skills.length < 60) {
            system.skills.push({ id: '', name: '', attribute: system.attributes[0]?.id || '' });
            draw();
          }
        });
        // Barras: vida, mana, sanidade e vigor (liga, desliga e dá nome).
        const stats = el('div', { class: 'custom-stats' }, ...['hp', 'ea', 'san', 'vig'].map((stat) => {
          const box = el('input', { type: 'checkbox', checked: system.stats.includes(stat), 'aria-label': t(`system.stat.${stat}`) });
          box.addEventListener('change', () => {
            system.stats = box.checked ? [...new Set([...system.stats, stat])] : system.stats.filter((item) => item !== stat);
          });
          const label = textInput(system.statNames?.[stat] || '', (value) => { system.statNames ||= {}; system.statNames[stat] = value; },
            { max: 20, label: t(`system.stat.${stat}`), placeholder: t(`system.stat.${stat}`) });
          return el('span', { class: 'custom-item' }, box, label);
        }));
        return el('div', { class: 'custom-system-card' },
          el('div', { class: 'custom-system-head' }, nameInput, remove),
          el('span', { class: 'field-label', text: t('system.attributes') }), attributes, addAttribute,
          el('span', { class: 'field-label', text: t('system.skills') }), skills, addSkill,
          el('span', { class: 'field-label', text: t('system.stats') }), stats);
      }));
    };
    draw();
    const add = el('button', { class: 'room-button', type: 'button', text: t('system.new') });
    add.addEventListener('click', () => {
      if (customSystems.length < 20) {
        customSystems.push(defaultCustomSystem());
        draw();
      }
    });
    const status = el('span', { class: 'sheet-save', role: 'status' });
    const save = el('button', { class: 'room-button room-button-primary', type: 'button', text: t('room.save') });
    save.addEventListener('click', async () => {
      // Perícia nova ganha um id a partir do nome (Reflexos e Medicina viram as do combate).
      for (const system of customSystems) {
        const used = new Set();
        for (const skill of system.skills) {
          let id = skill.id || slug(skill.name) || crypto.randomUUID().replaceAll('-', '').slice(0, 12);
          while (used.has(id)) {
            id += 'x';
          }
          skill.id = id;
          used.add(id);
        }
      }
      try {
        customSystems = await api('/api/account/systems', { method: 'PUT', body: customSystems });
        feedback = t('sheet.saved');
      } catch {
        feedback = t('sheet.saveFailed');
      }
      draw();
      status.textContent = feedback;
    });
    return fold('system.customTitle', false, el('p', { class: 'field-hint', text: t('system.customHint') }), body,
      el('div', { class: 'note-form-actions' }, add, status, save));
  }

  function render() {
    view.replaceChildren();
    const head = el('div', { class: 'view-head' },
      el('div', {}, el('p', { class: 'chapter', text: active() ? `${t('sheet.chapter')} · ${systemName(active().system || 'abismo', active().template).toUpperCase()}` : t('sheet.chapter') }),
        el('h2', { id: 'sheet-title', text: active()?.name || t('sheet.title') })));
    view.append(head);

    if (!currentAccount()) {
      const login = el('button', { class: 'room-button room-button-primary', type: 'button', text: t('account.signIn') });
      login.addEventListener('click', () => document.querySelector('#account-toggle').click());
      view.append(el('div', { class: 'sheet-empty' }, el('p', { text: t('sheet.loginHint') }), login));
      return;
    }
    if (loading || !documentState) {
      view.append(el('p', { class: 'sheet-empty', text: t('search.loading') }));
      return;
    }

    // Escolher, criar e excluir fichas.
    const tools = el('div', { class: 'sheet-tools' });
    if (documentState.sheets.length > 0) {
      const picker = el('select', { 'aria-label': t('sheet.pick') });
      // Na mesa, só as fichas do sistema que o mestre escolheu.
      for (const sheet of documentState.sheets.filter((candidate) => !roomSystem || sameSystem(candidate, roomSystem.system, roomSystem.custom?.id))) {
        picker.append(el('option', { value: sheet.id, text: sheet.name || t('sheet.unnamed'), selected: sheet.id === documentState.activeId }));
      }
      picker.addEventListener('change', () => {
        documentState.activeId = picker.value;
        armedDelete = false;
        render();
        scheduleSave();
      });
      tools.append(picker);
    }
    // Sistema da ficha nova: na mesa, o da mesa; fora dela, o jogador escolhe.
    const systemPicker = el('select', { 'aria-label': t('sheet.system') });
    for (const id of ['abismo', ...Object.keys(BUILT_IN_SYSTEMS)]) {
      systemPicker.append(el('option', { value: id, text: systemName(id) }));
    }
    for (const custom of customSystems) {
      systemPicker.append(el('option', { value: `custom:${custom.id}`, text: `${custom.name} (${t('system.custom')})` }));
    }
    systemPicker.value = [...systemPicker.options].some((option) => option.value === newSystem) ? newSystem : 'abismo';
    systemPicker.addEventListener('change', () => { newSystem = systemPicker.value; });
    if (!roomSystem) {
      tools.append(systemPicker);
    }
    const create = el('button', { class: 'room-button', type: 'button', text: t('sheet.new') });
    create.disabled = documentState.sheets.length >= MAX_SHEETS;
    create.addEventListener('click', () => {
      const choice = roomSystem
        ? (roomSystem.system === 'custom' ? `custom:${roomSystem.custom?.id}` : roomSystem.system)
        : systemPicker.value;
      const [system, customId] = choice.split(':');
      const template = system === 'custom'
        ? (roomSystem?.custom?.id === customId ? roomSystem.custom : customSystems.find((custom) => custom.id === customId))
        : null;
      const sheet = template || system !== 'custom'
        ? blankSheet(system, template ? structuredClone(template) : null)
        : blankSheet();
      documentState.sheets.push(sheet);
      documentState.activeId = sheet.id;
      render();
      scheduleSave();
    });
    tools.append(create);
    if (active()) {
      const remove = el('button', { class: `room-button room-delete${armedDelete ? ' is-armed' : ''}`, type: 'button', text: t(armedDelete ? 'sheet.confirmDelete' : 'sheet.delete') });
      remove.addEventListener('click', () => {
        if (!armedDelete) {
          armedDelete = true;
          render();
          return;
        }
        armedDelete = false;
        documentState.sheets = documentState.sheets.filter((sheet) => sheet.id !== documentState.activeId);
        documentState.activeId = documentState.sheets[0]?.id || null;
        render();
        scheduleSave();
      });
      tools.append(remove);
      const rename = el('button', { class: 'room-button', type: 'button', text: t(renaming ? 'sheet.renameDone' : 'sheet.rename'), 'aria-pressed': String(renaming), title: t('sheet.renameHint') });
      rename.addEventListener('click', () => {
        renaming = !renaming;
        render();
      });
      tools.append(rename);
    }
    statusLine = el('span', { class: 'sheet-save', role: 'status', 'aria-live': 'polite' });
    tools.append(statusLine);
    view.append(tools);
    if (!roomSystem) {
      view.append(customSystemsEditor());
    }

    const sheet = active();
    if (!sheet) {
      view.append(el('p', { class: 'sheet-empty', text: t('sheet.none') }));
      return;
    }
    if (roomSystem && !sameSystem(sheet, roomSystem.system, roomSystem.custom?.id)) {
      view.append(el('p', { class: 'sheet-empty', text: t('sheet.needSystem', { system: systemName(roomSystem.system, roomSystem.custom) }) }));
      return;
    }
    const shape = systemShape(sheet);
    const change = (apply) => (value) => {
      apply(value);
      scheduleSave();
      refreshComputed();
    };

    // Identidade.
    const nameInput = textInput(sheet.name, (value) => {
      sheet.name = value;
      head.querySelector('h2').textContent = value || t('sheet.title');
      const option = tools.querySelector(`option[value="${sheet.id}"]`);
      if (option) {
        option.textContent = value || t('sheet.unnamed');
      }
      scheduleSave();
    }, { max: 40, label: t('sheet.name') });
    const identity = el('div', { class: 'sheet-card sheet-identity' },
      field('sheet.name', nameInput),
      field('sheet.age', textInput(sheet.age, change((value) => { sheet.age = value; }), { max: 20 })),
      shape
        ? el('label', { class: 'sheet-field' }, el('span', { text: shape.level }), numberInput(sheet.level, change((value) => { sheet.level = value; }), { min: 0, max: 999 }))
        : field('sheet.level', numberInput(sheet.level, change((value) => { sheet.level = value; }), { min: 0, max: 999 })),
      field('sheet.race', textInput(sheet.race, change((value) => { sheet.race = value; }), { max: 40 })),
      // Outros sistemas: classe e defesa (CA, Defesa).
      shape?.classLabel ? el('label', { class: 'sheet-field' }, el('span', { text: shape.classLabel }),
        textInput(sheet.class, change((value) => { sheet.class = value; }), { max: 40 })) : null,
      shape?.defense ? el('label', { class: 'sheet-field' }, el('span', { text: shape.defense }),
        numberInput(sheet.defense, change((value) => { sheet.defense = value; }), { min: -99, max: 999 })) : null);

    // Status: máxima, atual (vai direto ao servidor), perdida (calculada) e outros.
    const statusTable = el('div', { class: 'sheet-card sheet-status' },
      el('div', { class: 'status-row status-head' },
        el('span', {}), el('span', { text: t('sheet.max') }), el('span', { text: t('sheet.current') }),
        el('span', { text: t('sheet.lost') }), el('span', { text: t('sheet.other') })));
    for (const stat of statsOf(sheet)) {
      const block = sheet[stat];
      const current = numberInput(block.current, () => {}, { min: stat === 'hp' ? -999 : 0, max: 9999, label: `${t(`stat.${stat}`)} ${t('sheet.current')}` });
      current.dataset.current = stat;
      current.addEventListener('change', () => {
        const value = Number.parseInt(current.value, 10);
        setCurrent(stat, Number.isFinite(value) ? value : 0);
      });
      const max = numberInput(block.max, (value) => {
        const wasFull = block.current === block.max;
        block.max = value;
        if (block.current > value) {
          block.current = value;
        }
        scheduleSave();
        refreshComputed();
        if (wasFull && value > block.current) {
          setCurrent(stat, value);
        }
      }, { min: 0, max: 9999, label: `${t(`stat.${stat}`)} ${t('sheet.max')}`, commit: 'change' });
      statusTable.append(el('div', { class: 'status-row', 'data-stat': stat },
        labelNode(sheet, `stat.${stat}`, 'strong'),
        max,
        current,
        el('output', { 'data-lost': stat }),
        numberInput(block.other, change((value) => { block.other = value; }), { label: `${t(`stat.${stat}`)} ${t('sheet.other')}` }),
        el('span', { class: 'status-bar', 'aria-hidden': 'true' }, el('i', { 'data-bar': stat }))));
    }
    // Recuperação manual: soma no atual, sem passar do máximo.
    const recoverAmount = el('input', { type: 'number', min: 1, max: 9999, value: '', inputMode: 'numeric', placeholder: '0', 'aria-label': t('sheet.recoverAmount') });
    const recoverStat = el('select', { 'aria-label': t('kind.recoverStat') }, ...statsOf(sheet).map((stat) => el('option', { value: stat, text: sheetLabel(sheet, `stat.${stat}`) })));
    const recoverButton = el('button', { class: 'room-button', type: 'button', text: t('sheet.apply') });
    recoverButton.addEventListener('click', () => {
      const amount = Number.parseInt(recoverAmount.value, 10);
      if (!Number.isFinite(amount) || amount <= 0) {
        recoverAmount.focus();
        return;
      }
      const block = sheet[recoverStat.value];
      const ceiling = recoverStat.value === 'hp' && block.current <= 0 ? 0 : block.max;
      setCurrent(recoverStat.value, Math.max(block.current, Math.min(ceiling, block.current + amount)));
      recoverAmount.value = '';
    });
    statusTable.append(el('div', { class: 'sheet-recover' },
      el('span', { text: t('sheet.recovered') }), recoverAmount, el('span', { text: t('sheet.of') }), recoverStat, recoverButton));

    // Atributos, nas cores da ficha.
    const attributes = el('div', { class: 'sheet-attributes' });
    for (const id of attributesOf(sheet)) {
      sheet.attributes[id] ||= { value: shape?.attributeDefault || 0, bonus: 0 };
      const value = sheet.attributes[id];
      attributes.append(el('div', { class: 'attribute-tile', 'data-attribute': id },
        labelNode(sheet, `attr.${id}.name`, 'span', 'attribute-name'),
        numberInput(value.value, change((next) => { value.value = next; }), { min: -99, max: 99, label: t(`attr.${id}.name`) }),
        el('label', { class: 'attribute-bonus' }, el('span', { text: t('sheet.bonus') }),
          numberInput(value.bonus, change((next) => { value.bonus = next; }), { min: -99, max: 99, label: `${t(`attr.${id}.name`)} ${t('sheet.bonus')}` }))));
    }

    view.append(el('div', { class: 'sheet-top' }, identity, statusTable), attributes);

    // Perícias.
    const skills = el('div', { class: 'skill-table' },
      el('div', { class: 'skill-row skill-head' },
        el('span', { text: t('sheet.skill') }), el('span', { text: t('sheet.attribute') }),
        el('span', { text: t('sheet.trained') }), el('span', { text: t('sheet.other') }), el('span', { text: t('sheet.test') })));
    for (const [id, attribute] of skillsOf(sheet)) {
      sheet.skills[id] ||= { trained: 0, other: 0 };
      const skill = sheet.skills[id];
      // Treino: número livre (Abismo e personalizado) ou os graus do sistema.
      let trained;
      if (shape?.trained) {
        trained = el('select', { 'aria-label': `${sheetLabel(sheet, `skill.${id}`)} ${t('sheet.trained')}` },
          ...shape.trained.map(([value, text]) => el('option', { value: String(value), text, selected: Number(skill.trained) === value })));
        trained.addEventListener('change', () => change((value) => { skill.trained = value; })(Number(trained.value)));
      } else {
        trained = numberInput(skill.trained, change((value) => { skill.trained = value; }), { min: -99, max: 99, label: `${sheetLabel(sheet, `skill.${id}`)} ${t('sheet.trained')}` });
      }
      skills.append(el('div', { class: 'skill-row' },
        labelNode(sheet, `skill.${id}`, 'span', 'skill-name'),
        el('span', { class: 'skill-attribute', 'data-attribute': attribute, text: shape ? sheetLabel(sheet, `attr.${attribute}.name`) : t(`attr.${attribute}`) }),
        trained,
        numberInput(skill.other, change((value) => { skill.other = value; }), { min: -99, max: 99, label: `${t(`skill.${id}`)} ${t('sheet.other')}` }),
        el('output', { class: 'skill-test', 'data-test': id })));
    }
    view.append(fold('sheet.skills', true, skills, el('p', { class: 'field-hint', text: t(shape ? `sheet.skillRule.${sheet.system}` : 'sheet.skillLimit') })));

    // Resistências e habilidades básicas.
    const resist = el('div', { class: 'sheet-grid' },
      ...['physical', 'magic', 'pierce'].map((id) => field(`resist.${id}`,
        numberInput(sheet.resist[id], change((value) => { sheet.resist[id] = value; }), { min: 0, max: 999 }), sheet)));
    const basics = el('div', { class: 'sheet-grid' },
      field('sheet.elements', textInput(sheet.elements, change((value) => { sheet.elements = value; }), { max: 80 }), sheet),
      field('sheet.extraElements', textInput(sheet.extraElements, change((value) => { sheet.extraElements = value; }), { max: 80 }), sheet),
      field('sheet.abilityPoints', numberInput(sheet.abilityPoints, change((value) => { sheet.abilityPoints = value; }), { min: -999, max: 999 }), sheet),
      field('sheet.initiative', textInput(sheet.initiative, change((value) => { sheet.initiative = value; }), { max: 30, placeholder: '1d20+3' }), sheet));
    // Resistências: Abismo e personalizado (o combate da mesa usa). Habilidades básicas: só Abismo.
    if (!shape || shape.resist) {
      view.append(fold('sheet.resistances', false, resist));
    }
    if (!shape) {
      view.append(fold('sheet.basics', false, basics));
    }

    // Listas livres.
    const lists = el('div', { class: 'sheet-lists' });
    for (const key of LISTS) {
      const items = el('ul', { class: 'sheet-list-items' });
      const drawItems = () => {
        items.replaceChildren(...sheet[key].map((item, index) => {
          const remove = el('button', { class: 'text-button', type: 'button', text: '×', 'aria-label': t('sheet.removeItem') });
          remove.addEventListener('click', () => {
            sheet[key].splice(index, 1);
            drawItems();
            scheduleSave();
          });
          return el('li', {}, el('span', { text: item }), remove);
        }));
      };
      drawItems();
      const input = el('input', { type: 'text', maxLength: 120, placeholder: t('sheet.addItem'), 'aria-label': `${t(`sheet.list.${key}`)}: ${t('sheet.addItem')}` });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && input.value.trim() && sheet[key].length < 60) {
          event.preventDefault();
          sheet[key].push(input.value.trim());
          input.value = '';
          drawItems();
          scheduleSave();
        }
      });
      lists.append(el('div', { class: 'sheet-list' }, labelNode(sheet, `sheet.list.${key}`, 'strong'), items, input));
    }
    view.append(fold('sheet.listsTitle', false, lists));

    // Rolagens rápidas: aparecem no rolador (a ficha só guarda).
    const quick = el('div', { class: 'quick-editor' });
    const drawQuick = () => {
      quick.replaceChildren(...sheet.quickRolls.map((roll, index) => {
        const kind = el('select', { 'aria-label': t('sheet.quickKind') },
          ...QUICK_KINDS.map((id) => el('option', { value: id, text: t(`quick.${id}`), selected: roll.kind === id })));
        kind.addEventListener('change', () => {
          roll.kind = kind.value;
          scheduleSave();
        });
        const remove = el('button', { class: 'text-button', type: 'button', text: '×', 'aria-label': t('sheet.removeItem') });
        remove.addEventListener('click', () => {
          sheet.quickRolls.splice(index, 1);
          drawQuick();
          scheduleSave();
        });
        return el('div', { class: 'quick-row' },
          textInput(roll.name, (value) => { roll.name = value; scheduleSave(); }, { max: 30, label: t('shortcut.name'), placeholder: t('shortcut.name') }),
          textInput(roll.notation, (value) => { roll.notation = value; scheduleSave(); }, { max: 60, label: t('shortcut.notation'), placeholder: '1d20+5' }),
          kind, remove);
      }));
    };
    drawQuick();
    const addQuick = el('button', { class: 'room-button', type: 'button', text: t('sheet.addQuick') });
    addQuick.addEventListener('click', () => {
      if (sheet.quickRolls.length < 24) {
        sheet.quickRolls.push({ name: '', notation: '', kind: 'test' });
        drawQuick();
        quick.lastElementChild?.querySelector('input')?.focus();
      }
    });
    // Ficam no topo da ficha, logo abaixo das ferramentas.
    const quickFold = fold('sheet.quickRolls', true, el('p', { class: 'field-hint', text: t('sheet.quickHint') }), quick, addQuick);
    tools.after(quickFold);
    quickFold.after(powersEditor(sheet));

    refreshComputed();
  }

  // Atualiza só o que é calculado (perdida, barras e testes), sem redesenhar os campos.
  function refreshComputed() {
    const sheet = active();
    if (!sheet) {
      return;
    }
    for (const stat of statsOf(sheet)) {
      const block = sheet[stat];
      const lost = view.querySelector(`[data-lost="${stat}"]`);
      if (lost) {
        lost.textContent = String(Math.max(0, block.max - block.current));
      }
      const current = view.querySelector(`[data-current="${stat}"]`);
      if (current && document.activeElement !== current) {
        current.value = String(block.current);
      }
      const bar = view.querySelector(`[data-bar="${stat}"]`);
      if (bar) {
        bar.style.width = `${block.max > 0 ? Math.max(0, Math.min(100, (block.current / block.max) * 100)) : 0}%`;
      }
    }
    for (const [id] of skillsOf(sheet)) {
      const output = view.querySelector(`[data-test="${id}"]`);
      if (output) {
        output.textContent = String(skillTest(sheet, id));
      }
    }
  }

  // Na mesa, a ficha ativa precisa ser do sistema da mesa: troca para a primeira que for.
  function followRoomSystem() {
    if (!roomSystem || !documentState) {
      return;
    }
    const current = active();
    if (current && sameSystem(current, roomSystem.system, roomSystem.custom?.id)) {
      return;
    }
    const match = documentState.sheets.find((sheet) => sameSystem(sheet, roomSystem.system, roomSystem.custom?.id));
    if (match) {
      documentState.activeId = match.id;
      render();
      scheduleSave();
    } else {
      render();
    }
  }

  // A mesa avisa quando HP/EA mudaram (poção, magia, dano): atualiza a ficha aberta.
  window.addEventListener('room-state', (event) => {
    const room = event.detail || {};
    const nextSystem = room.code ? { system: room.system || 'abismo', custom: room.customSystem || null } : null;
    if (JSON.stringify(nextSystem) !== JSON.stringify(roomSystem)) {
      roomSystem = nextSystem;
      followRoomSystem();
      render();
    }
    roomPlayers = Array.isArray(room.players) ? room.players : [];
    myPlayer = roomPlayers.find((player) => player.id === room.myPlayerId) || null;
    const status = myPlayer?.status;
    const sheet = active();
    if (status && sheet && status.sheetId === sheet.id
      && (sheet.hp.current !== status.hp || sheet.ea.current !== status.ea)) {
      sheet.hp.current = status.hp;
      sheet.ea.current = status.ea;
      refreshComputed();
      emit();
    }
  });

  onAccountChange(load);
  window.addEventListener('languagechange-app', render);
  render();

  return {
    active,
    onChange(listener) {
      listeners.add(listener);
    },
    // Exportar: o documento como está no servidor.
    async exportSheets() {
      await flush();
      return api('/api/account/sheets');
    },
    // Importar: as fichas do arquivo entram como novas (não apagam as que existem).
    async importSheets(parsed) {
      if (!documentState) {
        throw new Error('NOT_LOGGED_IN');
      }
      const incoming = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.sheets) ? parsed.sheets : null;
      if (!incoming) {
        throw new Error('INVALID_SHEET');
      }
      const room = MAX_SHEETS - documentState.sheets.length;
      const added = incoming.filter((sheet) => sheet && typeof sheet === 'object').slice(0, Math.max(0, room))
        .map((sheet) => ({ ...blankSheet(), ...sheet, id: blankSheet().id }));
      documentState.sheets.push(...added);
      if (added.length && !documentState.activeId) {
        documentState.activeId = added[0].id;
      }
      await flush();
      await load();
      return added.length;
    },
  };
}
