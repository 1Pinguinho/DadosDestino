// Combate com turnos: uma faixa fina em cima das mesas, só enquanto há combate.
// Mostra a rodada, de quem é a vez, a ordem e uma frase do que fazer agora. As
// rolagens continuam manuais: na sua vez, a próxima rolagem conta como ataque,
// Reflexos, Medicina ou iniciativa (os botões só preenchem e rolam por você).
import { t, errorText } from './i18n.js';
import { playTurn } from './sound.js';

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
    const agility = sheet?.attributes?.agl?.value || 0;
    return `1d20${agility ? (agility > 0 ? `+${agility}` : agility) : ''}`;
  }

  const withBonus = (bonus) => `1d20${bonus ? (bonus > 0 ? `+${bonus}` : bonus) : ''}`;

  function eventText(event) {
    if (!event) {
      return '';
    }
    const params = { actor: nameOf(event.actorId), target: nameOf(event.targetId), value: event.value ?? '' };
    const key = `combat.event.${event.type}`;
    const text = t(key, params);
    return text === key ? '' : text;
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
      if (view.step === 'reflex' && target && controls(target)) {
        text = t('combat.underAttack', { actor: current?.name || '', total: view.attackTotal, target: target.name });
        const notation = withBonus(target.reflex);
        actions.append(button(t('combat.rollButton', { what: t('skill.reflexos'), notation }), () => rollNotation(notation, { kind: 'reflex' }), 'combat-button is-primary'));
      } else if (controls(current)) {
        if (view.step === 'damage') {
          text = t('combat.hitChooseDamage', { target: target?.name || '' });
          for (const type of ['physical', 'magic', 'pierce']) {
            actions.append(button(t(`kind.${type}`), () => selectDamage(type)));
          }
        } else if (view.step === 'reflex') {
          text = t('combat.waitingReflex', { target: target?.name || '', total: view.attackTotal });
        } else if (!target) {
          text = t(current.isBoss ? 'combat.bossTurn' : 'combat.yourTurn', { name: current.name });
        } else if (target.down) {
          text = t('combat.rescue', { target: target.name, dt: target.dt });
          const notation = withBonus(current.medicine);
          actions.append(button(t('combat.rollButton', { what: t('skill.medicina'), notation }), () => rollNotation(notation, { kind: 'medicine' }), 'combat-button is-primary'));
        } else {
          text = t('combat.rollAttack', { target: target.name });
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
    details.append(list, form, controlsRow);
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
    const event = span('combat-event', feedback || eventText(view.lastEvent));
    bar.replaceChildren(head, order, prompt(), event);
    if (isMaster()) {
      bar.append(masterTools());
    }
  }

  // Destaca na mesa quem está na vez e quem é o alvo.
  function updateSeats() {
    for (const seat of document.querySelectorAll('.player-seat')) {
      seat.classList.remove('is-turn', 'is-target');
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

  startButton.addEventListener('click', () => run('StartCombat'));
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
        return { kind: target.down ? 'medicine' : 'attack' };
      }
      return null;
    },
    // Na hora do dano, quem atacou precisa escolher o tipo antes de rolar.
    needsDamageType() {
      room = getRoom();
      return Boolean(view && !view.paused && view.phase === 'turns' && view.step === 'damage' && controls(fighter(view.currentId)));
    },
    refreshSeats: updateSeats,
  };
}
