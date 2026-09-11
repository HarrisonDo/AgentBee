import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type {
  ChatAttachment,
  ChatMessage,
  ChatSession,
  ClientAttachment,
  ClientMessage,
  ClientSettingAct,
  ClientSystemAct,
  ServerMessage,
} from '../protocol/types';
import {
  getMessageId,
  getServerType,
  normalizePayload,
  normalizeServerError,
  normalizeImageEvent,
  normalizeFileEvent,
  normalizeToolEvent,
  parseServerMessage,
} from '../protocol/normalizers';
import { makeId, nowTime } from './useSessions';

const NO_RESPONSE_TIMEOUT_MS = 5 * 60_000;
const AUTO_CONNECT_WINDOW_MS = 60_000;
const AUTO_CONNECT_BASE_RETRY_MS = 1000;
const AUTO_CONNECT_MAX_RETRY_MS = 15_000;
const FOREGROUND_RECONNECT_THRESHOLD_MS = 30_000;
const STREAM_FLUSH_MS = 80;
const WS_TOKEN_STORAGE_KEY = 'agentbee.wsToken';

export type ConnectionIssueKind =
  | 'closed'
  | 'initialization'
  | 'invalid-url'
  | 'mixed-content'
  | 'network'
  | 'offline';

export interface ConnectionIssue {
  code?: number;
  detail?: string;
  kind: ConnectionIssueKind;
  occurredAt: number;
  reason?: string;
  url: string;
  wasClean?: boolean;
}

export type ConnectionState =
  | 'connected'
  | 'connecting'
  | 'idle'
  | 'offline'
  | 'paused'
  | 'retrying';

interface PendingStreamUpdate {
  content: string;
  think: string;
  message?: ServerMessage;
}

interface QueuedTextSend {
  attachments: ClientAttachment[];
  onDispatched?: (dispatched: boolean) => void;
  text: string;
}

interface UseWebSocketAgentOptions {
  activeSession: () => ChatSession | null;
  addMessage: (role: ChatMessage['role'], content: string, extra?: Partial<ChatMessage>) => ChatMessage;
  onSettingMessage?: (act: string, content: unknown, msg: ServerMessage) => void;
  onSystemMessage?: (act: string, content: unknown, msg: ServerMessage) => void;
  onMemoryMessage?: (act: string, msg: ServerMessage) => void;
  saveSessions: () => void;
  scheduleSaveSessions: () => void;
  touchSession: (session: ChatSession) => void;
}

