// Tipo da rolagem no rolador: normal, dano (físico, mágico ou de perfuração) ou
// recuperação (poção de vida ou de mana, em você ou em outro jogador). Só aparece
// para quem está numa sala com conta. Depois de cada rolagem volta para "Normal".
import { t } from './i18n.js';
import { currentAccount, onAccountChange } from './account.js';
import { sheetLabel } from './sheet.js';

const DAMAGE = ['physical', 'magic', 'pierce'];

export function initRollKind({ getRoom, getSheet }) {
  const $ = (selector) => document.querySelector(selector);
  const controls = $('#roll-kind-controls');
  const kind = $('#roll-kind');
  const recoverStat = $('#recover-stat');
  const effectTarget = $('#effect-target');
  const manaField = $('#mana-cost-field');
  const mana = $('#mana-cost');

  function update() {
    const room = getRoom();
    // O mestre vê sempre (controla os chefes no combate, mesmo sem conta).
    const visible = Boolean(room?.code && !room.isSpectator && (currentAccount() || room.isMaster));
    controls.hidden = !visible;
    if (!visible) {
      return;
    }
    // Nomes das barras do sistema da ficha (Abismo: Vida e EA; Ordem: PV e PE...).
    const sheet = getSheet();
    if (sheet && (sheet.system || 'abismo') !== 'abismo') {
      recoverStat.querySelector('[value="hp"]').textContent = sheetLabel(sheet, 'stat.hp');
      recoverStat.querySelector('[value="ea"]').textContent = sheetLabel(sheet, 'stat.ea');
      manaField.querySelector('span').textContent = sheetLabel(sheet, 'stat.ea').toUpperCase();
    } else {
      recoverStat.querySelector('[value="hp"]').textContent = t('kind.hp');
      recoverStat.querySelector('[value="ea"]').textContent = t('kind.ea');
      manaField.querySelector('span').textContent = t('kind.manaCost');
    }
    const recovery = kind.value === 'recovery';
    recoverStat.hidden = !recovery;
    effectTarget.hidden = !recovery;
    manaField.hidden = kind.value !== 'magic';

    // Poção: em você ou em outro jogador da mesa que tenha ficha.
    const previous = effectTarget.value;
    effectTarget.replaceChildren();
    const self = document.createElement('option');
    self.value = '';
    self.textContent = t('kind.onMe');
    effectTarget.append(self);
    for (const player of room.players || []) {
      if (player.id !== room.myPlayerId && player.status) {
        const option = document.createElement('option');
        option.value = player.id;
        option.textContent = t('kind.onPlayer', { name: player.characterName || player.name });
        effectTarget.append(option);
      }
    }
    effectTarget.value = [...effectTarget.options].some((option) => option.value === previous) ? previous : '';
  }

  kind.addEventListener('change', () => {
    update();
    if (kind.value === 'magic') {
      mana.focus();
      mana.select();
    }
  });

  window.addEventListener('room-state', update);
  window.addEventListener('languagechange-app', update);
  onAccountChange(update);

  return {
    update,
    // O que vai junto com a rolagem. Erro (com chave de texto) se faltar algo.
    read() {
      if (controls.hidden || kind.value === 'normal') {
        return { kind: 'normal' };
      }
      const sheet = getSheet();
      if (!sheet) {
        // Sem ficha (ex.: o mestre rolando pelo chefe): dano sem gastar EA.
        if (DAMAGE.includes(kind.value)) {
          return { kind: 'damage', damageType: kind.value, manaCost: 0 };
        }
        throw new Error('kind.needSheet');
      }
      if (kind.value === 'recovery') {
        return { kind: 'recovery', recoverStat: recoverStat.value, effectTargetId: effectTarget.value || null };
      }
      if (DAMAGE.includes(kind.value)) {
        let manaCost = 0;
        if (kind.value === 'magic') {
          manaCost = Number.parseInt(mana.value, 10) || 0;
          if (manaCost < 0) {
            throw new Error('kind.manaInvalid');
          }
          if (manaCost > (sheet.ea?.current || 0)) {
            throw new Error('kind.notEnoughMana');
          }
        }
        return { kind: 'damage', damageType: kind.value, manaCost };
      }
      return { kind: 'normal' };
    },
    // Rolagens rápidas da ficha escolhem o tipo sozinhas.
    select(quickKind) {
      const map = { test: 'normal', attack: 'normal', physical: 'physical', magic: 'magic', pierce: 'pierce', recovery: 'recovery' };
      kind.value = map[quickKind] || 'normal';
      update();
      return kind.value;
    },
    reset() {
      kind.value = 'normal';
      mana.value = '0';
      update();
    },
  };
}

// Texto curto do efeito de uma rolagem, para a mesa e o histórico.
export function describeEffect(roll, players = []) {
  const nameOf = (id) => {
    const player = players.find((candidate) => candidate.id === id);
    return player ? player.characterName || player.name : '';
  };
  if (roll.kind === 'recovery') {
    const stat = t(roll.recoverStat === 'ea' ? 'kind.ea' : 'kind.hp');
    const target = roll.effectTargetId && roll.effectTargetId !== roll.playerId ? nameOf(roll.effectTargetId) : '';
    const amount = Number.isFinite(roll.applied) ? `+${roll.applied} ` : '';
    return target ? t('effect.potionOn', { amount, stat, name: target }) : t('effect.potion', { amount, stat });
  }
  if (roll.kind === 'ability') {
    // Habilidade da ficha: nome e, se foi cura, quanto recuperou (e em quem).
    const parts = [`✦ ${roll.label || t('effect.ability')}`];
    if (Number.isFinite(roll.applied) && roll.recoverStat) {
      const stat = t(roll.recoverStat === 'ea' ? 'kind.ea' : 'kind.hp');
      const target = roll.effectTargetId && roll.effectTargetId !== roll.playerId ? nameOf(roll.effectTargetId) : '';
      parts.push(target ? `+${roll.applied} ${stat} · ${target}` : `+${roll.applied} ${stat}`);
    }
    return parts.join(' · ');
  }
  if (roll.kind === 'blind') {
    return t(roll.hidden ? 'effect.blindHidden' : 'effect.blind', { label: roll.label || '' });
  }
  if (['attack', 'reflex', 'initiative', 'medicine'].includes(roll.kind)) {
    return t(`effect.${roll.kind}`);
  }
  if (roll.kind === 'damage') {
    const type = t(`kind.${roll.damageType}`);
    return roll.manaCost > 0 ? `${type} · ${t('effect.mana', { mana: roll.manaCost })}` : type;
  }
  return '';
}
