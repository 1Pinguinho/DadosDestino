// Reações rápidas nas mesas: um emoji aparece sobre a mesa de um jogador, sobe
// flutuando e some, para todos da sala. Nada fica guardado.
import { t } from './i18n.js';

// A mesma lista do servidor (TableHub.Reactions).
export const REACTIONS = ['😂', '😮', '🔥', '💀', '👏', '❤️', '😱', '🎲'];
const MAX_FLOATING_PER_SEAT = 6;
const FLOAT_MS = 2400;

export function initReactions({ sendReaction, seatFor }) {
  let picker = null;

  function closePicker() {
    if (picker) {
      picker.element.remove();
      picker.button.setAttribute('aria-expanded', 'false');
      picker = null;
    }
  }

  function openPicker(button, seat, playerId) {
    const element = document.createElement('div');
    element.className = 'reaction-picker';
    element.setAttribute('role', 'group');
    element.setAttribute('aria-label', t('reaction.pick'));
    for (const emoji of REACTIONS) {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'reaction-option';
      option.textContent = emoji;
      option.addEventListener('click', () => {
        closePicker();
        sendReaction(playerId, emoji).catch(() => {
          // Sem conexão: a reação só não aparece.
        });
      });
      element.append(option);
    }
    seat.append(element);
    // Logo abaixo do botão, sem cobrir os botões da mesa (no celular eles quebram linha).
    const seatBox = seat.getBoundingClientRect();
    const buttonBox = button.getBoundingClientRect();
    element.style.top = `${Math.round(buttonBox.bottom - seatBox.top + 6)}px`;
    button.setAttribute('aria-expanded', 'true');
    picker = { element, button };
    element.querySelector('button')?.focus();
  }

  document.addEventListener('click', (event) => {
    if (picker && !event.target.closest('.reaction-picker, .seat-react')) {
      closePicker();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && picker) {
      const { button } = picker;
      closePicker();
      button.focus();
    }
  });

  window.addEventListener('room-reaction', (event) => {
    const reaction = event.detail || {};
    const seat = seatFor(reaction.targetPlayerId);
    if (!seat || !REACTIONS.includes(reaction.emoji)) {
      return;
    }
    const floating = seat.querySelectorAll('.reaction-float');
    if (floating.length >= MAX_FLOATING_PER_SEAT) {
      floating[0].remove();
    }
    const bubble = document.createElement('div');
    const emoji = document.createElement('span');
    const from = document.createElement('small');
    bubble.className = 'reaction-float';
    bubble.setAttribute('aria-hidden', 'true');
    // Cada reação sai num ponto um pouco diferente, para não ficarem empilhadas.
    bubble.style.setProperty('--reaction-x', `${18 + Math.random() * 64}%`);
    bubble.style.setProperty('--reaction-sway', `${Math.random() < 0.5 ? -1 : 1}`);
    emoji.className = 'reaction-emoji';
    emoji.textContent = reaction.emoji;
    from.className = 'reaction-from';
    from.textContent = String(reaction.from || '').slice(0, 22);
    bubble.append(emoji, from);
    seat.append(bubble);
    setTimeout(() => bubble.remove(), FLOAT_MS);
  });

  // Botão discreto no cabeçalho da mesa de outro jogador.
  return {
    button(playerId, seat) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'seat-action seat-react';
      button.setAttribute('aria-haspopup', 'true');
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-label', t('reaction.open'));
      button.title = t('reaction.open');
      button.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-smile" /></svg>';
      button.addEventListener('click', () => {
        const wasOpen = picker?.button === button;
        closePicker();
        if (!wasOpen) {
          openPicker(button, seat, playerId);
        }
      });
      return button;
    },
    close: closePicker,
  };
}
