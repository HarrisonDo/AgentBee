import { onBeforeUnmount, ref } from 'vue';
import type { ChatMessage, ChatSession, MessageRole } from '../protocol/types';

const STORAGE_KEY = 'agentbee.session.v1';
const LEGACY_STORAGE_KEY = 'agentbee.sessions.v2';
const DEFAULT_TITLE = 'New conversation';
const MAX_SAVE_ATTEMPTS = 12;
const MAX_STORED_MESSAGES = 50;
const MIN_STORED_MESSAGES = 6;
const SAVE_DEBOUNCE_MS = 650;

export function useSessions() {
  const activeSession = ref<ChatSession>(createEmptySession());
  let saveTimer: number | null = null;
  let storageDisabled = false;

  function clearSaveTimer() {
    if (saveTimer === null) return;
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }

  function loadSessions() {
    clearSaveTimer();
    storageDisabled = false;
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
    activeSession.value = createEmptySession();
  }

  function saveSessions() {
    if (storageDisabled) return;
    clearSaveTimer();

    let snapshot = createStorageSnapshot(activeSession.value);

    for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt += 1) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
        return;
      } catch (error) {
        if (!isStorageQuotaError(error)) throw error;

        const pruned = pruneHistory(snapshot);
        if (pruned === snapshot) {
          console.warn('BeeWeb local chat history is too large to save even after pruning.');
          return;
        }
        snapshot = pruned;
      }
    }

    console.warn('BeeWeb local chat history save reached the pruning retry limit.');
  }

  function scheduleSaveSessions() {
    if (storageDisabled || saveTimer !== null) return;
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      saveSessions();
    }, SAVE_DEBOUNCE_MS);
  }

  function clearLocalHistory() {
    storageDisabled = true;
    clearSaveTimer();
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
    activeSession.value = createEmptySession();
  }

  function touchSession(session: ChatSession) {
    session.updatedAt = new Date().toISOString();
  }

  function addMessage(role: MessageRole, content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
    const session = activeSession.value;
    const message: ChatMessage = {
      id: makeId(),
      role,
      content: content || '',
      time: nowTime(),
      ...extra,
    };
    session.messages.push(message);
    touchSession(session);
    saveSessions();
    return message;
  }

  function updateMessageContent(messageId: string, content: string): ChatMessage | null {
    const message = activeSession.value.messages.find((item) => item.id === messageId);
    if (!message || message.role !== 'user') return null;

    message.content = content;
    activeSession.value.updatedAt = new Date().toISOString();
    saveSessions();
    return message;
  }

  onBeforeUnmount(() => {
    if (saveTimer === null) return;
    clearSaveTimer();
    saveSessions();
  });

  return {
    activeSession,
    addMessage,
    clearLocalHistory,
    loadSessions,
    saveSessions,
    scheduleSaveSessions,
    touchSession,
    updateMessageContent,
  };
}

export function makeId(): string {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function nowTime(): string {
  return new Date().toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
}

function createEmptySession(): ChatSession {
  const now = new Date().toISOString();
  return {
    id: makeId(),
    title: DEFAULT_TITLE,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

function createStorageSnapshot(session: ChatSession): ChatSession {
  return {
    ...session,
    messages: getStorableMessages(session.messages),
  };
}

function getStorableMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter((message) => !message.isRemoteHistory)
    .slice(-MAX_STORED_MESSAGES)
    .map(({ memoryCreateId: _memoryCreateId, isRemoteHistory: _isRemoteHistory, ...message }) => message);
}

function pruneHistory(session: ChatSession): ChatSession {
  if (session.messages.length <= MIN_STORED_MESSAGES) return session;
  const keepCount = Math.max(
    MIN_STORED_MESSAGES,
    Math.ceil(session.messages.length * 0.7),
  );
  return {
    ...session,
    messages: session.messages.slice(-keepCount),
  };
}

function isStorageQuotaError(error: unknown): boolean {
  if (!(error instanceof DOMException)) return false;
  return (
    error.name === 'QuotaExceededError' ||
    error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    error.code === 22 ||
    error.code === 1014
  );
}
