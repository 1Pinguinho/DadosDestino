// Combate com turnos: uma faixa fina em cima das mesas, só enquanto há combate.
// Mostra a rodada, de quem é a vez, a ordem e uma frase do que fazer agora. As
// rolagens continuam manuais: na sua vez, a próxima rolagem conta como ataque,
// Reflexos, Medicina ou iniciativa (os botões só preenchem e rolam por você).
import { t, errorText } from './i18n.js';
import { playTurn } from './sound.js';
import { skillTest } from './sheet.js';
import { systemTestNotation } from './systems.js';

// Status de dano do sistema (a mesma lista do servidor) e o ícone de cada um.
export const STATUS_ICONS = {
  queimando: '🔥', chamaInfernal: '🌋', sangrando: '🩸', hemorragia: '🫀', envenenado: '🧪', corroido: '🦠',
  eletrocutado: '⚡', congelamento: '❄️', necrose: '💀', sobrecarga: '🔮', deterioracao: '🌑', ruptura: '🌀',
};
const STATUS_IDS = Object.keys(STATUS_ICONS);

// Cartão do resumo do combate (aparece ao encerrar e fica no chat).
export function summaryCard(summary) {
  const card = document.createElement('div');
  card.className = 'combat-summary';
  const title = document.createElement('strong');
  title.className = 'combat-summary-title';
  title.textContent = t('summary.title', { rounds: summary.rounds });
  card.append(title);
  const fighters = summary.fighters || [];
  const best = (key) => fighters.reduce((top, entry) => (entry[key] > (top?.[key] ?? 0) ? entry : top), null);
  const highlights = [
    ['summary.mostDealt', best('dealt'), 'dealt'],
    ['summary.mostTaken', best('taken'), 'taken'],
    ['summary.mostRescues', best('rescues'), 'rescues'],
  ].filter(([, entry]) => entry);
  if (highlights.length) {
    const list = document.createElement('div');
    list.className = 'combat-summary-highlights';
    for (const [key, entry, field] of highlights) {
      const item = document.createElement('span');
      item.textContent = t(key, { name: entry.name, value: entry[field] });
      list.append(item);
    }
    card.append(list);
  }
  const table = document.createElement('table');
  const head = document.createElement('tr');
  for (const key of ['summary.who', 'summary.dealt', 'summary.taken', 'summary.hits', 'summary.crits', 'summary.downs']) {
    const cell = document.createElement('th');
    cell.textContent = t(key);
    head.append(cell);
  }
  table.append(head);
  for (const entry of fighters) {
    const row = document.createElement('tr');
    const values = [
      `${entry.name}${entry.died ? ' ☠' : ''}`,
      entry.dealt,
      entry.taken,
      `${entry.hits}/${entry.hits + entry.misses}`,
      `${entry.crits}·${entry.fumbles}`,
      entry.downs,
    ];
    for (const value of values) {
      const cell = document.createElement('td');
      cell.textContent = String(value);
      row.append(cell);
    }
    table.append(row);
  }
  card.append(table);
  return card;
}

