// Aba "Ficha": as fichas da conta, no formato da ficha do grupo. A ficha não rola
// dados: ela só guarda o personagem (as rolagens rápidas aparecem no rolador).
// Tudo salva sozinho. HP, EA e San atuais vão direto para o servidor, porque também
// mudam pela mesa (poções, magias e, em combate, dano).
import { t } from './i18n.js';
import { api, currentAccount, onAccountChange } from './account.js';

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
const LISTS = ['effects', 'abilities', 'inventory'];
export const QUICK_KINDS = ['test', 'attack', 'physical', 'magic', 'pierce', 'recovery'];
const MAX_SHEETS = 20;

// Teste da perícia: treinado + outros + metade do atributo, para baixo.
export function skillTest(sheet, skillId) {
  const attribute = SKILLS.find(([id]) => id === skillId)?.[1];
  const skill = sheet.skills?.[skillId] || {};
  const value = sheet.attributes?.[attribute]?.value || 0;
  return (skill.trained || 0) + (skill.other || 0) + Math.floor(value / 2);
}

function blankSheet() {
  return {
    id: crypto.randomUUID().replaceAll('-', ''),
    name: '', age: '', level: 1, race: '',
    hp: { max: 0, current: 0, other: 0 },
    ea: { max: 0, current: 0, other: 0 },
    san: { max: 0, current: 0, other: 0 },
    attributes: Object.fromEntries(ATTRIBUTES.map((id) => [id, { value: 0, bonus: 0 }])),
    skills: Object.fromEntries(SKILLS.map(([id]) => [id, { trained: 0, other: 0 }])),
    resist: { physical: 0, magic: 0, pierce: 0 },
    elements: '', extraElements: '',
    abilityPoints: 0,
    initiative: '',
    system: 'abismo', labels: {},
    effects: [], abilities: [], inventory: [],
    quickRolls: [],
  };
}

// Nome que aparece na ficha: o que o jogador escolheu ou o padrão do idioma.
export function sheetLabel(sheet, key) {
  return sheet?.labels?.[key] || t(key);
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
          for (const stat of STATS) {
            sheet[stat].current = server[stat].current;
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

  function render() {
    view.replaceChildren();
    const head = el('div', { class: 'view-head' },
      el('div', {}, el('p', { class: 'chapter', text: active() ? `${t('sheet.chapter')} · ${t('system.abismo')}` : t('sheet.chapter') }),
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
      for (const sheet of documentState.sheets) {
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
    const create = el('button', { class: 'room-button', type: 'button', text: t('sheet.new') });
    create.disabled = documentState.sheets.length >= MAX_SHEETS;
    create.addEventListener('click', () => {
      const sheet = blankSheet();
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

    const sheet = active();
    if (!sheet) {
      view.append(el('p', { class: 'sheet-empty', text: t('sheet.none') }));
      return;
    }
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
      field('sheet.level', numberInput(sheet.level, change((value) => { sheet.level = value; }), { min: 0, max: 999 })),
      field('sheet.race', textInput(sheet.race, change((value) => { sheet.race = value; }), { max: 40 })));

    // Status: máxima, atual (vai direto ao servidor), perdida (calculada) e outros.
    const statusTable = el('div', { class: 'sheet-card sheet-status' },
      el('div', { class: 'status-row status-head' },
        el('span', {}), el('span', { text: t('sheet.max') }), el('span', { text: t('sheet.current') }),
        el('span', { text: t('sheet.lost') }), el('span', { text: t('sheet.other') })));
    for (const stat of STATS) {
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
    const recoverStat = el('select', { 'aria-label': t('kind.recoverStat') }, ...STATS.map((stat) => el('option', { value: stat, text: sheetLabel(sheet, `stat.${stat}`) })));
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
    for (const id of ATTRIBUTES) {
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
    for (const [id, attribute] of SKILLS) {
      const skill = sheet.skills[id];
      skills.append(el('div', { class: 'skill-row' },
        labelNode(sheet, `skill.${id}`, 'span', 'skill-name'),
        el('span', { class: 'skill-attribute', 'data-attribute': attribute, text: t(`attr.${attribute}`) }),
        numberInput(skill.trained, change((value) => { skill.trained = value; }), { min: -99, max: 99, label: `${t(`skill.${id}`)} ${t('sheet.trained')}` }),
        numberInput(skill.other, change((value) => { skill.other = value; }), { min: -99, max: 99, label: `${t(`skill.${id}`)} ${t('sheet.other')}` }),
        el('output', { class: 'skill-test', 'data-test': id })));
    }
    view.append(fold('sheet.skills', true, skills, el('p', { class: 'field-hint', text: t('sheet.skillLimit') })));

    // Resistências e habilidades básicas.
    const resist = el('div', { class: 'sheet-grid' },
      ...['physical', 'magic', 'pierce'].map((id) => field(`resist.${id}`,
        numberInput(sheet.resist[id], change((value) => { sheet.resist[id] = value; }), { min: 0, max: 999 }), sheet)));
    const basics = el('div', { class: 'sheet-grid' },
      field('sheet.elements', textInput(sheet.elements, change((value) => { sheet.elements = value; }), { max: 80 }), sheet),
      field('sheet.extraElements', textInput(sheet.extraElements, change((value) => { sheet.extraElements = value; }), { max: 80 }), sheet),
      field('sheet.abilityPoints', numberInput(sheet.abilityPoints, change((value) => { sheet.abilityPoints = value; }), { min: -999, max: 999 }), sheet),
      field('sheet.initiative', textInput(sheet.initiative, change((value) => { sheet.initiative = value; }), { max: 30, placeholder: '1d20+3' }), sheet));
    view.append(fold('sheet.resistances', false, resist), fold('sheet.basics', false, basics));

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
    tools.after(fold('sheet.quickRolls', true, el('p', { class: 'field-hint', text: t('sheet.quickHint') }), quick, addQuick));

    refreshComputed();
  }

  // Atualiza só o que é calculado (perdida, barras e testes), sem redesenhar os campos.
  function refreshComputed() {
    const sheet = active();
    if (!sheet) {
      return;
    }
    for (const stat of STATS) {
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
    for (const [id] of SKILLS) {
      const output = view.querySelector(`[data-test="${id}"]`);
      if (output) {
        output.textContent = String(skillTest(sheet, id));
      }
    }
  }

  // A mesa avisa quando HP/EA mudaram (poção, magia, dano): atualiza a ficha aberta.
  window.addEventListener('room-state', (event) => {
    const room = event.detail || {};
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