export function useWebSocketAgent(options: UseWebSocketAgentOptions) {
  const wsUrl = ref(localStorage.getItem('agentbee.lastUrl') || 'ws://127.0.0.1:8686');
  const wsToken = ref(localStorage.getItem(WS_TOKEN_STORAGE_KEY) || '');
  const connected = ref(false);
  const connecting = ref(false);
  const connectionError = ref<ConnectionIssue | null>(null);
  const autoConnectPaused = ref(false);
  const retryScheduled = ref(false);
  const isOnline = ref(navigator.onLine);
  const pendingTurns = ref(new Map<string, string | null>());
  const socket = ref<WebSocket | null>(null);
  const noResponseTimers = new Map<string, number>();
  const pendingStreamUpdates = new Map<string, PendingStreamUpdate>();
  let streamFlushTimer: number | null = null;
  let autoRetryTimer: number | null = null;
  let manualDisconnect = false;
  let currentConnectIsAuto = false;
  let autoConnectAttempts = 0;
  let autoConnectStartedAt = 0;
  let reconnectAfterClose = false;
  let connectionRequested = false;
  let hiddenAt: number | null = null;
  let queuedTextSend: QueuedTextSend | null = null;

  const canSend = computed(() => connected.value && socket.value?.readyState === WebSocket.OPEN);
  const hasPendingTurns = computed(() => pendingTurns.value.size > 0);
  const connectionState = computed<ConnectionState>(() => {
    if (connected.value) return 'connected';
    if (!isOnline.value) return 'offline';
    if (connecting.value) return currentConnectIsAuto ? 'retrying' : 'connecting';
    if (retryScheduled.value) return 'retrying';
    if (autoConnectPaused.value) return 'paused';
    return 'idle';
  });

  function connect(automatic = false): boolean {
    if (
      socket.value &&
      (socket.value.readyState === WebSocket.OPEN || socket.value.readyState === WebSocket.CONNECTING)
    ) {
      if (!automatic) options.addMessage('system', 'A connection is already active.');
      return true;
    }

    const url = wsUrl.value.trim();
    const token = wsToken.value.trim();
    connectionRequested = true;
    manualDisconnect = false;
    connectionError.value = null;
    if (!automatic) {
      autoConnectPaused.value = false;
      autoConnectAttempts = 0;
      autoConnectStartedAt = 0;
    }
    const validationIssue = validateWebSocketUrl(url);
    if (validationIssue) {
      connectionError.value = validationIssue;
      options.addMessage('error', 'WebSocket URL must start with ws:// or wss://.');
      if (automatic) pauseAutoConnect('Auto connection stopped because the WebSocket URL is invalid. Waiting for manual connection.');
      return false;
    }

    if (!navigator.onLine) {
      isOnline.value = false;
      connecting.value = false;
      connectionError.value = makeConnectionIssue('offline', url);
      return true;
    }

    clearAutoRetryTimer();
    currentConnectIsAuto = automatic;
    connecting.value = true;
    options.addMessage('system', `Connecting to ${url}`);
    let nextSocket: WebSocket;
    try {
      nextSocket = createWebSocketConnection(url, token);
      socket.value = nextSocket;
    } catch (error) {
      connecting.value = false;
      connectionError.value = makeConnectionIssue(
        'initialization',
        url,
        error instanceof Error ? error.message : String(error),
      );
      socket.value = null;
      const detail = error instanceof Error ? ` ${error.message}` : '';
      options.addMessage('error', `WebSocket connection could not be initialized.${detail}`);
      if (automatic) pauseAutoConnect('Auto connection stopped because the WebSocket token is invalid. Waiting for manual connection.');
      return false;
    }

    nextSocket.onopen = () => {
      if (socket.value !== nextSocket) return;
      connected.value = true;
      connecting.value = false;
      connectionError.value = null;
      autoConnectPaused.value = false;
      retryScheduled.value = false;
      autoConnectAttempts = 0;
      autoConnectStartedAt = 0;
      localStorage.setItem('agentbee.lastUrl', url);
      if (token) {
        localStorage.setItem(WS_TOKEN_STORAGE_KEY, token);
      } else {
        localStorage.removeItem(WS_TOKEN_STORAGE_KEY);
      }
      options.addMessage('system', 'WebSocket connected.');
      flushQueuedTextSend();
    };

    nextSocket.onmessage = (event) => {
      if (socket.value !== nextSocket) return;
      if (typeof event.data === 'string') handleServerMessage(event.data);
    };

    nextSocket.onerror = () => {
      if (socket.value !== nextSocket) return;
      connectionError.value = makeConnectionIssue('network', url);
      if (!currentConnectIsAuto) {
        options.addMessage('error', 'WebSocket connection error. Waiting for close details.');
      }
    };

    nextSocket.onclose = (event) => {
      if (socket.value !== nextSocket) return;
      connected.value = false;
      connecting.value = false;
      retryScheduled.value = false;
      const reason = event.reason ? `, reason: ${event.reason}` : '';
      finishAllPendingWithoutResponse();
      const shouldReconnect = !manualDisconnect;
      if (shouldReconnect) {
        connectionError.value = {
          ...makeConnectionIssue('closed', url),
          code: event.code,
          reason: event.reason || undefined,
          wasClean: event.wasClean,
        };
      } else {
        connectionError.value = null;
      }
      if (!currentConnectIsAuto || manualDisconnect) {
        options.addMessage('system', `Connection closed. code=${event.code}${reason}`);
      }
      socket.value = null;
      if (reconnectAfterClose) {
        reconnectAfterClose = false;
        window.setTimeout(() => connect(false), 100);
        return;
      }
      if (shouldReconnect) {
        startAutoConnect(false);
      }
    };
    return true;
  }

  function disconnect() {
    rejectQueuedTextSend('The waiting message was not sent because the connection was disconnected.');
    manualDisconnect = true;
    connectionRequested = false;
    autoConnectPaused.value = true;
    reconnectAfterClose = false;
    clearAutoRetryTimer();
    if (socket.value) {
      socket.value.close(1000, 'User disconnected');
    } else {
      connected.value = false;
      connecting.value = false;
      connectionError.value = null;
    }
  }

  function clearConnectionError() {
    if (!connecting.value) connectionError.value = null;
  }

  function reconnect() {
    clearAutoRetryTimer();
    connectionRequested = true;
    autoConnectPaused.value = false;
    manualDisconnect = false;
    currentConnectIsAuto = false;

    if (socket.value && socket.value.readyState !== WebSocket.CLOSED) {
      reconnectAfterClose = true;
      socket.value.close(1000, 'Reconnecting');
      return;
    }

    window.setTimeout(() => connect(false), 0);
  }

  function startAutoConnect(resetWindow = true) {
    if (autoConnectPaused.value || connected.value || connecting.value) return;
    if (document.visibilityState === 'hidden') return;
    const startsNewWindow = resetWindow || !autoConnectStartedAt;
    if (startsNewWindow) {
      autoConnectStartedAt = Date.now();
      autoConnectAttempts = 0;
    }
    scheduleAutoReconnect(startsNewWindow ? 0 : getAutoReconnectDelay());
  }

  function resumeConnection() {
    if (!connectionRequested || manualDisconnect) return;
    isOnline.value = navigator.onLine;
    if (!isOnline.value) {
      connectionError.value = makeConnectionIssue('offline', wsUrl.value.trim());
      return;
    }
    if (canSend.value || connecting.value) return;
    autoConnectPaused.value = false;
    autoConnectStartedAt = Date.now();
    autoConnectAttempts = 0;
    scheduleAutoReconnect(0);
  }

  function sendText(
    text: string,
    attachments: ClientAttachment[] = [],
    onDispatched?: (dispatched: boolean) => void,
  ): boolean {
    const trimmed = text.trim();
    if (!trimmed && !attachments.length) {
      onDispatched?.(false);
      return false;
    }

    if (canSend.value) {
      const dispatched = dispatchText(trimmed, attachments);
      onDispatched?.(dispatched);
      return dispatched;
    }

    if (queuedTextSend) {
      options.addMessage('error', 'Another message is already waiting for the connection.');
      onDispatched?.(false);
      return false;
    }

    queuedTextSend = {
      attachments: attachments.map((attachment) => ({ ...attachment })),
      onDispatched,
      text: trimmed,
    };
    options.addMessage('system', 'Connection unavailable. Connecting before sending.');

    if (
      socket.value &&
      (socket.value.readyState === WebSocket.CONNECTING || connecting.value)
    ) {
      return true;
    }

    if (connect(false)) return true;
    rejectQueuedTextSend();
    return false;
  }

  function dispatchText(text: string, attachments: ClientAttachment[]): boolean {
    if (!canSend.value) return false;

    const session = options.activeSession();
    if (!session) return false;

    const messageId = makeId();
    options.addMessage('user', text, {
      attachments: toChatAttachments(attachments),
      messageId,
    });
    pendingTurns.value.set(messageId, null);
    ensureAssistantMessage(messageId);
    startNoResponseTimer(messageId);

    sendJson({
      sessionId: session.id,
      messageId,
      createdAt: new Date().toISOString(),
      ...createClientContentPayload(text, attachments),
    });
    return true;
  }

  function flushQueuedTextSend() {
    const queued = queuedTextSend;
    if (!queued) return;
    queuedTextSend = null;
    const dispatched = dispatchText(queued.text, queued.attachments);
    queued.onDispatched?.(dispatched);
  }

  function rejectQueuedTextSend(message?: string) {
    const queued = queuedTextSend;
    if (!queued) return;
    queuedTextSend = null;
    queued.onDispatched?.(false);
    if (message) options.addMessage('error', message);
  }

  function resendEditedText(userMessageId: string, text: string) {
    if (!canSend.value) {
      options.addMessage('error', 'Not connected, edited message was not sent.');
      return;
    }

    const trimmed = text.trim();

    const session = options.activeSession();
    if (!session) return;

    const userMessage = session.messages.find((message) => (
      message.id === userMessageId &&
      message.role === 'user'
    ));
    if (!userMessage) return;

    const attachments = toClientAttachments(userMessage.attachments || []);
    if (!trimmed && !attachments.length) return;

    const previousMessageId = userMessage.messageId || null;
    const messageId = makeId();
    if (previousMessageId) {
      removeAssistantForMessage(session, previousMessageId);
    }
    userMessage.messageId = messageId;
    pendingTurns.value.set(messageId, null);
    ensureAssistantMessage(messageId);
    startNoResponseTimer(messageId);
    options.touchSession(session);
    options.saveSessions();

    sendJson({
      sessionId: session.id,
      messageId,
      createdAt: new Date().toISOString(),
      ...createClientContentPayload(trimmed, attachments),
    });
  }

  function stopCurrent() {
    if (!canSend.value) return;
    const session = options.activeSession();
    const messageId = getLatestPendingMessageId();
    sendJson({ type: 'stop', sessionId: session ? session.id : null, messageId });
    options.addMessage('system', 'Stop request sent.');
    finishAssistantMessage(messageId, 'stopped');
  }

  function sendSettingAct(act: ClientSettingAct, content?: unknown) {
    if (!canSend.value) {
      options.addMessage('error', 'Not connected, setting request was not sent.');
      return false;
    }
    sendJson({
      type: 'setting',
      content: content === undefined ? { act } : { act, data: content },
    });
    return true;
  }

  function sendSystemAct(act: ClientSystemAct, content?: unknown) {
    if (!canSend.value) {
      options.addMessage('error', 'Not connected, system request was not sent.');
      return false;
    }
    sendJson({
      type: 'system',
      content: content === undefined ? { act } : { act, data: content },
    });
    return true;
  }

  function readMemory(length: number, createId = 0) {
    if (!canSend.value) {
      options.addMessage('error', 'Not connected, memory history was not loaded.');
      return false;
    }
    sendJson({
      type: 'memory',
      content: {
        act: 'read',
        length: Math.max(1, Math.floor(length)),
        create_id: Math.max(0, Math.floor(createId)),
      },
    });
    return true;
  }

  function deleteMemory(createIds: number[]) {
    if (!canSend.value) {
      options.addMessage('error', 'Not connected, memory history was not deleted.');
      return false;
    }
    const ids = Array.from(new Set(createIds.filter((id) => Number.isSafeInteger(id) && id > 0)));
    if (!ids.length) return false;
    sendJson({
      type: 'memory',
      content: { act: 'delete', create_ids: ids },
    });
    return true;
  }

  function clearPendingTurns() {
    clearAllNoResponseTimers();
    discardPendingStreamUpdates();
    pendingTurns.value.clear();
  }

  function sendJson(payload: ClientMessage) {
    socket.value?.send(`${JSON.stringify(payload)}\n`);
  }

  function handleServerMessage(raw: string) {
    const parsed = parseServerMessage(raw);
    if (typeof parsed === 'string') {
      queueAssistantContent(null, parsed);
      return;
    }

    const msg = parsed as ServerMessage;
    const type = getServerType(msg);
    const messageId = getMessageId(msg);

    if (type === 'setting') {
      const { act, content } = unwrapActContent(msg);
      const errorMessage = normalizeServerError(msg);
      if (errorMessage) options.addMessage('error', errorMessage);
      options.onSettingMessage?.(act, content, msg);
      return;
    }
    if (type === 'system') {
      const { act, content } = unwrapActContent(msg);
      const errorMessage = normalizeServerError(msg);
      if (errorMessage) options.addMessage('error', errorMessage);
      options.onSystemMessage?.(act, content, msg);
      return;
    }
    if (type === 'memory') {
      const { act } = unwrapActContent(msg);
      options.onMemoryMessage?.(act, msg);
      return;
    }
    if (type === 'history') return;
    if (['content', 'assistant', 'message'].includes(type)) {
      queueAssistantContent(messageId, normalizePayload(msg), msg);
      // `/reset` 由后端以 need_llm=false 的 message 事件答复，后面不会再有 end，
      // 这里主动收尾，否则该轮会一直停在加载态。
      if (type === 'message' && unwrapActContent(msg).act === 'reset') {
        return finishAssistantMessage(messageId, 'done', msg);
      }
      return;
    }
    if (['think', 'thinking', 'status'].includes(type)) return queueAssistantThink(messageId, normalizePayload(msg), msg);
    // Preserve ordering when a tool/image/terminal event follows buffered text.
    flushPendingStreamUpdates(messageId);
    if (['tool_calls', 'tool_call', 'tool'].includes(type)) return appendAssistantToolEvent(messageId, 'tool_calls', msg);
    if (type === 'tool_result') return appendAssistantToolEvent(messageId, 'tool_result', msg);
    if (type === 'image') return appendAssistantImage(messageId, msg);
    if (['file', 'html', 'document'].includes(type)) return appendAssistantFile(messageId, msg);
    if (type === 'error') {
      options.addMessage('error', normalizeServerError(msg) || normalizePayload(msg) || 'Server returned an error.');
      return finishAssistantMessage(messageId, 'error', msg);
    }
    if (['end', 'done', 'finish'].includes(type)) return finishAssistantMessage(messageId, 'done', msg);
    if (type === 'close') return closeAssistantMessage(messageId);

    queueAssistantContent(messageId, JSON.stringify(msg, null, 2), msg);
  }

  function queueAssistantContent(messageId: string | null, text: string, msg?: ServerMessage) {
    if (!text) return;
    const pending = getPendingStreamUpdate(messageId);
    pending.content += text;
    if (msg) pending.message = msg;
    scheduleStreamFlush();
  }

  function queueAssistantThink(messageId: string | null, text: string, msg?: ServerMessage) {
    if (!text) return;
    const pending = getPendingStreamUpdate(messageId);
    pending.think += text;
    if (msg) pending.message = msg;
    scheduleStreamFlush();
  }

  function getPendingStreamUpdate(messageId: string | null): PendingStreamUpdate {
    const key = messageId || '__latest__';
    const existing = pendingStreamUpdates.get(key);
    if (existing) return existing;
    const pending: PendingStreamUpdate = { content: '', think: '' };
    pendingStreamUpdates.set(key, pending);
    return pending;
  }

  function scheduleStreamFlush() {
    if (streamFlushTimer !== null) return;
    streamFlushTimer = window.setTimeout(() => {
      streamFlushTimer = null;
      flushPendingStreamUpdates();
    }, STREAM_FLUSH_MS);
  }

  function flushPendingStreamUpdates(messageId?: string | null) {
    const keys = messageId
      ? [messageId]
      : Array.from(pendingStreamUpdates.keys());

    keys.forEach((key) => {
      const pending = pendingStreamUpdates.get(key);
      if (!pending) return;
      pendingStreamUpdates.delete(key);
      const resolvedMessageId = key === '__latest__' ? null : key;
      if (pending.content) appendAssistantContentNow(resolvedMessageId, pending.content, pending.message);
      if (pending.think) appendAssistantThinkNow(resolvedMessageId, pending.think, pending.message);
    });

    if (!pendingStreamUpdates.size && streamFlushTimer !== null) {
      window.clearTimeout(streamFlushTimer);
      streamFlushTimer = null;
    }
  }

  function discardPendingStreamUpdates() {
    pendingStreamUpdates.clear();
    if (streamFlushTimer !== null) {
      window.clearTimeout(streamFlushTimer);
      streamFlushTimer = null;
    }
  }

  function ensureAssistantMessage(messageId: string | null, msg?: ServerMessage) {
    const session = options.activeSession();
    if (!session) return null;
    const resolvedMessageId = messageId || getLatestPendingMessageId() || makeId();
    const isSubTalk = msg?.isSubTalk === 1;

    let assistant = session.messages.find((message) => (
      message.role === 'assistant' &&
      message.messageId === resolvedMessageId &&
      (message.isSubTalk === 1) === isSubTalk
    ));

    if (!assistant) {
      assistant = {
        id: makeId(),
        role: 'assistant',
        messageId: resolvedMessageId,
        content: '',
        think: '',
        toolEvents: [],
        status: 'loading',
        time: nowTime(),
        isSubTalk: isSubTalk ? 1 : 0,
      };
      session.messages.push(assistant);
    }

    pendingTurns.value.set(resolvedMessageId, assistant.id);
    return { session, assistant, messageId: resolvedMessageId };
  }

  function appendAssistantContentNow(messageId: string | null, text: string, msg?: ServerMessage) {
    const turn = ensureAssistantMessage(messageId, msg);
    if (!turn) return;
    clearNoResponseTimer(turn.messageId);
    applySenderMeta(turn.assistant, msg);
    turn.assistant.content += text || '';
    turn.assistant.status = 'loading';
    options.touchSession(turn.session);
    options.scheduleSaveSessions();
  }

  function appendAssistantThinkNow(messageId: string | null, text: string, msg?: ServerMessage) {
    const turn = ensureAssistantMessage(messageId, msg);
    if (!turn) return;
    clearNoResponseTimer(turn.messageId);
    applySenderMeta(turn.assistant, msg);
    turn.assistant.think = `${turn.assistant.think || ''}${text || ''}`;
    turn.assistant.status = 'loading';
    options.touchSession(turn.session);
    options.scheduleSaveSessions();
  }

  function appendAssistantToolEvent(messageId: string | null, kind: 'tool_calls' | 'tool_result', msg: ServerMessage) {
    const turn = ensureAssistantMessage(messageId, msg);
    if (!turn) return;
    clearNoResponseTimer(turn.messageId);
    applySenderMeta(turn.assistant, msg);
    turn.assistant.toolEvents ||= [];
    turn.assistant.toolEvents.push(normalizeToolEvent(kind, msg, makeId, nowTime));
    turn.assistant.status = 'loading';
    options.touchSession(turn.session);
    options.scheduleSaveSessions();
  }

  function appendAssistantImage(messageId: string | null, msg: ServerMessage) {
    const image = normalizeImageEvent(msg, makeId, nowTime);
    if (!image) {
      queueAssistantContent(messageId, '', msg);
      return;
    }

    const turn = ensureAssistantMessage(messageId, msg);
    if (!turn) return;
    clearNoResponseTimer(turn.messageId);
    applySenderMeta(turn.assistant, msg);
    turn.assistant.images ||= [];
    turn.assistant.images.push(image);
    turn.assistant.status = 'loading';
    options.touchSession(turn.session);
    options.scheduleSaveSessions();
  }

  function finishAssistantMessage(
    messageId: string | null,
    status: 'done' | 'error' | 'stopped',
    msg?: ServerMessage,
  ) {
    flushPendingStreamUpdates(messageId);
    const resolvedMessageId = messageId || getLatestPendingMessageId();
    if (resolvedMessageId) clearNoResponseTimer(resolvedMessageId);
    const session = options.activeSession();
    if (session && resolvedMessageId) {
      const assistant = session.messages.find((message) => (
        message.role === 'assistant' && message.messageId === resolvedMessageId
      ));
      if (assistant) {
        applySenderMeta(assistant, msg);
        assistant.status = status;
      }
    }
    if (resolvedMessageId) pendingTurns.value.delete(resolvedMessageId);
    options.saveSessions();
  }

  function finishAllPendingWithoutResponse() {
    flushPendingStreamUpdates();
    const session = options.activeSession();
    if (!session || !pendingTurns.value.size) return;

    pendingTurns.value.forEach((_, messageId) => {
      clearNoResponseTimer(messageId);
      const assistant = session.messages.find((message) => (
        message.role === 'assistant' && message.messageId === messageId
      ));
      if (assistant && !hasAssistantOutput(assistant)) {
        assistant.status = 'done';
      }
    });
    pendingTurns.value.clear();
    options.saveSessions();
  }

  function closeAssistantMessage(messageId: string | null) {
    flushPendingStreamUpdates(messageId);
    const resolvedMessageId = messageId || getLatestPendingMessageId();
    if (resolvedMessageId) clearNoResponseTimer(resolvedMessageId);
    const session = options.activeSession();
    if (!session || !resolvedMessageId) return;

    session.messages = session.messages.filter((message) => !(
      message.role === 'assistant' && message.messageId === resolvedMessageId
    ));
    pendingTurns.value.delete(resolvedMessageId);
    options.saveSessions();
  }

  function removeAssistantForMessage(session: ChatSession, messageId: string) {
    clearNoResponseTimer(messageId);
    pendingTurns.value.delete(messageId);
    session.messages = session.messages.filter((message) => !(
      message.role === 'assistant' &&
      message.messageId === messageId
    ));
  }

  function startNoResponseTimer(messageId: string) {
    clearNoResponseTimer(messageId);
    const timerId = window.setTimeout(() => {
      const session = options.activeSession();
      const assistant = session?.messages.find((message) => (
        message.role === 'assistant' && message.messageId === messageId
      ));

      if (assistant && assistant.status === 'loading' && !hasAssistantOutput(assistant)) {
        assistant.status = 'done';
        pendingTurns.value.delete(messageId);
        options.saveSessions();
      }
      noResponseTimers.delete(messageId);
    }, NO_RESPONSE_TIMEOUT_MS);

    noResponseTimers.set(messageId, timerId);
  }

  function clearNoResponseTimer(messageId: string) {
    const timerId = noResponseTimers.get(messageId);
    if (timerId === undefined) return;
    window.clearTimeout(timerId);
    noResponseTimers.delete(messageId);
  }

  function clearAllNoResponseTimers() {
    noResponseTimers.forEach((timerId) => window.clearTimeout(timerId));
    noResponseTimers.clear();
  }

  function scheduleAutoReconnect(delay = getAutoReconnectDelay()) {
    clearAutoRetryTimer();
    if (manualDisconnect || autoConnectPaused.value) return;
    if (document.visibilityState === 'hidden') return;
    if (!navigator.onLine) {
      isOnline.value = false;
      connectionError.value = makeConnectionIssue('offline', wsUrl.value.trim());
      return;
    }

    const now = Date.now();
    if (!autoConnectStartedAt) autoConnectStartedAt = now;
    const remainingMs = AUTO_CONNECT_WINDOW_MS - (now - autoConnectStartedAt);
    if (remainingMs <= 0) {
      pauseAutoConnect('Auto connection stopped after 1 minute of retries. Waiting for manual connection.');
      return;
    }

    const nextDelay = Math.max(0, Math.min(delay, remainingMs));
    retryScheduled.value = true;
    autoRetryTimer = window.setTimeout(() => {
      autoRetryTimer = null;
      retryScheduled.value = false;
      if (Date.now() - autoConnectStartedAt > AUTO_CONNECT_WINDOW_MS) {
        pauseAutoConnect('Auto connection stopped after 1 minute of retries. Waiting for manual connection.');
        return;
      }
      autoConnectAttempts += 1;
      connect(true);
    }, nextDelay);
  }

  function clearAutoRetryTimer() {
    retryScheduled.value = false;
    if (autoRetryTimer === null) return;
    window.clearTimeout(autoRetryTimer);
    autoRetryTimer = null;
  }

  function getAutoReconnectDelay() {
    const exponent = Math.max(0, autoConnectAttempts - 1);
    return Math.min(AUTO_CONNECT_BASE_RETRY_MS * 2 ** exponent, AUTO_CONNECT_MAX_RETRY_MS);
  }

  function pauseAutoConnect(message: string) {
    autoConnectPaused.value = true;
    autoConnectStartedAt = 0;
    clearAutoRetryTimer();
    options.addMessage('system', message);
    rejectQueuedTextSend('The waiting message was not sent because connection retries stopped.');
  }

  function appendAssistantFile(messageId: string | null, msg: ServerMessage) {
    const file = normalizeFileEvent(msg, makeId, nowTime);
    if (!file) {
      queueAssistantContent(messageId, normalizePayload(msg), msg);
      return;
    }

    const turn = ensureAssistantMessage(messageId, msg);
    if (!turn) return;
    clearNoResponseTimer(turn.messageId);
    applySenderMeta(turn.assistant, msg);
    turn.assistant.files ||= [];
    turn.assistant.files.push(file);
    turn.assistant.status = 'loading';
    options.touchSession(turn.session);
    options.scheduleSaveSessions();
  }

  function handleOffline() {
    isOnline.value = false;
    clearAutoRetryTimer();
    if (connectionRequested && !manualDisconnect) {
      connectionError.value = makeConnectionIssue('offline', wsUrl.value.trim());
    }
  }

  function handleOnline() {
    isOnline.value = true;
    resumeConnection();
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      clearAutoRetryTimer();
      return;
    }

    const hiddenDuration = hiddenAt === null ? 0 : Date.now() - hiddenAt;
    hiddenAt = null;
    if (!connectionRequested || manualDisconnect) return;
    if (
      canSend.value &&
      hiddenDuration >= FOREGROUND_RECONNECT_THRESHOLD_MS &&
      !hasPendingTurns.value
    ) {
      reconnect();
      return;
    }
    resumeConnection();
  }

  function getLatestPendingMessageId(): string | null {
    const ids = Array.from(pendingTurns.value.keys());
    return ids.length ? ids[ids.length - 1] : null;
  }

  function applySenderMeta(message: ChatMessage, msg?: ServerMessage) {
    if (!msg) return;
    if (typeof msg.workerName === 'string' && msg.workerName.trim()) {
      message.senderName = msg.workerName.trim();
    }
    if (typeof msg.workerRole === 'string' && msg.workerRole.trim()) {
      message.senderRole = msg.workerRole.trim();
    }
    if (typeof msg.WindowName === 'string' && msg.WindowName.trim()) {
      message.WindowName = msg.WindowName.trim();
    }
    if (typeof msg.isSubTalk === 'number') {
      message.isSubTalk = msg.isSubTalk;
    }
  }

  onMounted(() => {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    discardPendingStreamUpdates();
    clearAllNoResponseTimers();
    clearAutoRetryTimer();
    rejectQueuedTextSend();
    const activeSocket = socket.value;
    socket.value = null;
    if (activeSocket && activeSocket.readyState !== WebSocket.CLOSED) {
      activeSocket.close(1000, 'Page unmounted');
    }
  });

  return {
    canSend,
    clearPendingTurns,
    clearConnectionError,
    connect,
    connected,
    connecting,
    connectionError,
    connectionState,
    disconnect,
    deleteMemory,
    autoConnectPaused,
    hasPendingTurns,
    reconnect,
    resumeConnection,
    readMemory,
    resendEditedText,
    sendSettingAct,
    sendSystemAct,
    sendText,
    startAutoConnect,
    stopCurrent,
    wsToken,
    wsUrl,
  };
}