export function initCombat({ manager, getRoom, getSheet, rollNotation, selectDamage, seatFor }) {
  const bar = document.querySelector('#combat-bar');
  const startButton = document.querySelector('#combat-start');
  let view = null;
  let room = null;
  let feedback = '';
  let lastAlertKey = '';

  const fighter = (id) => view?.fighters.find((candidate) => candidate.id === id) || null;
  const nameOf = (id) => fighter(id)?.name || '';
  const isMaster = () => Boolean(room?.isMaster);
  const controls = (target) => Boolean(target && (target.isBoss ? isMaster() : target.playerId === room?.myPlayerId));
  const abismoTable = () => (room?.system || 'abismo') === 'abismo';
  const mine = () => view?.fighters.find((candidate) => !candidate.isBoss && candidate.playerId === room?.myPlayerId) || null;

  async function run(method, ...args) {
    feedback = '';
    try {
      await manager.invoke(method, ...args);
    } catch (error) {
      feedback = errorText(error, 'combat.failed');
      render();
    }
  }

  function button(text, onClick, className = 'combat-button') {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = className;
    element.textContent = text;
    element.addEventListener('click', onClick);
    return element;
  }

  function span(className, text) {
    const element = document.createElement('span');
    element.className = className;
    element.textContent = text;
    return element;
  }

  // Notação da iniciativa da ficha (ex.: "1d20+3"); se não der, 1d20 + Agilidade.
  function initiativeNotation() {
    const sheet = getSheet();
    const text = (sheet?.initiative || '').replace(/\s+/g, '');
    if (/^\d*d\d+([+-]\d+)?$/i.test(text)) {
      return text;
    }
    // Outros sistemas: a perícia Iniciativa (Ordem, Tormenta) ou o modificador de Destreza (D&D).
    if (sheet?.system === 'ordem' || sheet?.system === 'tormenta') {
      return systemTestNotation(sheet, 'iniciativa', skillTest(sheet, 'iniciativa'));
    }
    if (sheet?.system === 'dnd') {
      return withBonus(Math.floor(((sheet.attributes?.dex?.value ?? 10) - 10) / 2));
    }
    if (sheet?.system === 'custom') {
      return withBonus(0);
    }
    const agility = sheet?.attributes?.agl?.value || 0;
    return `1d20${agility ? (agility > 0 ? `+${agility}` : agility) : ''}`;
  }

  const withBonus = (bonus) => `1d20${bonus ? (bonus > 0 ? `+${bonus}` : bonus) : ''}`;

  function eventText(event) {
    if (!event) {
      return '';
    }
    const params = {
      actor: nameOf(event.actorId), target: nameOf(event.targetId), value: event.value ?? '',
      status: event.statusId ? t(`status.${event.statusId}`) : '',
    };
    const key = `combat.event.${event.type}`;
    let text = t(key, params);
    if (text === key) {
      return '';
    }
    if (event.abilityName) {
      text = `✦ ${event.abilityName}: ${text}`;
    }
    if (event.critical) {
      text += ` — ${t('combat.critical')}`;
    }
    if (event.statusId && event.type === 'damage') {
      text += ` + ${STATUS_ICONS[event.statusId] || ''} ${t(`status.${event.statusId}`)}`;
    }
    return text;
  }

  // Dano dos status no fim do turno (ex.: "Lira: Queimando 5 · Sangrando 3").
  function ticksText() {
    if (!view?.ticks?.length) {
      return '';
    }
    const byFighter = new Map();
    for (const tick of view.ticks) {
      const parts = byFighter.get(tick.fighterId) || [];
      parts.push(`${STATUS_ICONS[tick.statusId] || ''} ${t(`status.${tick.statusId}`)}${tick.burst ? ' (+2d8)' : ''} ${tick.damage}`);
      byFighter.set(tick.fighterId, parts);
    }
    return [...byFighter].map(([id, parts]) => `${nameOf(id)}: ${parts.join(' · ')}`).join(' — ');
  }

  // Ícones dos status ao lado do nome (com stacks e turnos restantes no título).
  function statusBadges(statuses, removable = null) {
    const wrap = document.createElement('span');
    wrap.className = 'status-badges';
    for (const effect of statuses || []) {
      const badge = document.createElement(removable ? 'button' : 'span');
      badge.className = 'status-badge';
      badge.dataset.status = effect.id;
      badge.textContent = `${STATUS_ICONS[effect.id] || '•'}${effect.stacks > 1 ? effect.stacks : ''}`;
      badge.title = t('combat.statusTitle', { name: t(`status.${effect.id}`), stacks: effect.stacks, turns: effect.turnsLeft });
      if (removable) {
        badge.type = 'button';
        badge.title += ` — ${t('combat.statusRemove')}`;
        badge.addEventListener('click', () => removable(effect.id));
      }
      wrap.append(badge);
    }
    return wrap;
  }

  function statusPicker(onApply, labelKey) {
    const row = document.createElement('div');
    row.className = 'status-picker';
    const select = document.createElement('select');
    select.setAttribute('aria-label', t('combat.statusPick'));
    for (const id of STATUS_IDS) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = `${STATUS_ICONS[id]} ${t(`status.${id}`)}`;
      select.append(option);
    }
    row.append(select, button(t(labelKey), () => onApply(select.value)));
    return row;
  }

  // Plano do ataque da vez: tipo e status escolhidos antes de rolar.
  let plan = { key: '', type: 'physical', status: '' };
  function currentPlan() {
    const key = `${view?.currentId}:${view?.round}`;
    if (plan.key !== key) {
      plan = { key, type: 'physical', status: '' };
    }
    return plan;
  }
  const ATTACK_SKILL = { physical: 'luta', pierce: 'pontaria', magic: 'magia' };
  function attackNotation(current, type) {
    if (current?.isBoss) {
      return withBonus(current.boss?.skills?.[ATTACK_SKILL[type]] || 0);
    }
    const sheet = getSheet();
    if (!sheet) {
      return withBonus(0);
    }
    // Perícia de ataque de cada sistema (D&D: modificador de Força ou Destreza).
    const system = sheet.system || 'abismo';
    if (system === 'dnd') {
      const score = sheet.attributes?.[type === 'pierce' ? 'dex' : 'str']?.value ?? 10;
      return withBonus(Math.floor((score - 10) / 2));
    }
    const skill = ({ ordem: { magic: 'ocultismo' }, tormenta: { magic: 'misticismo' } }[system] || {})[type] || ATTACK_SKILL[type];
    return systemTestNotation(sheet, skill, skillTest(sheet, skill));
  }

  // Teste do próprio jogador no sistema dele (Ordem rola o atributo em d20).
  function ownTest(skill, bonus) {
    const sheet = getSheet();
    return sheet ? systemTestNotation(sheet, skill, bonus) : withBonus(bonus);
  }

  function attackPlanner(current) {
    const chosen = currentPlan();
    const wrap = document.createElement('div');
    wrap.className = 'attack-planner';
    const types = document.createElement('div');
    types.className = 'segmented attack-types';
    types.setAttribute('role', 'group');
    types.setAttribute('aria-label', t('combat.attackType'));
    for (const type of ['physical', 'magic', 'pierce']) {
      const option = button(t(`kind.${type}`), () => {
        chosen.type = type;
        render();
      }, '');
      option.setAttribute('aria-pressed', String(chosen.type === type));
      types.append(option);
    }
    const status = document.createElement('select');
    status.setAttribute('aria-label', t('combat.statusPick'));
    status.append(new Option(t('combat.noStatus'), ''));
    for (const id of STATUS_IDS) {
      status.append(new Option(`${STATUS_ICONS[id]} ${t(`status.${id}`)}`, id));
    }
    status.value = chosen.status;
    status.addEventListener('change', () => { chosen.status = status.value; });
    const notation = attackNotation(current, chosen.type);
    const roll = button(t('combat.rollButton', { what: t('effect.attack'), notation }),
      () => rollNotation(notation, { kind: 'attack', damageType: chosen.type, statusId: abismoTable() ? chosen.status || null : null }), 'combat-button is-primary');
    // Status de dano são regra do Abismo: em outros sistemas a escolha não aparece.
    wrap.append(...[types, abismoTable() ? status : null, roll].filter(Boolean));
    if (chosen.type === 'magic') {
      wrap.append(span('attack-hint', t('combat.magicHint')));
    }
    // Chefe na mão do mestre: arma principal (dano fixo) e habilidades prontas.
    if (current?.isBoss && current.boss) {
      wrap.append(bossButtons(current, true));
    }
    return wrap;
  }

  function bossPowerUsable(boss, power) {
    return power.eaCost <= boss.ea && power.cooldownLeft <= 0
      && !(power.usesPerTurn > 0 && power.usedThisTurn >= power.usesPerTurn)
      && !(power.maxUses > 0 && power.usedTotal >= power.maxUses);
  }

  function bossButtons(current, attacks) {
    const boss = current.boss;
    const row = document.createElement('div');
    row.className = 'boss-actions-row';
    if (attacks && (boss.weaponName || boss.weaponDamage > 0)) {
      const skill = { magic: 'magia', pierce: 'pontaria' }[boss.weaponType] || 'luta';
      const notation = withBonus(boss.skills?.[skill] || 0);
      row.append(button(`⚔ ${boss.weaponName || t('boss.weapon')} (${boss.weaponDamage})`,
        () => rollNotation(notation, { kind: 'attack', abilityId: 'weapon', damageType: boss.weaponType }), 'combat-button'));
    }
    for (const power of boss.powers || []) {
      if ((power.kind === 'recovery') === attacks) {
        continue;
      }
      const label = `${power.statusId ? `${STATUS_ICONS[power.statusId]} ` : ''}${power.name}${power.eaCost ? ` · ${power.eaCost} EA` : ''}`;
      const element = attacks
        ? button(label, () => rollNotation(withBonus(boss.skills?.[power.skill] || 0), { kind: 'attack', abilityId: power.id, damageType: power.kind }), 'combat-button')
        : button(label, () => run('BossRecover', power.id), 'combat-button');
      element.disabled = !bossPowerUsable(boss, power);
      element.title = `${power.notation}${power.maxUses ? ` · ${t('boss.usesTotal', { used: power.usedTotal, max: power.maxUses })}` : ''}${power.cooldownLeft > 1 ? ` · ⏳${power.cooldownLeft - 1}` : ''}`;
      row.append(element);
    }
    return row;
  }

  function remaining() {
    if (!view?.deadline) {
      return '';
    }
    const seconds = Math.max(0, Math.ceil((view.deadline - Date.now()) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  // O que fazer agora (texto e botões), conforme o passo e quem é você.
  function prompt() {
    const line = document.createElement('div');
    line.className = 'combat-prompt';
    const actions = document.createElement('div');
    actions.className = 'combat-actions';
    let text = '';

    if (view.paused) {
      text = t('combat.paused');
    } else if (view.phase === 'initiative') {
      const me = mine();
      const pending = view.fighters.filter((candidate) => candidate.initiative === null || candidate.initiative === undefined);
      if (me && (me.initiative === null || me.initiative === undefined)) {
        text = t('combat.rollInitiative');
        const notation = initiativeNotation();
        actions.append(button(t('combat.rollButton', { what: t('effect.initiative'), notation }), () => rollNotation(notation)));
      } else {
        text = t('combat.waitingInitiative', { done: view.fighters.length - pending.length, total: view.fighters.length });
      }
      if (isMaster()) {
        for (const boss of pending.filter((candidate) => candidate.isBoss)) {
          actions.append(button(t('combat.bossInitiative', { name: boss.name }), () => rollNotation('1d20', { kind: 'initiative', effectTargetId: boss.id })));
        }
        actions.append(button(t('combat.begin'), () => run('BeginTurns'), 'combat-button is-primary'));
      }
    } else {
      const current = fighter(view.currentId);
      const target = fighter(view.targetId);
      const counter = fighter(view.counterId);
      const autoBoss = (entry) => Boolean(entry?.isBoss && entry.boss?.auto);
      if (current && autoBoss(current) && view.step !== 'reflex' && view.step !== 'counter') {
        // Chefe automático: o servidor joga por ele.
        text = t('combat.bossAuto', { name: current.name });
      } else if (view.step === 'counter' && counter && autoBoss(counter)) {
        text = t('combat.counterOther', { actor: counter.name, target: current?.name || '' });
      } else if (view.step === 'reflex' && target && autoBoss(target)) {
        text = t('combat.bossDefending', { name: target.name });
      } else if (view.step === 'counter' && counter) {
        // Crítico na defesa: quem defendeu contra-ataca, sem defesa do atacante.
        if (controls(counter)) {
          text = t('combat.counterYou', { target: current?.name || '' });
          for (const type of ['physical', 'magic', 'pierce']) {
            actions.append(button(t(`kind.${type}`), () => selectDamage(type)));
          }
        } else {
          text = t('combat.counterOther', { actor: counter.name, target: current?.name || '' });
        }
      } else if (view.step === 'reflex' && target && controls(target)) {
        text = t('combat.underAttack', { actor: current?.name || '', total: view.attackTotal, target: target.name });
        const notation = target.isBoss ? withBonus(target.reflex) : ownTest('reflexos', target.reflex);
        actions.append(button(t('combat.rollButton', { what: t('skill.reflexos'), notation }), () => rollNotation(notation, { kind: 'reflex' }), 'combat-button is-primary'));
      } else if (controls(current)) {
        if (view.step === 'damage') {
          // O tipo já foi escolhido antes do ataque; o status (se tiver) entra junto.
          const extras = [t(`kind.${view.attackType}`)];
          if (view.critical) {
            extras.push(t(view.attackType === 'magic' ? 'combat.critMagic' : 'combat.critPhysical'));
          }
          if (view.pendingStatusId) {
            extras.push(`${STATUS_ICONS[view.pendingStatusId] || ''} ${t(`status.${view.pendingStatusId}`)}`);
          }
          text = t('combat.hitRollDamage', { target: target?.name || '', details: extras.join(' · ') });
          if (view.abilityNotation) {
            const notation = view.abilityNotation;
            actions.append(button(t('combat.rollButton', { what: view.abilityName || t('effect.damage'), notation }),
              () => rollNotation(notation, { kind: 'damage', damageType: view.attackType, manaCost: 0 }), 'combat-button is-primary'));
          } else {
            actions.append(button(t('combat.rollDamage'), () => selectDamage(view.attackType), 'combat-button is-primary'));
          }
        } else if (view.step === 'reflex') {
          text = t('combat.waitingReflex', { target: target?.name || '', total: view.attackTotal });
        } else if (!target) {
          text = t(current.isBoss ? 'combat.bossTurn' : 'combat.yourTurn', { name: current.name });
          if (current.isBoss && current.boss?.powers?.some((power) => power.kind === 'recovery')) {
            actions.append(bossButtons(current, false));
          }
        } else if (target.down) {
          text = t('combat.rescue', { target: target.name, dt: target.dt });
          const notation = current.isBoss ? withBonus(current.medicine) : ownTest('medicina', current.medicine);
          actions.append(button(t('combat.rollButton', { what: t('skill.medicina'), notation }), () => rollNotation(notation, { kind: 'medicine' }), 'combat-button is-primary'));
        } else {
          // Antes de rolar: tipo do ataque (magia não deixa o alvo se defender) e status.
          text = t('combat.planAttack', { target: target.name });
          actions.append(attackPlanner(current));
        }
        if (view.step === 'act') {
          actions.append(button(t('combat.pass'), () => run('PassTurn')));
        }
      } else if (current) {
        text = view.step === 'reflex'
          ? t('combat.othersReflex', { actor: current.name, target: target?.name || '' })
          : t('combat.turnOf', { name: current.name });
        if (isMaster()) {
          actions.append(button(t('combat.passFor', { name: current.name }), () => run('PassTurn')));
        }
      }
    }
    line.append(span('combat-prompt-text', text), actions);
    return line;
  }

  function chip(entry) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'combat-chip';
    element.classList.toggle('is-current', entry.id === view.currentId);
    element.classList.toggle('is-target', entry.id === view.targetId);
    element.classList.toggle('is-down', entry.down);
    element.classList.toggle('is-dead', entry.dead || entry.defeated);
    element.classList.toggle('is-boss', entry.isBoss);
    const current = fighter(view.currentId);
    const canChoose = view.phase === 'turns' && !view.paused && view.step === 'act' && controls(current)
      && entry.id !== view.currentId && !entry.dead && !entry.defeated && (!entry.down || !entry.isBoss);
    element.disabled = !canChoose;
    element.title = canChoose ? t(entry.down ? 'combat.chooseRescue' : 'combat.chooseTarget', { name: entry.name }) : entry.name;
    if (canChoose) {
      element.addEventListener('click', () => run('ChooseTarget', entry.id));
    }
    const name = span('combat-chip-name', entry.name);
    const meta = span('combat-chip-meta', '');
    if (view.phase === 'initiative') {
      meta.textContent = entry.initiative === null || entry.initiative === undefined ? '…' : String(entry.initiative);
    } else if (entry.dead) {
      meta.textContent = t('combat.dead');
    } else if (entry.down) {
      const dots = entry.lastChance ? t('combat.lastChance') : '●'.repeat(entry.chances) + '○'.repeat(Math.max(0, 3 - entry.chances));
      meta.textContent = `${t('combat.dt', { dt: entry.dt })} ${dots}`;
    } else {
      meta.textContent = `${entry.hp}/${entry.hpMax}`;
    }
    const bar = document.createElement('i');
    bar.className = 'combat-chip-bar';
    bar.style.width = `${entry.hpMax > 0 ? Math.max(0, Math.min(100, (entry.hp / entry.hpMax) * 100)) : 0}%`;
    element.append(name, meta, bar);
    if (entry.statuses?.length) {
      element.append(statusBadges(entry.statuses));
    }
    return element;
  }

  // Ferramentas do mestre: ordem, chefes, piedade e reviver.
  function masterTools() {
    const details = document.createElement('details');
    details.className = 'combat-master';
    details.open = bar.querySelector('.combat-master')?.open || false;
    const summary = document.createElement('summary');
    summary.textContent = t('combat.manage');
    details.append(summary);

    const list = document.createElement('ol');
    list.className = 'combat-order';
    view.fighters.forEach((entry, index) => {
      const item = document.createElement('li');
      item.append(span('combat-order-name', `${entry.name}${entry.initiative !== null && entry.initiative !== undefined ? ` · ${entry.initiative}` : ''}`));
      // Chefe: EA, ações, automático (liga e desliga a qualquer hora) e como escolhe alvos.
      if (entry.isBoss && entry.boss) {
        const boss = entry.boss;
        item.append(span('combat-boss-info', [
          boss.eaMax ? `${t('boss.ea')} ${boss.ea}/${boss.eaMax}` : '',
          boss.actions > 1 ? t('boss.actionsLeft', { left: boss.actionsLeft, total: boss.actions }) : '',
        ].filter(Boolean).join(' · ')));
        const auto = button(t(boss.auto ? 'boss.autoOn' : 'boss.autoOff'), () => run('SetBossAuto', entry.id, !boss.auto), 'text-button boss-auto');
        auto.setAttribute('aria-pressed', String(boss.auto));
        const targeting = document.createElement('select');
        targeting.setAttribute('aria-label', t('boss.targeting'));
        targeting.append(new Option(t('boss.targetRandom'), 'random'), new Option(t('boss.targetAvoidWeak'), 'avoidWeak'));
        targeting.value = boss.targeting;
        targeting.addEventListener('change', () => run('SetBossTargeting', entry.id, targeting.value));
        item.append(auto, targeting);
      }
      const move = (offset) => {
        const ids = view.fighters.map((candidate) => candidate.id);
        const [moved] = ids.splice(index, 1);
        ids.splice(index + offset, 0, moved);
        run('ReorderCombat', ids);
      };
      const up = button('↑', () => move(-1), 'text-button');
      up.disabled = index === 0;
      up.setAttribute('aria-label', t('combat.moveUp'));
      const down = button('↓', () => move(1), 'text-button');
      down.disabled = index === view.fighters.length - 1;
      down.setAttribute('aria-label', t('combat.moveDown'));
      item.append(up, down);
      if (entry.down && !entry.dead) {
        item.append(button(t('combat.mercy'), () => run('Mercy', entry.id), 'text-button is-mercy'));
      }
      if (entry.dead) {
        item.append(button(t('combat.revive'), () => run('Revive', entry.id), 'text-button'));
      }
      if (entry.statuses?.length) {
        item.append(statusBadges(entry.statuses, (statusId) => run('RemoveStatus', entry.id, statusId)));
      }
      const remove = button('×', () => run('RemoveFighter', entry.id), 'text-button');
      remove.setAttribute('aria-label', t('combat.remove', { name: entry.name }));
      item.append(remove);
      list.append(item);
    });

    const form = document.createElement('form');
    form.className = 'combat-boss-form';
    const field = (key, type, value, attributes = {}) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = type;
      input.value = value;
      Object.assign(input, attributes);
      label.append(span('', t(key)), input);
      return { label, input };
    };
    const bossName = field('combat.bossName', 'text', '', { maxLength: 30, required: true });
    const bossHp = field('combat.bossHp', 'number', '100', { min: 1, max: 9999 });
    const bossReflex = field('combat.bossReflex', 'number', '0', { min: -99, max: 99 });
    const resistPhysical = field('resist.physical', 'number', '0', { min: 0, max: 999 });
    const resistMagic = field('resist.magic', 'number', '0', { min: 0, max: 999 });
    const resistPierce = field('resist.pierce', 'number', '0', { min: 0, max: 999 });
    form.append(bossName.label, bossHp.label, bossReflex.label, resistPhysical.label, resistMagic.label, resistPierce.label,
      button(t('combat.addBoss'), () => {}, 'combat-button'));
    form.lastChild.type = 'submit';
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const number = (input) => Number.parseInt(input.value, 10) || 0;
      run('AddBoss', {
        name: bossName.input.value.trim(),
        hp: number(bossHp.input),
        reflexBonus: number(bossReflex.input),
        resistPhysical: number(resistPhysical.input),
        resistMagic: number(resistMagic.input),
        resistPierce: number(resistPierce.input),
      });
    });

    const controlsRow = document.createElement('div');
    controlsRow.className = 'combat-actions';
    if (view.phase === 'turns') {
      controlsRow.append(view.paused
        ? button(t('combat.resume'), () => run('ResumeCombat'), 'combat-button is-primary')
        : button(t('combat.pause'), () => run('PauseCombat')));
    }
    controlsRow.append(button(t('combat.end'), () => run('EndCombat'), 'combat-button is-danger'));
    // Aplicar status em qualquer um (o mestre não tem limite de stacks por ação).
    const statusRow = document.createElement('div');
    statusRow.className = 'combat-status-row';
    const who = document.createElement('select');
    who.setAttribute('aria-label', t('combat.statusWho'));
    for (const entry of view.fighters.filter((candidate) => !candidate.dead)) {
      const option = document.createElement('option');
      option.value = entry.id;
      option.textContent = entry.name;
      who.append(option);
    }
    statusRow.append(span('combat-status-label', t('combat.statusFor')), who,
      statusPicker((statusId) => run('ApplyStatus', who.value, statusId), 'combat.applyStatus'));
    details.append(...[list, abismoTable() ? statusRow : null, form, controlsRow].filter(Boolean));
    return details;
  }

  function render() {
    room = getRoom();
    startButton.hidden = !(room?.code && room.isMaster && !view);
    bar.hidden = !view;
    updateSeats();
    if (!view) {
      bar.replaceChildren();
      return;
    }
    const head = document.createElement('div');
    head.className = 'combat-head';
    head.append(
      span('combat-title', t('combat.title')),
      span('combat-round', view.phase === 'initiative' ? t('combat.initiativePhase') : t('combat.round', { round: view.round })),
      span('combat-timer', view.phase === 'turns' ? remaining() : ''));
    if (view.paused) {
      head.append(span('badge badge-warm', t('combat.pausedBadge')));
    }
    const order = document.createElement('div');
    order.className = 'combat-chips';
    order.append(...view.fighters.map(chip));
    const event = span('combat-event', feedback || [eventText(view.lastEvent), ticksText()].filter(Boolean).join(' — '));
    bar.replaceChildren(head, order, prompt(), event);
    if (isMaster()) {
      // Aviso só para o mestre, e só com algum chefe no automático.
      if (view.fighters.some((entry) => entry.boss?.auto)) {
        bar.append(span('combat-auto-warning', t('boss.tpkWarning')));
      }
      bar.append(masterTools());
    }
  }

  // Destaca na mesa quem está na vez e quem é o alvo.
  function updateSeats() {
    for (const seat of document.querySelectorAll('.player-seat')) {
      seat.classList.remove('is-turn', 'is-target');
      seat.querySelector('.seat-conditions')?.remove();
    }
    // Ícones dos status ao lado do nome, na mesa de cada jogador.
    for (const entry of view?.fighters || []) {
      const seat = entry.playerId ? seatFor(entry.playerId) : null;
      if (seat && entry.statuses?.length) {
        const badges = statusBadges(entry.statuses);
        badges.classList.add('seat-conditions');
        seat.querySelector('.seat-details')?.append(badges);
      }
    }
    if (!view || view.phase !== 'turns') {
      return;
    }
    const current = fighter(view.currentId);
    const target = fighter(view.targetId);
    if (current?.playerId) {
      seatFor(current.playerId)?.classList.add('is-turn');
    }
    if (target?.playerId) {
      seatFor(target.playerId)?.classList.add('is-target');
    }
  }

  // Som quando chega a sua vez ou quando você precisa reagir.
  function alertIfNeeded() {
    if (!view || view.paused || view.phase !== 'turns') {
      lastAlertKey = '';
      return;
    }
    const current = fighter(view.currentId);
    const target = fighter(view.targetId);
    const key = view.step === 'reflex' && controls(target) ? `reflex:${view.targetId}:${view.attackTotal}`
      : controls(current) && view.step === 'act' ? `turn:${view.currentId}:${view.round}` : '';
    if (key && key !== lastAlertKey) {
      playTurn();
    }
    lastAlertKey = key;
  }

  // Ao encerrar, o resumo aparece em cima das mesas até alguém fechar.
  const summaryBox = document.querySelector('#combat-summary-box');
  window.addEventListener('room-chat', (event) => {
    const summary = event.detail?.summary;
    if (!summary) {
      return;
    }
    const close = button('×', () => { summaryBox.hidden = true; summaryBox.replaceChildren(); }, 'text-button combat-summary-close');
    close.setAttribute('aria-label', t('settings.close'));
    summaryBox.replaceChildren(close, summaryCard(summary));
    summaryBox.hidden = false;
  });
  window.addEventListener('room-state', (event) => {
    if (!event.detail?.code) {
      summaryBox.hidden = true;
    }
  });

  startButton.addEventListener('click', () => {
    summaryBox.hidden = true;
    run('StartCombat');
  });
  window.addEventListener('room-combat', (event) => {
    view = event.detail || null;
    feedback = '';
    render();
    alertIfNeeded();
  });
  window.addEventListener('room-state', (event) => {
    if (!event.detail?.code) {
      view = null;
    }
    render();
  });
  window.addEventListener('languagechange-app', render);
  setInterval(() => {
    const timer = bar.querySelector('.combat-timer');
    if (timer && view?.phase === 'turns') {
      timer.textContent = view.paused ? '' : remaining();
    }
  }, 1000);

  return {
    // O que a próxima rolagem significa no combate (ou null: rolagem normal).
    rollEffect() {
      if (!view || view.paused) {
        return null;
      }
      room = getRoom();
      if (view.phase === 'initiative') {
        const me = mine();
        if (me && (me.initiative === null || me.initiative === undefined)) {
          return { kind: 'initiative' };
        }
        const boss = isMaster() && view.fighters.find((candidate) => candidate.isBoss && (candidate.initiative === null || candidate.initiative === undefined));
        return boss ? { kind: 'initiative', effectTargetId: boss.id } : null;
      }
      const current = fighter(view.currentId);
      const target = fighter(view.targetId);
      if (view.step === 'reflex' && controls(target)) {
        return { kind: 'reflex' };
      }
      if (controls(current) && view.step === 'act' && target) {
        if (target.down) {
          return { kind: 'medicine' };
        }
        const chosen = currentPlan();
        return { kind: 'attack', damageType: chosen.type, statusId: abismoTable() ? chosen.status || null : null };
      }
      return null;
    },
    // Na hora do dano (ou do contra-ataque), a rolagem tem que ser de dano.
    needsDamageType() {
      room = getRoom();
      if (!view || view.paused || view.phase !== 'turns') {
        return false;
      }
      return (view.step === 'damage' && controls(fighter(view.currentId)))
        || (view.step === 'counter' && controls(fighter(view.counterId)));
    },
    // Para as habilidades no rolador: se está em combate, se é a sua vez de agir e
    // se já escolheu um alvo inimigo; usos e recarga de cada habilidade.
    powerState() {
      room = getRoom();
      const me = mine();
      const active = Boolean(view && view.phase === 'turns' && !view.paused && me);
      const current = fighter(view?.currentId);
      const target = fighter(view?.targetId);
      return {
        inCombat: active,
        myTurnAct: active && current?.id === me.id && view.step === 'act',
        targetEnemy: Boolean(target && !target.down),
        cooldowns: me?.powerCooldowns || {},
        uses: me?.powerUses || {},
      };
    },
    refreshSeats: updateSeats,
  };
}
