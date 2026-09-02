import { computed, onBeforeUnmount, ref } from 'vue';
import type { ChatMessage, ChatSession, MessageRole } from '../protocol/types';

const STORAGE_KEY = 'agentbee.sessions.v2';
const DEFAULT_TITLE = 'New conversation';
const MAX_SAVE_ATTEMPTS = 12;
const MIN_MESSAGES_PER_SESSION = 6;
const SAVE_DEBOUNCE_MS = 650;

export function useSessions() {
  const sessions = ref<ChatSession[]>([]);
  const activeSessionId = ref<string | null>(null);
  let saveTimer: number | null = null;

  const activeSession = computed(() => (
    sessions.value.find((session) => session.id === activeSessionId.value) || sessions.value[0] || null
  ));

  function loadSessions() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      sessions.value = Array.isArray(saved) ? saved : [];
    } catch {
      sessions.value = [];
    }

    if (!sessions.value.length) {
      createSession(false);
    } else {
      activeSessionId.value = sessions.value[0].id;
    }
  }

  function saveSessions() {
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }

    let snapshot = normalizeSessionOrder(sessions.value);

    for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt += 1) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
        sessions.value = snapshot;
        if (!sessions.value.some((session) => session.id === activeSessionId.value)) {
          activeSessionId.value = sessions.value[0]?.id || null;
        }
        return;
      } catch (error) {
        if (!isStorageQuotaError(error)) {
          throw error;
        }

        const pruned = pruneOldestHistory(snapshot, activeSessionId.value);
        if (pruned === snapshot) {
          console.warn('BeeWeb local chat history is too large to save even after pruning.');
          return;
        }
        snapshot = pruned;
      }
    }

    sessions.value = snapshot;
    console.warn('BeeWeb local chat history save reached the pruning retry limit.');
  }

  function scheduleSaveSessions() {
    if (saveTimer !== null) return;
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      saveSessions();
    }, SAVE_DEBOUNCE_MS);
  }

  function createSession(save = true): ChatSession {
    const session: ChatSession = {
      id: makeId(),
      title: DEFAULT_TITLE,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    };
    sessions.value = [session, ...sessions.value];
    activeSessionId.value = session.id;
    if (save) saveSessions();
    return session;
  }

  function touchSession(session: ChatSession) {
    session.updatedAt = new Date().toISOString();
    sessions.value = [session, ...sessions.value.filter((item) => item.id !== session.id)];
    activeSessionId.value = session.id;
  }

  function setActiveSession(sessionId: string) {
    activeSessionId.value = sessionId;
  }

  function addMessage(role: MessageRole, content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
    const session = activeSession.value || createSession(false);
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

  function updateTitleFromMessage(session: ChatSession, text: string) {
    if (session.title !== DEFAULT_TITLE) return;
    const compact = text.replace(/\s+/g, ' ').trim();
    session.title = compact.slice(0, 24) || DEFAULT_TITLE;
  }

  onBeforeUnmount(() => {
    if (saveTimer === null) return;
    window.clearTimeout(saveTimer);
    saveTimer = null;
    saveSessions();
  });

  function updateMessageContent(messageId: string, content: string): ChatMessage | null {
    const session = activeSession.value;
    if (!session) return null;

    const message = session.messages.find((item) => item.id === messageId);
    if (!message || message.role !== 'user') return null;

    message.content = content;
    session.updatedAt = new Date().toISOString();
    saveSessions();
    return message;
  }

  function clearCurrentSession() {
    const session = activeSession.value;
    if (!session) return;
    session.messages = [];
    session.title = DEFAULT_TITLE;
    session.updatedAt = new Date().toISOString();
    saveSessions();
  }

  function deleteCurrentSession() {
    if (!activeSessionId.value) return;
    deleteSession(activeSessionId.value);
  }

  function deleteSession(sessionId: string) {
    if (!sessions.value.length) return;
    sessions.value = sessions.value.filter((session) => session.id !== sessionId);
    if (!sessions.value.length) {
      createSession(false);
    } else if (activeSessionId.value === sessionId) {
      activeSessionId.value = sessions.value[0].id;
    }
    saveSessions();
  }

  return {
    sessions,
    activeSessionId,
    activeSession,
    addMessage,
    clearCurrentSession,
    createSession,
    deleteCurrentSession,
    deleteSession,
    loadSessions,
    saveSessions,
    scheduleSaveSessions,
    setActiveSession,
    touchSession,
    updateMessageContent,
    updateTitleFromMessage,
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

function normalizeSessionOrder(items: ChatSession[]): ChatSession[] {
  return [...items].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function pruneOldestHistory(items: ChatSession[], activeId: string | null): ChatSession[] {
  const sessionsWithMessages = [...items]
    .filter((session) => session.messages.length > MIN_MESSAGES_PER_SESSION)
    .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));

  const messagePruneTarget = sessionsWithMessages.find((session) => session.id !== activeId)
    || sessionsWithMessages[0];

  if (messagePruneTarget) {
    return items.map((session) => {
      if (session.id !== messagePruneTarget.id) return session;
      const keepCount = Math.max(
        MIN_MESSAGES_PER_SESSION,
        Math.ceil(session.messages.length * 0.7),
      );

      return {
        ...session,
        messages: session.messages.slice(-keepCount),
      };
    });
  }

  if (items.length <= 1) return items;

  const removable = [...items]
    .filter((session) => session.id !== activeId)
    .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))[0];

  if (!removable) return items;
  return items.filter((session) => session.id !== removable.id);
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