export function validateWebSocketUrl(
  rawUrl: string,
  pageProtocol = window.location.protocol,
): ConnectionIssue | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return makeConnectionIssue('invalid-url', rawUrl);
  }

  if (!['ws:', 'wss:'].includes(parsed.protocol) || !parsed.hostname) {
    return makeConnectionIssue('invalid-url', rawUrl);
  }
  if (pageProtocol === 'https:' && parsed.protocol === 'ws:') {
    return makeConnectionIssue('mixed-content', rawUrl);
  }
  return null;
}

export function createWebSocketConnection(
  url: string,
  token: string,
  WebSocketConstructor: typeof WebSocket = WebSocket,
): WebSocket {
  const normalizedToken = token.trim();
  // An empty token is valid: omit the subprotocol list entirely in that case.
  return normalizedToken
    ? new WebSocketConstructor(url, [normalizedToken])
    : new WebSocketConstructor(url);
}

function makeConnectionIssue(
  kind: ConnectionIssueKind,
  url: string,
  detail?: string,
): ConnectionIssue {
  return {
    detail: detail || undefined,
    kind,
    occurredAt: Date.now(),
    url,
  };
}

function unwrapActContent(msg: ServerMessage): { act: string; content: unknown } {
  const content = msg.content;
  if (isRecord(content)) {
    const act = asString(content.act) || msg.act || '';
    const nestedContent = content.data ?? content.config ?? content.models ?? content.result;
    if (nestedContent !== undefined) return { act, content: nestedContent };
    const { act: _act, ...contentWithoutAct } = content;
    return {
      act,
      content: Object.keys(contentWithoutAct).length ? contentWithoutAct : '',
    };
  }

  return {
    act: msg.act || '',
    content: msg.content ?? msg.data ?? msg.message ?? '',
  };
}

