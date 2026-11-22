// Chat da sala, numa aba ao lado do histórico. A conversa fica guardada no servidor
// enquanto a sala existir: quem sai e volta recebe tudo de novo ao entrar.
import { t, errorText, formatTime } from './i18n.js';

const MAX_MESSAGES = 200;
// Mensagens seguidas da mesma pessoa, com menos que isso entre elas, não repetem o nome.
const GROUP_WINDOW_MS = 3 * 60 * 1000;

export function initChat(manager) {
  const historyTab = document.querySelector('#side-tab-history');
  const chatTab = document.querySelector('#side-tab-chat');
  const historyPane = document.querySelector('#history-pane');
  const chatPane = document.querySelector('#chat-pane');
  const clearHistory = document.querySelector('#clear-history');
  const unread = document.querySelector('#chat-unread');
  const list = document.querySelector('#chat-list');
  const empty = document.querySelector('#chat-empty');
  const form = document.querySelector('#chat-form');
  const input = document.querySelector('#chat-input');
  const feedback = document.querySelector('#chat-feedback');

  let roomCode = '';
  let myPlayerId = '';
  let messages = [];
  let activeTab = 'history';

  function selectTab(tab) {
    activeTab = tab;
    const chat = tab === 'chat';
    historyTab.setAttribute('aria-selected', String(!chat));
    chatTab.setAttribute('aria-selected', String(chat));
    historyPane.hidden = chat;
    chatPane.hidden = !chat;
    clearHistory.hidden = chat;
    if (chat) {
      unread.hidden = true;
      scrollToEnd();
    }
  }

  function scrollToEnd() {
    list.scrollTop = list.scrollHeight;
  }

  function isNearEnd() {
    return list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  }

  function validMessage(message) {
    return message && typeof message.id === 'string' && typeof message.text === 'string'
      && typeof message.name === 'string' && Number.isFinite(message.timestamp);
  }

  function render() {
    list.replaceChildren();
    empty.hidden = messages.length > 0;
    let previous = null;
    for (const message of messages) {
      const item = document.createElement('li');
      item.className = 'chat-message';
      item.classList.toggle('is-mine', message.playerId === myPlayerId);
      const grouped = previous && previous.playerId === message.playerId
        && message.timestamp - previous.timestamp < GROUP_WINDOW_MS;
      if (!grouped) {
        const head = document.createElement('div');
        const name = document.createElement('strong');
        const time = document.createElement('time');
        head.className = 'chat-head';
        name.className = 'chat-name';
        name.textContent = message.name;
        if (message.color) {
          name.dataset.color = message.color;
        } else {
          name.classList.add('is-spectator');
        }
        const date = new Date(message.timestamp);
        time.dateTime = date.toISOString();
        time.textContent = formatTime(date);
        head.append(name, time);
        item.append(head);
      } else {
        item.classList.add('is-grouped');
      }
      const text = document.createElement('p');
      text.className = 'chat-text';
      text.textContent = message.text;
      item.append(text);
      list.append(item);
      previous = message;
    }
  }

  function merge(incoming) {
    const byId = new Map(messages.map((message) => [message.id, message]));
    for (const message of incoming) {
      if (validMessage(message)) {
        byId.set(message.id, message);
      }
    }
    messages = [...byId.values()].sort((left, right) => left.timestamp - right.timestamp).slice(-MAX_MESSAGES);
  }

  window.addEventListener('room-state', (event) => {
    const room = event.detail || {};
    myPlayerId = room.myPlayerId || '';
    chatTab.hidden = !room.code;
    if (room.code !== roomCode) {
      roomCode = room.code || '';
      messages = [];
      unread.hidden = true;
      feedback.textContent = '';
      render();
      if (!roomCode) {
        selectTab('history');
      }
    }
  });

  window.addEventListener('room-chat-history', (event) => {
    const stick = isNearEnd();
    merge(Array.isArray(event.detail) ? event.detail : []);
    render();
    if (stick || activeTab !== 'chat') {
      scrollToEnd();
    }
  });

  window.addEventListener('room-chat', (event) => {
    const message = event.detail;
    if (!validMessage(message)) {
      return;
    }
    const stick = isNearEnd();
    merge([message]);
    render();
    if (activeTab !== 'chat' && message.playerId !== myPlayerId) {
      unread.hidden = false;
    }
    if (stick || message.playerId === myPlayerId) {
      scrollToEnd();
    }
  });

  historyTab.addEventListener('click', () => selectTab('history'));
  chatTab.addEventListener('click', () => {
    selectTab('chat');
    input.focus();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) {
      return;
    }
    input.disabled = true;
    feedback.textContent = '';
    try {
      await manager.sendChat(text);
      input.value = '';
    } catch (error) {
      feedback.textContent = errorText(error, 'chat.failed');
    } finally {
      input.disabled = false;
      input.focus();
    }
  });

  window.addEventListener('languagechange-app', render);
  render();
}
