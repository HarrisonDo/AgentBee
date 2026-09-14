import { computed, onBeforeUnmount, ref } from 'vue';
import type { ChatMessage, ChatSession, MessageRole, RemoteSession } from '../protocol/types';

const STORAGE_KEY = 'agentbee.sessions.v3';
const LEGACY_STORAGE_KEY = 'agentbee.sessions.v2';
const SINGLE_SESSION_STORAGE_KEY = 'agentbee.session.v1';
const DEFAULT_TITLE = 'New conversation';
const MAX_SAVE_ATTEMPTS = 12;
const MAX_STORED_MESSAGES = 50;
const MAX_STORED_SESSIONS = 30;
const MIN_STORED_MESSAGES = 6;
const SAVE_DEBOUNCE_MS = 650;
/** 会话标题取第一句话的前 8 个字，与后端命名规则保持一致。 */
const SESSION_TITLE_LENGTH = 8;

export interface UseSessionsOptions {
  /** 未起标题时的占位文案（走 i18n）。不传时退回 DEFAULT_TITLE。 */
  defaultTitle?: () => string;
}

export function useSessions(options: UseSessionsOptions = {}) {
  const sessions = ref<ChatSession[]>([]);
  const activeSessionId = ref('');
  // computed 里不能改响应式状态，所以兜底会话单独放一份，
  // 保证 `activeSession.value` 永远有值（`sessions` 为空时短暂借用）。
  const fallbackSession = ref<ChatSession>(createEmptySession(resolveDefaultTitle()));
  let saveTimer: number | null = null;
  let storageDisabled = false;

  function resolveDefaultTitle(): string {
    const label = options.defaultTitle?.()?.trim();
    return label || DEFAULT_TITLE;
  }

  /** 占位标题（还没起过名字的会话）：当前语言的占位文案和遗留英文名都算。 */
  function isPlaceholderTitle(title: string): boolean {
    const trimmed = (title || '').trim();
    return !trimmed || trimmed === resolveDefaultTitle() || trimmed === DEFAULT_TITLE;
  }

  /**
   * 本地兜底出来的「空占位」会话：没有任何消息、不是后端下发的、标题还是占位文案。
   * 它只是 `ensureSession()` 为了让界面有东西可渲染临时塞进来的，不是真实历史。
   *
   * 用户主动点「新建会话」留的空壳（`keepEmpty`）不算在内——那是他自己的意图。
   */
  function isBlankPlaceholderSession(session: ChatSession): boolean {
    return !session.keepEmpty
      && !session.remoteName
      && session.messages.length === 0
      && isPlaceholderTitle(session.title);
  }

  const activeSession = computed<ChatSession>(() => {
    const found = sessions.value.find((session) => session.id === activeSessionId.value);
    return found || fallbackSession.value;
  });

  /**
   * 保证 `activeSessionId` 指向列表里真实存在的一项。
   *
   * **列表为空是合法状态**（用户把会话全删了）。这时 `activeSession` 退回内存里的
   * `fallbackSession` 供界面渲染，但绝不把它塞进 `sessions`：
   * 一旦塞进去就会被 `saveSessions()` 持久化，刷新后变成一条凭空多出来的「新对话」——
   * 也就是「删了会话、刷新又冒出一个」的成因。
   */
  function ensureSession(): ChatSession {
    const found = sessions.value.find((session) => session.id === activeSessionId.value);
    if (found) return found;
    activeSessionId.value = sessions.value.length ? sessions.value[0].id : '';
    return sessions.value[0] || fallbackSession.value;
  }

  function clearSaveTimer() {
    if (saveTimer === null) return;
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }

  function loadSessions() {
    clearSaveTimer();
    storageDisabled = false;
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    localStorage.removeItem(SINGLE_SESSION_STORAGE_KEY);
    // 顺手清掉历史遗留的兜底占位：早期版本会把「新对话」空壳一起存进 localStorage，
    // 不清就会每次打开都看见一条凭空多出来的空会话（连不上后端时也一样）。
    sessions.value = restoreSessions().filter((session) => !isBlankPlaceholderSession(session));
    activeSessionId.value = sessions.value.length ? sessions.value[0].id : '';
    // 本地一条都没有时，兜底会话必须是干净的：否则会把上一轮的残留消息渲染出来。
    if (!sessions.value.length) fallbackSession.value = createEmptySession(resolveDefaultTitle());
    ensureSession();
  }

  function saveSessions() {
    if (storageDisabled) return;
    clearSaveTimer();

    // 空占位永远不落盘：它只是列表被删空时的内存兜底，
    // 存进 localStorage 就会在刷新后「复活」成一条新对话。
    let snapshot = createStorageSnapshot(
      sessions.value.filter((session) => !isBlankPlaceholderSession(session)),
    );

    for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt += 1) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
        return;
      } catch (error) {
        if (!isStorageQuotaError(error)) throw error;

        const pruned = pruneSessions(snapshot);
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
    localStorage.removeItem(SINGLE_SESSION_STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
    sessions.value = [];
    activeSessionId.value = '';
    fallbackSession.value = createEmptySession(resolveDefaultTitle());
    ensureSession();
  }

  function touchSession(session: ChatSession) {
    session.updatedAt = new Date().toISOString();
  }

  function addMessage(role: MessageRole, content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
    // 列表被删空时（空列表是合法状态）先起一条：否则消息会落进内存里的兜底会话，
    // 既进不了列表、也存不进 localStorage，刷新就丢了。
    if (!sessions.value.length) createSession();
    const session = activeSession.value;
    const message: ChatMessage = {
      id: makeId(),
      role,
      content: content || '',
      time: nowTime(),
      ...extra,
    };
    session.messages.push(message);
    // 已经有内容了，就不该再被当作「空占位」清掉。
    if (session.keepEmpty) delete session.keepEmpty;
    applyFirstMessageTitle(session, message, resolveDefaultTitle());
    touchSession(session);
    // 新会话按 updatedAt 排到最前。
    moveToFront(session.id);
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

  /**
   * 新建会话：sessionId 由前端生成，后端收到第一条消息后自动入库。
   * 标 `keepEmpty`：这是用户主动要的空会话，刷新拿到历史列表时不能被当成占位清掉。
   */
  function createSession(): ChatSession {
    const session = createEmptySession(resolveDefaultTitle(), true);
    sessions.value.unshift(session);
    activeSessionId.value = session.id;
    saveSessions();
    return session;
  }

  /** 按 id 取会话：流式事件要落回「发起这一轮的会话」，而不是切换后的当前会话。 */
  function getSessionById(sessionId: string): ChatSession | null {
    if (!sessionId) return null;
    return sessions.value.find((session) => session.id === sessionId) || null;
  }

  function switchSession(sessionId: string): boolean {
    const exists = sessions.value.some((session) => session.id === sessionId);
    if (!exists || sessionId === activeSessionId.value) return false;
    activeSessionId.value = sessionId;
    saveSessions();
    return true;
  }

  function removeSession(sessionId: string): boolean {
    const index = sessions.value.findIndex((session) => session.id === sessionId);
    if (index < 0) return false;

    const wasActive = sessions.value[index].id === activeSessionId.value;
    sessions.value.splice(index, 1);

    // 删掉当前会话后落到最近的一条（排序后即第一条）；全删光就保持空列表——
    // 不再自动补一条空会话，否则「删了刷新又冒出来」会一直复现。
    if (wasActive) activeSessionId.value = '';
    // 列表空了就把兜底会话换成干净的，`activeSession` 还有东西可渲染。
    if (!sessions.value.length) fallbackSession.value = createEmptySession(resolveDefaultTitle());
    ensureSession();
    saveSessions();
    return true;
  }

  /**
   * 把后端 `readSession` 的返回合并进本地列表。**服务端是会话是否存在的权威来源**：
   *
   * - 后端有、本地没有 → 新增（本地新建但还没发过消息的会话保留，它还没入库）。
   * - 本地有、后端也有 → 只补 `remoteName`，不动本地消息；本地已起的标题不覆盖。
   * - 本地标着「来自后端」、后端却没有 → 服务端已删，本地跟着删（否则会复活）。
   * - 本地空占位 → 丢掉（早期版本会把兜底占位存进 localStorage）。
   *
   * 落点：本地本来就没有真实历史、或当前停在空占位上时，直接进入排序后的第一条
   * （后端按 `create_time DESC` 返回，即最近一条）；后端也没有历史就保持空列表，
   * 由用户自己点「新建会话」，不再凭空造一条。
   * 只有用户主动点「新建会话」留的空壳（`keepEmpty`）会被保留。
   */
  function applyRemoteSessions(remote: RemoteSession[]): void {
    // 后端返回的会话 id 集合：会话是不是还存在，以服务端为准。
    const remoteIds = new Set(
      remote.map((item) => String(item.session_id || '').trim()).filter(Boolean),
    );

    // 合并前先判断：本地除了空占位，是不是还有真实内容（有消息，或来自后端的会话）。
    // 有的话说明用户本来就在这个会话里，绝不能替他跳走。
    const localHasRealContent = sessions.value.some((session) => (
      session.messages.length > 0 || Boolean(session.remoteName)
    ));
    // 当前停在一个空占位上：说明用户没在这个会话里做任何事，可以直接换掉。
    const activeIsBlankPlaceholder = isBlankPlaceholderSession(activeSession.value);
    // 只在合并前就存在的占位里挑，避免误伤「后端名称恰好为空」的新会话。
    const placeholderIds = new Set(
      sessions.value.filter(isBlankPlaceholderSession).map((session) => session.id),
    );
    // 本地认为「来自后端」、这次后端却没返回的：服务端已经删掉了，本地跟着删。
    // 否则删过一次的会话在下次刷新时又会从本地复活。
    const missingRemoteIds = new Set(
      sessions.value
        .filter((session) => Boolean(session.remoteName) && !remoteIds.has(session.id))
        .map((session) => session.id),
    );

    let changed = false;

    remote.forEach((item) => {
      const id = String(item.session_id || '').trim();
      if (!id) return;
      const existing = sessions.value.find((session) => session.id === id);
      const name = String(item.session_name || '').trim();

      if (existing) {
        if (name && existing.remoteName !== name) {
          existing.remoteName = name;
          // 本地还没起过标题时直接用后端名称，后端是按第一句话前 8 个字命名的。
          if (isPlaceholderTitle(existing.title)) existing.title = name;
          changed = true;
        }
        return;
      }

      sessions.value.push({
        id,
        title: name || resolveDefaultTitle(),
        remoteName: name || undefined,
        createdAt: toIsoTime(item.create_time),
        updatedAt: toIsoTime(item.create_time) || new Date().toISOString(),
        messages: [],
      });
      changed = true;
    });

    // 没新增会话、也没有要清理的：不用动。
    if (!changed && !placeholderIds.size && !missingRemoteIds.size) return;
    sortSessions();

    // 丢掉空占位（含历史遗留：早期版本会把兜底占位一起存进 localStorage），
    // 以及服务端已经不存在的本地记录。
    if (placeholderIds.size || missingRemoteIds.size) {
      sessions.value = sessions.value.filter((session) => (
        !placeholderIds.has(session.id) && !missingRemoteIds.has(session.id)
      ));
      fallbackSession.value = createEmptySession(resolveDefaultTitle());
    }

    // 本地本来就没有真实历史，或者当前就停在一个空占位上：
    // 直接落到排序后的第一条（后端按 create_time DESC 返回，即最近的一条会话）。
    // 没有任何历史时列表就保持为空，由用户自己点「新建会话」。
    if (!localHasRealContent || activeIsBlankPlaceholder) {
      activeSessionId.value = '';
    }

    // 兜底：activeSessionId 指丢了就回到最近的一条（列表为空时它保持为空）。
    ensureSession();

    saveSessions();
  }

  function sortSessions() {
    sessions.value.sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt) || 0;
      const rightTime = Date.parse(right.updatedAt) || 0;
      return rightTime - leftTime;
    });
  }

  function moveToFront(sessionId: string) {
    const index = sessions.value.findIndex((session) => session.id === sessionId);
    if (index <= 0) return;
    const [session] = sessions.value.splice(index, 1);
    sessions.value.unshift(session);
  }

  onBeforeUnmount(() => {
    if (saveTimer === null) return;
    clearSaveTimer();
    saveSessions();
  });

  ensureSession();

  return {
    activeSession,
    activeSessionId,
    addMessage,
    applyRemoteSessions,
    clearLocalHistory,
    createSession,
    getSessionById,
    loadSessions,
    removeSession,
    saveSessions,
    scheduleSaveSessions,
    sessions,
    switchSession,
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

/** 会话标题 = 第一条用户消息的前 8 个字。 */
export function buildSessionTitle(text: string, fallback: string = DEFAULT_TITLE): string {
  const collapsed = (text || '').replace(/\s+/g, ' ').trim();
  if (!collapsed) return fallback;
  return collapsed.length > SESSION_TITLE_LENGTH
    ? `${collapsed.slice(0, SESSION_TITLE_LENGTH)}…`
    : collapsed;
}

function applyFirstMessageTitle(session: ChatSession, message: ChatMessage, fallback: string) {
  if (message.role !== 'user') return;
  const userMessages = session.messages.filter((item) => item.role === 'user');
  // 已经有更早的用户消息就说明标题早就定过了。
  if (userMessages.length > 1) return;
  session.title = buildSessionTitle(message.content, fallback);
}

function createEmptySession(title: string = DEFAULT_TITLE, keepEmpty = false): ChatSession {
  const now = new Date().toISOString();
  return {
    id: makeId(),
    title,
    createdAt: now,
    updatedAt: now,
    ...(keepEmpty ? { keepEmpty } : {}),
    messages: [],
  };
}

function createStorageSnapshot(list: ChatSession[]): ChatSession[] {
  return list
    .slice(0, MAX_STORED_SESSIONS)
    .map((session) => ({
      ...session,
      messages: getStorableMessages(session.messages),
    }));
}

function getStorableMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter((message) => !message.isRemoteHistory)
    .slice(-MAX_STORED_MESSAGES)
    .map(({ memoryCreateId: _memoryCreateId, isRemoteHistory: _isRemoteHistory, ...message }) => message);
}

function pruneSessions(list: ChatSession[]): ChatSession[] {
  const prunedMessages = list.map((session) => {
    if (session.messages.length <= MIN_STORED_MESSAGES) return session;
    const keepCount = Math.max(
      MIN_STORED_MESSAGES,
      Math.ceil(session.messages.length * 0.7),
    );
    return { ...session, messages: session.messages.slice(-keepCount) };
  });

  if (list.length <= 1) return prunedMessages === list ? list : prunedMessages;
  return prunedMessages.slice(0, Math.max(1, Math.ceil(list.length * 0.7)));
}

function restoreSessions(): ChatSession[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRestorableSession).map((session) => ({
      ...session,
      messages: Array.isArray(session.messages) ? session.messages : [],
    }));
  } catch {
    return [];
  }
}

function isRestorableSession(value: unknown): value is ChatSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<ChatSession>;
  return typeof session.id === 'string' && session.id.length > 0;
}

function toIsoTime(value: string | number | undefined): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value.replace(/-/g, '/'));
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return '';
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