function hasAssistantOutput(message: ChatMessage): boolean {
  return Boolean(
    message.content?.trim() ||
    message.think?.trim() ||
    message.images?.length ||
    message.toolEvents?.length,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function toChatAttachments(attachments: ClientAttachment[]): ChatAttachment[] {
  return attachments.map((attachment) => ({
    id: attachment.id,
    name: attachment.name,
    size: attachment.size,
    type: attachment.type,
    base64: attachment.base64,
  }));
}

function toClientAttachments(attachments: ChatAttachment[]): ClientAttachment[] {
  return attachments.map((attachment) => ({
    id: attachment.id,
    name: attachment.name,
    size: attachment.size,
    type: attachment.type,
    base64: attachment.base64,
  }));
}

function createClientContentPayload(
  text: string,
  attachments: ClientAttachment[],
): {
  type: 'chat';
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'file'; file: { filename: string; mimeType: string; content: string } }
  >;
} {
  const content = [
    ...(text ? [{ type: 'text' as const, text }] : []),
    ...attachments
      .filter((attachment) => attachment.base64 !== undefined)
      .map((attachment) => ({
        type: 'file' as const,
        file: {
          filename: attachment.name,
          mimeType: attachment.type,
          content: attachment.base64 || '',
        },
      })),
  ];

  return {
    type: 'chat',
    content,
  };
}
