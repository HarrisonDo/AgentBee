<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue';
import {
  ArrowDownToLine,
  History,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  X,
} from 'lucide-vue-next';
import ChatMessage from './components/ChatMessage.vue';
import Composer from './components/Composer.vue';
import ConnectionPanel from './components/ConnectionPanel.vue';
import LoginWin from './components/LoginWin.vue';
import SettingsView from './components/SettingsView.vue';
import SessionList from './components/SessionList.vue';
import SystemLogGroup from './components/SystemLogGroup.vue';
import SubAgentPanel from './components/SubAgentPanel.vue';
import SubAgentMenu from './components/SubAgentMenu.vue';
import type { SubAgentSummary } from './components/SubAgentMenu.vue';
import { useI18n } from './composables/useI18n';
import { useSessions } from './composables/useSessions';
import { useTheme } from './composables/useTheme';
import { useWebSocketAgent } from './composables/useWebSocketAgent';
import { normalizeServerError } from './protocol/normalizers';
import type {
  ChatMessage as AgentChatMessage,
  ClientAttachment,
  ClientSettingAct,
  MemoryRecord,
  ServerMessage,
} from './protocol/types';

interface BasicSettings {
  apiKey: string;
  apiUrl: string;
  inSandbox: boolean;
  modelName: string;
  workspacePath: string;
}

type SettingStatusTone = 'success' | 'warning' | 'error';
type MemoryReadMode = 'latest' | 'older' | 'probe';

type VisibleChatItem =
  | {
    key: string;
    message: AgentChatMessage;
    type: 'message';
  }
  | {
    key: string;
    messages: AgentChatMessage[];
    type: 'system-group';
  };

const chatContainer = ref<HTMLElement | null>(null);
const chatShell = ref<HTMLElement | null>(null);
const shouldAutoScroll = ref(true);
const sidebarCollapsed = ref(false);
const currentView = ref<'chat' | 'settings'>('chat');
const showLoginWindow = ref(true);
const agentConfig = ref<Record<string, unknown>>(readAgentConfig());
const configJson = ref(JSON.stringify(agentConfig.value, null, 2));
const configJsonError = ref('');
const settingStatus = ref('');
const settingStatusTone = ref<SettingStatusTone>('success');
const availableModels = ref<string[]>([]);
const memoryLoading = ref(false);
const memoryDeleting = ref(false);
const memoryError = ref('');
const memoryHasMore = ref(true);
const memoryReadMode = ref<MemoryReadMode | null>(null);
const showDebugInfo = ref(false);
const selectedSubAgentName = ref<string | null>(null);
const subAgentPaneWidth = ref(readSubAgentPaneWidth());
const isSubAgentResizing = ref(false);
const visibleMessageCount = ref(50);
let historyRestoreHeight: number | null = null;
let restoringHistoryScroll = false;
const appVersion = __APP_VERSION__;

const SUB_AGENT_MIN_WIDTH = 300;
const SUB_AGENT_MAX_WIDTH = 680;
const CHAT_PANE_MIN_WIDTH = 360;
const SUB_AGENT_DIVIDER_WIDTH = 8;
const SUB_AGENT_WIDTH_STORAGE_KEY = 'agentbee.subAgentPaneWidth';
const HISTORY_PAGE_SIZE = 50;
const MEMORY_PAGE_SIZE = 30;
const MEMORY_LATEST_CACHE_SIZE = 50;
const MEMORY_PROBE_INTERVAL_MS = 30_000;
const MEMORY_FULL_SYNC_INTERVAL_MS = 5 * 60_000;
const MEMORY_FOCUS_SYNC_GAP_MS = 5_000;
const MEMORY_RESPONSE_TIMEOUT_MS = 15_000;
const MEMORY_CACHE_STORAGE_KEY = 'agentbee.memoryCache.v1';
const cachedMemoryRecords = readCachedMemoryRecords();
const latestMemoryRecords = ref<MemoryRecord[]>(cachedMemoryRecords);
const memoryRecords = ref<MemoryRecord[]>([...cachedMemoryRecords]);
let pendingMemoryDeleteIds: number[] = [];
let memoryResponseTimer: number | null = null;
let memoryProbeTimer: number | null = null;
let memoryFullSyncTimer: number | null = null;
let memoryTurnSyncTimer: number | null = null;
let pendingMemoryReadMode: Exclude<MemoryReadMode, 'probe'> | null = null;
let lastFullMemorySyncAt = 0;
let resizeStartX = 0;
let resizeStartWidth = 0;
let resizePointerId: number | null = null;
let chatShellResizeObserver: ResizeObserver | null = null;

const { locale, setLocale, t } = useI18n();
const { setTheme, theme } = useTheme();

const sessions = useSessions();
sessions.loadSessions();

const agent = useWebSocketAgent({
  activeSession: () => sessions.activeSession.value,
  addMessage: sessions.addMessage,
  onMemoryMessage: handleMemoryMessage,
  onSettingMessage: handleSettingMessage,
  onSystemMessage: handleSystemMessage,
  onTurnFinished: scheduleMemorySyncAfterTurn,
  saveSessions: sessions.saveSessions,
  scheduleSaveSessions: sessions.scheduleSaveSessions,
  touchSession: sessions.touchSession,
  updateTitleFromMessage: sessions.updateTitleFromMessage,
});
watch(() => agent.canSend.value, (canSend) => {
  if (canSend) {
    showLoginWindow.value = false;
    const sent = agent.sendSettingAct('getConfig');
    if (sent) {
      // Config will be applied in handleSettingMessage
    }
    requestModels(true);
    startMemorySyncTimers();
    requestLatestMemorySync(true);
    return;
  }
  stopMemorySyncTimers();
  memoryLoading.value = false;
  memoryDeleting.value = false;
  memoryReadMode.value = null;
  pendingMemoryDeleteIds = [];
  pendingMemoryReadMode = null;
  clearMemoryResponseTimer();
});

const activeMeta = computed(() => {
  const url = agent.wsUrl.value.trim() || t.value.noUrl;
  return `${agent.connected.value ? t.value.activeConnected : t.value.activeWaiting} · ${url}`;
});

const localMainMessages = computed(() => (
  (sessions.activeSession.value?.messages || [])
    .filter((message) => message.isSubTalk !== 1)
));

const hasOlderMessages = computed(() => (
  localMainMessages.value.length > visibleMessageCount.value
));

const visibleMainMessages = computed<AgentChatMessage[]>(() => {
  const startIndex = Math.max(0, localMainMessages.value.length - visibleMessageCount.value);
  return mergeLocalAndMemoryMessages(
    localMainMessages.value.slice(startIndex),
    memoryRecords.value,
  );
});

const visibleChatItems = computed<VisibleChatItem[]>(() => {
  const items: VisibleChatItem[] = [];
  let pendingSystemMessages: AgentChatMessage[] = [];

  function flushSystemMessages() {
    if (!pendingSystemMessages.length) return;
    items.push({
      key: `system-${pendingSystemMessages[0].id}`,
      messages: pendingSystemMessages,
      type: 'system-group',
    });
    pendingSystemMessages = [];
  }

  visibleMainMessages.value.forEach((message) => {
    // 过滤掉子agent的消息，不在主聊天区显示
    if (message.isSubTalk === 1) {
      return;
    }

    if (message.role === 'system' && !message.isRemoteHistory) {
      pendingSystemMessages.push(message);
      return;
    }

    flushSystemMessages();
    items.push({
      key: message.id,
      message,
      type: 'message',
    });
  });

  flushSystemMessages();
  return items;
});

const subAgentMessages = computed(() => {
  const messages = sessions.activeSession.value?.messages || [];
  return messages.filter((msg) => msg.isSubTalk === 1);
});

const subAgents = computed<SubAgentSummary[]>(() => {
  const agents = new Map<string, SubAgentSummary>();
  subAgentMessages.value.forEach((msg) => {
    const name = msg.WindowName;
    if (name) {
      const existing = agents.get(name);
      if (existing) {
        existing.count += 1;
        existing.lastActive = msg.time || existing.lastActive;
        existing.role ||= msg.senderRole?.trim() || msg.senderName?.trim() || '';
        existing.status = msg.status || existing.status;
      } else {
        agents.set(name, {
          name,
          count: 1,
          lastActive: msg.time || '',
          role: msg.senderRole?.trim() || msg.senderName?.trim() || '',
          status: msg.status || '',
        });
      }
    }
  });
  return Array.from(agents.values());
});

const selectedSubAgent = computed(() => (
  subAgents.value.find((agentItem) => agentItem.name === selectedSubAgentName.value) || null
));

watch(subAgents, (agents) => {
  if (
    selectedSubAgentName.value &&
    !agents.some((agentItem) => agentItem.name === selectedSubAgentName.value)
  ) {
    selectedSubAgentName.value = null;
  }
});

watch(() => sessions.activeSessionId.value, () => {
  visibleMessageCount.value = HISTORY_PAGE_SIZE;
  historyRestoreHeight = null;
  restoringHistoryScroll = false;
});

watch(chatShell, (nextShell, previousShell) => {
  if (previousShell) chatShellResizeObserver?.unobserve(previousShell);
  if (nextShell) chatShellResizeObserver?.observe(nextShell);
});

function onSend(text: string, attachments: ClientAttachment[]) {
  currentView.value = 'chat';
  agent.sendText(text, attachments);
  maybeScrollAfterUpdate();
}

function maybeScrollAfterUpdate() {
  nextTick(() => {
    if (shouldAutoScroll.value) scrollToBottom();
  });
}

function scrollToBottom() {
  if (!chatContainer.value) return;
  chatContainer.value.scrollTop = chatContainer.value.scrollHeight;
  shouldAutoScroll.value = true;
}

function scrollToLatestAfterRender() {
  nextTick(() => {
    window.requestAnimationFrame(() => {
      scrollToBottom();
    });
  });
}

function onScroll() {
  const el = chatContainer.value;
  if (!el) return;
  shouldAutoScroll.value = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  if (restoringHistoryScroll || el.scrollTop >= 80) return;

  if (hasOlderMessages.value) {
    preserveHistoryScrollAfterUpdate();
    visibleMessageCount.value += HISTORY_PAGE_SIZE;
    return;
  }

  requestMemoryHistory();
}

function preserveHistoryScrollAfterUpdate() {
  const element = chatContainer.value;
  if (!element || restoringHistoryScroll) return;
  historyRestoreHeight = element.scrollHeight;
  restoringHistoryScroll = true;
  nextTick(() => {
    window.requestAnimationFrame(() => {
      const current = chatContainer.value;
      if (current && historyRestoreHeight !== null) {
        current.scrollTop += current.scrollHeight - historyRestoreHeight;
      }
      historyRestoreHeight = null;
      restoringHistoryScroll = false;
      if (
        current &&
        current.scrollHeight <= current.clientHeight + 1 &&
        !hasOlderMessages.value
      ) {
        requestMemoryHistory();
      }
    });
  });
}

function requestMemoryHistory() {
  requestMemoryRead('older');
}

function retryMemoryHistory() {
  requestLatestMemorySync(true);
}

function requestLatestMemorySync(force = false) {
  if (!agent.canSend.value) return;
  if (!force && Date.now() - lastFullMemorySyncAt < MEMORY_FOCUS_SYNC_GAP_MS) return;
  requestMemoryRead('latest');
}

function requestMemoryProbe() {
  if (
    document.visibilityState !== 'visible' ||
    !agent.canSend.value ||
    memoryReadMode.value !== null ||
    memoryDeleting.value
  ) return;
  requestMemoryRead('probe');
}

function requestMemoryRead(mode: MemoryReadMode) {
  if (!agent.canSend.value) return false;
  if (mode === 'older' && !memoryHasMore.value) return false;

  if (memoryReadMode.value !== null || memoryDeleting.value) {
    if (mode === 'latest') pendingMemoryReadMode = 'latest';
    if (mode === 'older' && pendingMemoryReadMode !== 'latest') {
      pendingMemoryReadMode = 'older';
    }
    return false;
  }

  const length = mode === 'latest'
    ? MEMORY_LATEST_CACHE_SIZE
    : mode === 'older' ? MEMORY_PAGE_SIZE : 1;
  const createId = mode === 'older' ? (memoryRecords.value[0]?.create_id || 0) : 0;
  if (mode === 'older' && createId <= 0) {
    pendingMemoryReadMode = 'older';
    requestLatestMemorySync(true);
    return false;
  }
  if (!agent.readMemory(length, createId)) return false;

  memoryReadMode.value = mode;
  if (mode === 'older') preserveHistoryScrollAfterUpdate();
  memoryLoading.value = mode === 'older' || (mode === 'latest' && !memoryRecords.value.length);
  if (mode !== 'probe') memoryError.value = '';
  if (mode === 'latest') lastFullMemorySyncAt = Date.now();
  startMemoryResponseTimer('read');
  return true;
}

function runPendingMemoryRead() {
  if (memoryReadMode.value !== null || memoryDeleting.value) return;
  const mode = pendingMemoryReadMode;
  pendingMemoryReadMode = null;
  if (!mode) return;
  window.setTimeout(() => requestMemoryRead(mode), 0);
}

function deleteMemoryMessage(createId: number) {
  if (!agent.canSend.value || memoryReadMode.value !== null || memoryDeleting.value) return;
  if (!window.confirm(t.value.deleteMemoryConfirm.replace('{count}', '1'))) return;
  if (!agent.deleteMemory([createId])) return;
  pendingMemoryDeleteIds = [createId];
  memoryDeleting.value = true;
  memoryError.value = '';
  startMemoryResponseTimer('delete');
}

function startMemoryResponseTimer(act: 'delete' | 'read') {
  clearMemoryResponseTimer();
  memoryResponseTimer = window.setTimeout(() => {
    memoryResponseTimer = null;
    if (act === 'read') {
      const mode = memoryReadMode.value;
      memoryReadMode.value = null;
      if (mode === 'older') preserveHistoryScrollAfterUpdate();
      memoryLoading.value = false;
      if (mode === 'older' || (mode === 'latest' && !memoryRecords.value.length)) {
        memoryError.value = t.value.memoryReadTimeout;
      }
      runPendingMemoryRead();
      return;
    }
    if (act === 'delete') {
      memoryDeleting.value = false;
      pendingMemoryDeleteIds = [];
      memoryError.value = t.value.memoryDeleteTimeout;
      runPendingMemoryRead();
    }
  }, MEMORY_RESPONSE_TIMEOUT_MS);
}

function clearMemoryResponseTimer() {
  if (memoryResponseTimer === null) return;
  window.clearTimeout(memoryResponseTimer);
  memoryResponseTimer = null;
}

function deleteSession(sessionId: string) {
  const deletedActiveSession = sessionId === sessions.activeSessionId.value;
  sessions.deleteSession(sessionId);
  if (deletedActiveSession) {
    agent.clearPendingTurns();
    scrollToLatestAfterRender();
  }
}

function selectSession(sessionId: string) {
  currentView.value = 'chat';
  sessions.setActiveSession(sessionId);
  agent.clearPendingTurns();
  scrollToLatestAfterRender();
}

function createSession() {
  currentView.value = 'chat';
  sessions.createSession();
  scrollToLatestAfterRender();
}

function updateAndResendUserMessage(messageId: string, content: string) {
  const updated = sessions.updateMessageContent(messageId, content);
  if (!updated) return;
  agent.resendEditedText(messageId, content);
  maybeScrollAfterUpdate();
}

function resendUserMessage(messageId: string) {
  const message = sessions.activeSession.value?.messages.find((item) => (
    item.id === messageId &&
    item.role === 'user'
  ));
  if (!message || (!message.content.trim() && !message.attachments?.length)) return;
  const attachments: ClientAttachment[] = (message.attachments || []).map((attachment) => ({
    ...attachment,
  }));
  agent.sendText(message.content, attachments);
  maybeScrollAfterUpdate();
}

function deleteSubAgent(agentName: string) {
  const session = sessions.activeSession.value;
  if (!session) return;
  session.messages = session.messages.filter((msg) => msg.WindowName !== agentName);
  if (selectedSubAgentName.value === agentName) {
    selectedSubAgentName.value = null;
  }
  sessions.saveSessions();
}

function selectSubAgent(agentName: string) {
  selectedSubAgentName.value = agentName;
  nextTick(() => {
    subAgentPaneWidth.value = clampSubAgentPaneWidth(subAgentPaneWidth.value);
  });
}

function closeSubAgentPanel() {
  selectedSubAgentName.value = null;
}

function startSubAgentResize(event: PointerEvent) {
  if (event.button !== 0 || !selectedSubAgent.value) return;
  const target = event.currentTarget as HTMLElement;
  resizePointerId = event.pointerId;
  resizeStartX = event.clientX;
  resizeStartWidth = subAgentPaneWidth.value;
  isSubAgentResizing.value = true;
  target.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function resizeSubAgentPanel(event: PointerEvent) {
  if (!isSubAgentResizing.value || resizePointerId !== event.pointerId) return;
  subAgentPaneWidth.value = clampSubAgentPaneWidth(
    resizeStartWidth + resizeStartX - event.clientX,
  );
}

function stopSubAgentResize(event: PointerEvent) {
  if (resizePointerId !== event.pointerId) return;
  const target = event.currentTarget as HTMLElement;
  if (target.hasPointerCapture(event.pointerId)) {
    target.releasePointerCapture(event.pointerId);
  }
  isSubAgentResizing.value = false;
  resizePointerId = null;
  persistSubAgentPaneWidth();
}

function resizeSubAgentWithKeyboard(event: KeyboardEvent) {
  const steps: Record<string, number> = {
    ArrowLeft: 24,
    ArrowRight: -24,
  };
  if (!(event.key in steps) && event.key !== 'Home' && event.key !== 'End') return;
  event.preventDefault();

  if (event.key === 'Home') {
    subAgentPaneWidth.value = SUB_AGENT_MIN_WIDTH;
  } else if (event.key === 'End') {
    subAgentPaneWidth.value = clampSubAgentPaneWidth(SUB_AGENT_MAX_WIDTH);
  } else {
    subAgentPaneWidth.value = clampSubAgentPaneWidth(
      subAgentPaneWidth.value + steps[event.key],
    );
  }
  persistSubAgentPaneWidth();
}

function clampSubAgentPaneWidth(width: number) {
  const shellWidth = chatShell.value?.getBoundingClientRect().width || window.innerWidth;
  const availableWidth = shellWidth - CHAT_PANE_MIN_WIDTH - SUB_AGENT_DIVIDER_WIDTH;
  const maxWidth = Math.max(
    SUB_AGENT_MIN_WIDTH,
    Math.min(SUB_AGENT_MAX_WIDTH, availableWidth),
  );
  return Math.round(Math.max(SUB_AGENT_MIN_WIDTH, Math.min(width, maxWidth)));
}

function persistSubAgentPaneWidth() {
  localStorage.setItem(SUB_AGENT_WIDTH_STORAGE_KEY, String(subAgentPaneWidth.value));
}

function readSubAgentPaneWidth() {
  const savedWidth = Number(localStorage.getItem('agentbee.subAgentPaneWidth'));
  return Number.isFinite(savedWidth) && savedWidth > 0 ? savedWidth : 420;
}

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value;
}

let settingsConfigRequested = false;
let refreshModelsAfterSave = false;
let reconnectAfterSave = false;
let requestModelsAfterNextConnect = false;

function openSettings() {
  refreshConfigJson();
  configJsonError.value = '';
  clearSettingStatus();
  settingsConfigRequested = false;
  currentView.value = 'settings';
  requestServerConfigIfNeeded();
}

function closeSettings() {
  currentView.value = 'chat';
  scrollToLatestAfterRender();
}

function updateWsUrl(value: string) {
  agent.wsUrl.value = value;
  localStorage.setItem('agentbee.lastUrl', value);
}

function updateWsToken(value: string) {
  agent.wsToken.value = value;
}

const basicSettings = computed<BasicSettings>(() => ({
  apiKey: readString(agentConfig.value, ['agent_llm', 'api_key']),
  apiUrl: readString(agentConfig.value, ['agent_llm', 'api_url']),
  inSandbox: readBoolean(agentConfig.value, ['sandbox_mode'], true),
  modelName: readString(agentConfig.value, ['agent_llm', 'model']),
  workspacePath: readString(agentConfig.value, ['workspace_path']),
}));

function updateBasicSetting(field: keyof BasicSettings, value: boolean | string) {
  const nextConfig = cloneConfig(agentConfig.value);
  if (field === 'apiUrl') setNestedValue(nextConfig, ['agent_llm', 'api_url'], String(value));
  if (field === 'apiKey') setNestedValue(nextConfig, ['agent_llm', 'api_key'], String(value));
  if (field === 'inSandbox') setNestedValue(nextConfig, ['sandbox_mode'], Boolean(value));
  if (field === 'modelName') setNestedValue(nextConfig, ['agent_llm', 'model'], String(value));
  if (field === 'workspacePath') setNestedValue(nextConfig, ['workspace_path'], String(value));
  applyAgentConfig(nextConfig, { syncJson: true });
  configJsonError.value = '';
}

function updateConfigJson(value: string) {
  configJson.value = value;
  try {
    const parsed = JSON.parse(value);
    if (!isRecord(parsed)) {
      configJsonError.value = t.value.configJsonObjectError;
      return;
    }
    configJsonError.value = '';
    applyAgentConfig(parsed, { syncJson: false });
  } catch (error) {
    configJsonError.value = error instanceof Error ? error.message : t.value.configJsonParseError;
  }
}

function requestServerConfig() {
  sendSettingRequest('getConfig');
}

function requestServerConfigIfNeeded() {
  if (currentView.value !== 'settings' || settingsConfigRequested || !agent.canSend.value) return;
  settingsConfigRequested = true;
  requestServerConfig();
}

function requestDefaultServerConfig() {
  sendSettingRequest('getDefaultConfig');
}

function saveServerConfig() {
  const parsed = parseConfigJson(configJson.value);
  if (!parsed) return;
  saveAgentConfig(parsed);
}

function saveAgentConfig(
  config: Record<string, unknown>,
  options: { reconnect?: boolean; refreshModels?: boolean } = {},
) {
  const normalized = normalizeAgentConfig(config);
  applyAgentConfig(normalized, { syncJson: true });
  const sent = sendSettingRequest('saveConfig', normalized);
  if (!sent) return;
  refreshModelsAfterSave = options.refreshModels ?? true;
  reconnectAfterSave = options.reconnect ?? false;
}

function selectComposerModel(modelName: string) {
  if (!modelName || modelName === basicSettings.value.modelName) return;
  const nextConfig = cloneConfig(agentConfig.value);
  setNestedValue(nextConfig, ['agent_llm', 'model'], modelName);
  saveAgentConfig(nextConfig, { reconnect: true, refreshModels: true });
}

function requestModels(silent = false) {
  if (silent && !agent.canSend.value) return;
  const sent = agent.sendSystemAct('getModels');
  if (!sent) return;
  if (!silent) setSettingStatus(`${t.value.systemRequestSent}: getModels`, 'warning');
}

function sendSettingRequest(act: ClientSettingAct, content?: unknown) {
  const sent = agent.sendSettingAct(act, content);
  if (!sent) return false;
  setSettingStatus(`${t.value.settingRequestSent}: ${act}`, 'warning');
  return true;
}

function handleMemoryMessage(act: string, msg: ServerMessage) {
  const errorMessage = normalizeServerError(msg);

  if (act === 'read') {
    const mode = memoryReadMode.value;
    if (!mode) return;
    clearMemoryResponseTimer();
    memoryReadMode.value = null;
    if (mode === 'older') preserveHistoryScrollAfterUpdate();
    memoryLoading.value = false;
    if (errorMessage) {
      if (mode === 'older' || (mode === 'latest' && !memoryRecords.value.length)) {
        memoryError.value = errorMessage;
      }
      runPendingMemoryRead();
      return;
    }

    const page = sortUniqueMemoryRecords(parseMemoryRecords(msg.data));
    const responseTotal = toNonNegativeInteger(msg.total);
    if (mode === 'probe') {
      const currentLatestId = latestMemoryRecords.value[latestMemoryRecords.value.length - 1]?.create_id || 0;
      const probedLatestId = page[page.length - 1]?.create_id || 0;
      if (currentLatestId !== probedLatestId) pendingMemoryReadMode = 'latest';
      runPendingMemoryRead();
      return;
    }

    if (mode === 'latest') applyLatestMemorySnapshot(page, responseTotal);
    if (mode === 'older') applyOlderMemoryPage(page, responseTotal);
    memoryError.value = '';
    runPendingMemoryRead();
    return;
  }

  if (act === 'delete') {
    if (!memoryDeleting.value) return;
    clearMemoryResponseTimer();
    preserveHistoryScrollAfterUpdate();
    memoryDeleting.value = false;
    if (errorMessage) {
      memoryError.value = errorMessage;
      pendingMemoryDeleteIds = [];
      requestLatestMemorySync(true);
      return;
    }

    const deleted = toNonNegativeInteger(msg.deleted);
    const expected = pendingMemoryDeleteIds.length;
    const deletedIds = new Set(pendingMemoryDeleteIds);
    pendingMemoryDeleteIds = [];

    if (deleted !== expected) {
      memoryError.value = t.value.memoryDeleteMismatch;
      requestLatestMemorySync(true);
      return;
    }

    const nextLatestRecords = latestMemoryRecords.value
      .filter((record) => !deletedIds.has(record.create_id));
    latestMemoryRecords.value = nextLatestRecords;
    writeCachedMemoryRecords(nextLatestRecords);
    memoryRecords.value = memoryRecords.value
      .filter((record) => !deletedIds.has(record.create_id));
    memoryError.value = '';
    requestLatestMemorySync(true);
  }
}

function handleSettingMessage(act: string, content: unknown, msg: ServerMessage) {
  const errorMessage = normalizeServerError(msg);
  if (errorMessage) {
    setSettingStatus(errorMessage, 'error');
    return;
  }

  const config = parseSettingConfig(content);
  if (config && (act === 'getConfig' || act === 'getDefaultConfig' || !act)) {
    configJsonError.value = '';
    applyAgentConfig(config, { syncJson: true });
    setSettingStatus(act === 'getDefaultConfig'
      ? t.value.defaultConfigLoaded
      : t.value.serverConfigLoaded);
    return;
  }

  if (act === 'saveConfig') {
    setSettingStatus(t.value.serverConfigSaved);
    const shouldRefreshModels = refreshModelsAfterSave;
    const shouldReconnect = reconnectAfterSave;
    refreshModelsAfterSave = false;
    reconnectAfterSave = false;
    if (shouldReconnect) {
      if (shouldRefreshModels) requestModelsAfterNextConnect = true;
      agent.reconnect();
      return;
    }
    if (shouldRefreshModels) requestModels();
    return;
  }

  setSettingStatus(msg.message || t.value.settingResponseReceived);
}

function handleSystemMessage(act: string, content: unknown, msg: ServerMessage) {
  const errorMessage = normalizeServerError(msg);
  if (errorMessage) {
    setSettingStatus(errorMessage, 'error');
    return;
  }

  if (act === 'getModels') {
    const models = parseModels(content);
    if (models.length) {
      availableModels.value = models;
      setSettingStatus(`${t.value.modelsLoaded}: ${models.length}`);
      return;
    }
  }

  setSettingStatus(msg.message || t.value.systemResponseReceived);
}

function setSettingStatus(message: string, tone: SettingStatusTone = 'success') {
  settingStatus.value = message;
  settingStatusTone.value = tone;
}

function clearSettingStatus() {
  settingStatus.value = '';
  settingStatusTone.value = 'success';
}

function parseConfigJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    if (!isRecord(parsed)) {
      configJsonError.value = t.value.configJsonObjectError;
      return null;
    }
    configJsonError.value = '';
    return parsed;
  } catch (error) {
    configJsonError.value = error instanceof Error ? error.message : t.value.configJsonParseError;
    return null;
  }
}

function parseSettingConfig(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseModels(value: unknown): string[] {
  const models = new Set<string>();
  const seen = new WeakSet<object>();

  function visit(node: unknown, depth = 0) {
    if (depth > 6 || node == null) return;
    if (typeof node === 'string') {
      models.add(node);
      return;
    }
    if (typeof node === 'object') {
      if (seen.has(node as object)) return;
      seen.add(node as object);
    }
    if (typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((item) => visit(item, depth + 1));
      return;
    }
    Object.entries(node).forEach(([entryKey, entryValue]) => {
      if (entryKey === 'id' && typeof entryValue === 'string') models.add(entryValue);
      if (Array.isArray(entryValue) || isRecord(entryValue)) visit(entryValue, depth + 1);
    });
  }

  visit(value);
  return Array.from(models);
}

function parseMemoryRecords(value: unknown): MemoryRecord[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const createId = Number(item.create_id);
    if (!Number.isSafeInteger(createId) || createId <= 0) return [];

    const role = typeof item.role === 'string' && ['user', 'assistant', 'system', 'tool'].includes(item.role)
      ? item.role as MemoryRecord['role']
      : 'system';
    const content = typeof item.content === 'string'
      ? item.content
      : JSON.stringify(item.content ?? '', null, 2);

    return [{
      content,
      create_id: createId,
      create_time: typeof item.create_time === 'string' && item.create_time
        ? item.create_time
        : new Date(Math.floor(createId / 1000)).toLocaleString('zh-CN'),
      level: typeof item.level === 'string' ? item.level : 'misc',
      role,
    }];
  });
}

function applyLatestMemorySnapshot(page: MemoryRecord[], responseTotal: number | null) {
  const nextLatestRecords = page.slice(-MEMORY_LATEST_CACHE_SIZE);
  const oldestLatestId = nextLatestRecords[0]?.create_id || 0;
  const olderRuntimeRecords = oldestLatestId > 0
    ? memoryRecords.value.filter((record) => record.create_id < oldestLatestId)
    : [];
  const nextMemoryRecords = sortUniqueMemoryRecords([
    ...olderRuntimeRecords,
    ...nextLatestRecords,
  ]);
  const snapshotChanged = !memoryRecordListsEqual(
    latestMemoryRecords.value,
    nextLatestRecords,
  );

  if (snapshotChanged) {
    latestMemoryRecords.value = nextLatestRecords;
    writeCachedMemoryRecords(nextLatestRecords);
  }
  if (!memoryRecordListsEqual(memoryRecords.value, nextMemoryRecords)) {
    memoryRecords.value = nextMemoryRecords;
    maybeScrollAfterUpdate();
  }

  memoryHasMore.value = responseTotal !== null
    ? page.length < responseTotal
    : page.length === MEMORY_LATEST_CACHE_SIZE;
}

function applyOlderMemoryPage(page: MemoryRecord[], responseTotal: number | null) {
  const previousRecordCount = memoryRecords.value.length;
  const nextMemoryRecords = sortUniqueMemoryRecords([
    ...page,
    ...memoryRecords.value,
  ]);

  if (!memoryRecordListsEqual(memoryRecords.value, nextMemoryRecords)) {
    memoryRecords.value = nextMemoryRecords;
  }
  memoryHasMore.value = responseTotal !== null
    ? page.length < responseTotal
    : page.length === MEMORY_PAGE_SIZE;
  if (!page.length || nextMemoryRecords.length === previousRecordCount) {
    memoryHasMore.value = false;
  }
}

function sortUniqueMemoryRecords(records: MemoryRecord[]): MemoryRecord[] {
  const uniqueRecords = new Map<number, MemoryRecord>();
  records.forEach((record) => uniqueRecords.set(record.create_id, record));
  return Array.from(uniqueRecords.values())
    .sort((left, right) => left.create_id - right.create_id);
}

function memoryRecordListsEqual(left: MemoryRecord[], right: MemoryRecord[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((record, index) => {
    const candidate = right[index];
    return record.create_id === candidate.create_id &&
      record.create_time === candidate.create_time &&
      record.role === candidate.role &&
      record.level === candidate.level &&
      record.content === candidate.content;
  });
}

function mergeLocalAndMemoryMessages(
  localMessages: AgentChatMessage[],
  records: MemoryRecord[],
): AgentChatMessage[] {
  const memoryToLocalIndex = new Map<number, number>();
  let localSearchEnd = localMessages.length;

  for (let memoryIndex = records.length - 1; memoryIndex >= 0; memoryIndex -= 1) {
    const record = records[memoryIndex];
    const signature = getMessageSignature(record.role, record.content);
    let localIndex = localSearchEnd - 1;
    while (
      localIndex >= 0 &&
      getMessageSignature(localMessages[localIndex].role, localMessages[localIndex].content) !== signature
    ) {
      localIndex -= 1;
    }
    if (localIndex < 0) continue;
    memoryToLocalIndex.set(memoryIndex, localIndex);
    localSearchEnd = localIndex;
  }

  const messages: AgentChatMessage[] = [];
  let nextLocalIndex = 0;
  records.forEach((record, memoryIndex) => {
    const matchedLocalIndex = memoryToLocalIndex.get(memoryIndex);
    if (matchedLocalIndex === undefined) {
      messages.push(memoryRecordToChatMessage(record));
      return;
    }

    while (nextLocalIndex < matchedLocalIndex) {
      messages.push(localMessages[nextLocalIndex]);
      nextLocalIndex += 1;
    }
    messages.push({
      ...localMessages[matchedLocalIndex],
      isRemoteHistory: true,
      memoryCreateId: record.create_id,
    });
    nextLocalIndex = matchedLocalIndex + 1;
  });

  while (nextLocalIndex < localMessages.length) {
    messages.push(localMessages[nextLocalIndex]);
    nextLocalIndex += 1;
  }
  return messages;
}

function memoryRecordToChatMessage(record: MemoryRecord): AgentChatMessage {
  return {
    id: `memory-${record.create_id}`,
    role: record.role,
    content: record.content,
    time: record.create_time,
    status: record.role === 'assistant' ? 'done' : undefined,
    memoryCreateId: record.create_id,
    isRemoteHistory: true,
  };
}

function getMessageSignature(role: AgentChatMessage['role'], content: string): string {
  return `${role}\u0000${content.replace(/\r\n/g, '\n').trim()}`;
}

function toNonNegativeInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function readCachedMemoryRecords(): MemoryRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(MEMORY_CACHE_STORAGE_KEY) || '[]');
    return sortUniqueMemoryRecords(parseMemoryRecords(parsed))
      .slice(-MEMORY_LATEST_CACHE_SIZE);
  } catch {
    return [];
  }
}

function writeCachedMemoryRecords(records: MemoryRecord[]) {
  try {
    localStorage.setItem(
      MEMORY_CACHE_STORAGE_KEY,
      JSON.stringify(records.slice(-MEMORY_LATEST_CACHE_SIZE)),
    );
  } catch (error) {
    console.warn('BeeWeb could not update the server memory cache.', error);
  }
}

function startMemorySyncTimers() {
  stopMemorySyncTimers();
  memoryProbeTimer = window.setInterval(requestMemoryProbe, MEMORY_PROBE_INTERVAL_MS);
  memoryFullSyncTimer = window.setInterval(() => {
    if (document.visibilityState === 'visible') requestLatestMemorySync(true);
  }, MEMORY_FULL_SYNC_INTERVAL_MS);
}

function stopMemorySyncTimers() {
  if (memoryProbeTimer !== null) window.clearInterval(memoryProbeTimer);
  if (memoryFullSyncTimer !== null) window.clearInterval(memoryFullSyncTimer);
  if (memoryTurnSyncTimer !== null) window.clearTimeout(memoryTurnSyncTimer);
  memoryProbeTimer = null;
  memoryFullSyncTimer = null;
  memoryTurnSyncTimer = null;
}

function scheduleMemorySyncAfterTurn() {
  if (memoryTurnSyncTimer !== null) window.clearTimeout(memoryTurnSyncTimer);
  memoryTurnSyncTimer = window.setTimeout(() => {
    memoryTurnSyncTimer = null;
    requestLatestMemorySync(true);
  }, 500);
}

function handleWindowFocus() {
  if (document.visibilityState === 'visible') requestLatestMemorySync();
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') requestLatestMemorySync();
}

onMounted(() => {
  chatShellResizeObserver = new ResizeObserver(() => {
    if (!selectedSubAgent.value) return;
    const clampedWidth = clampSubAgentPaneWidth(subAgentPaneWidth.value);
    if (clampedWidth !== subAgentPaneWidth.value) {
      subAgentPaneWidth.value = clampedWidth;
      persistSubAgentPaneWidth();
    }
  });
  if (chatShell.value) chatShellResizeObserver.observe(chatShell.value);
  window.addEventListener('focus', handleWindowFocus);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  scrollToLatestAfterRender();
});

onBeforeUnmount(() => {
  stopMemorySyncTimers();
  clearMemoryResponseTimer();
  window.removeEventListener('focus', handleWindowFocus);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  chatShellResizeObserver?.disconnect();
  chatShellResizeObserver = null;
});

function readAgentConfig(): Record<string, unknown> {
  localStorage.removeItem('agentbee.agentConfig');
  return createDefaultAgentConfig();
}

function applyAgentConfig(
  nextConfig: Record<string, unknown>,
  options: { syncJson?: boolean } = {},
) {
  const syncJson = options.syncJson ?? true;
  agentConfig.value = normalizeAgentConfig(cloneConfig(nextConfig));
  if (syncJson) refreshConfigJson();
}

function refreshConfigJson() {
  configJson.value = stringifyConfig(agentConfig.value);
}

function stringifyConfig(config: Record<string, unknown>) {
  return JSON.stringify(toRaw(config), null, 2);
}

function cloneConfig(config: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(stringifyConfig(config)) as Record<string, unknown>;
}

function createDefaultAgentConfig(): Record<string, unknown> {
  return {
    agent_server: {
      host: '127.0.0.1',
      port: 8686,
      ping_interval: 60,
    },
    agent_llm: {
      api_url: 'http://127.0.0.1:1234/v1',
      api_key: 'sk-lm-ru6XiZDE:WImxJO82hxm5L76fNcaK',
      model: 'qwen3.6-35b-a3b-genesis-v2-apex',
      org_id: '',
      hw_hash: '',
      timeout: 600,
      keep_reasons: false,
      params: {
        max_completion_tokens: 65536,
        temperature: 0.8,
        min_p: 0,
        top_p: 0.95,
        top_k: 40,
        frequency_penalty: 0,
        presence_penalty: 1,
        repetition_penalty: 1,
        enable_thinking: false,
        stop: [
          '<|im_end|>',
          '<|endoftext|>',
        ],
        chat_template_kwargs: {
          enable_thinking: false,
        },
        extra_body: {
          enable_thinking: false,
        },
        thinking: {
          type: 'enable',
        },
      },
    },
    max_ctx_len: 50,
    memory_limit: '4G',
    sandbox_mode: false,
    workspace_path: '',
    agent_debug: 'trace',
    socket_debug: false,
  };
}

function normalizeAgentConfig(config: Record<string, unknown>): Record<string, unknown> {
  const nextConfig = clonePlainRecord(config);
  const toolsConfig = isRecord(nextConfig.agent_tools) ? nextConfig.agent_tools : null;
  const llmConfig = isRecord(nextConfig.agent_llm) ? nextConfig.agent_llm : null;

  if (!('workspace_path' in nextConfig) && toolsConfig && typeof toolsConfig.workspace_path === 'string') {
    nextConfig.workspace_path = toolsConfig.workspace_path;
  }
  if (!('sandbox_mode' in nextConfig) && toolsConfig && typeof toolsConfig.in_sandbox === 'boolean') {
    nextConfig.sandbox_mode = toolsConfig.in_sandbox;
  }
  if (llmConfig && typeof llmConfig.work_name === 'string') {
    llmConfig.worker_name = llmConfig.work_name;
  }

  delete nextConfig.agent_tools;
  if (llmConfig) delete llmConfig.work_name;
  if ('debug' in nextConfig && !('agent_debug' in nextConfig)) {
    nextConfig.agent_debug = nextConfig.debug;
  }
  delete nextConfig.debug;

  return nextConfig;
}

function clonePlainRecord(config: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readString(source: Record<string, unknown>, path: string[]): string {
  const value = readNestedValue(source, path);
  return typeof value === 'string' ? value : '';
}

function readBoolean(source: Record<string, unknown>, path: string[], fallback: boolean): boolean {
  const value = readNestedValue(source, path);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return fallback;
}

function readNestedValue(source: Record<string, unknown>, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => (
    isRecord(current) ? current[key] : undefined
  ), source);
}

function setNestedValue(source: Record<string, unknown>, path: string[], value: unknown) {
  let current = source;
  path.slice(0, -1).forEach((key) => {
    if (!isRecord(current[key])) current[key] = {};
    current = current[key] as Record<string, unknown>;
  });
  current[path[path.length - 1]] = value;
}
</script>

<template>
  <LoginWin
    v-if="showLoginWindow"
    :connection-error="agent.connectionError.value"
    :connecting="agent.connecting.value"
    :labels="t"
    :ws-token="agent.wsToken.value"
    :ws-url="agent.wsUrl.value"
    @connect="agent.connect"
    @update:ws-token="updateWsToken"
    @update:ws-url="updateWsUrl"
  />

  <div class="app" :class="{ 'sidebar-collapsed': sidebarCollapsed }">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-copy">
          <h1>AgentBee Web</h1>
          <p>{{ t.tagline }}</p>
        </div>
        <div class="brand-controls">
          <button
            type="button"
            class="icon-button"
            :title="sidebarCollapsed ? t.expandSidebar : t.collapseSidebar"
            @click="toggleSidebar"
          >
            <PanelLeftOpen v-if="sidebarCollapsed" :size="17" aria-hidden="true" />
            <PanelLeftClose v-else :size="17" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div class="sidebar-body">
        <div class="side-actions">
          <button type="button" class="icon-text-button" :title="t.newSession" @click="createSession">
            <Plus :size="16" aria-hidden="true" />
            <span>{{ t.newSession }}</span>
          </button>
        </div>

        <SessionList
          :labels="t"
          :sessions="sessions.sessions.value"
          :active-session-id="sessions.activeSessionId.value"
          @delete-session="deleteSession"
          @select="selectSession"
        />

        <ConnectionPanel
          :labels="t"
          :auto-connect-paused="agent.autoConnectPaused.value"
          :connected="agent.connected.value"
          :connecting="agent.connecting.value"
          @open-settings="openSettings"
        />
      </div>
    </aside>

    <main class="main">
      <header class="topbar">
        <div class="topbar-title">
          <strong>{{ currentView === 'settings' ? t.settings : (sessions.activeSession.value?.title || t.newConversation) }}</strong>
          <span>{{ activeMeta }}</span>
        </div>
        <div class="topbar-actions">
          <SubAgentMenu
            v-if="currentView === 'chat' && subAgents.length"
            :agents="subAgents"
            :labels="t"
            :selected-agent-name="selectedSubAgentName"
            @delete-sub-agent="deleteSubAgent"
            @select-agent="selectSubAgent"
          />
          <button
            v-if="currentView === 'settings'"
            type="button"
            class="topbar-close icon-button"
            :title="t.closeSettings"
            @click="closeSettings"
          >
            <X :size="17" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div
        v-if="currentView === 'chat'"
        ref="chatShell"
        class="chat-shell"
        :class="{
          'has-subagent': selectedSubAgent,
          'is-resizing': isSubAgentResizing,
        }"
        :style="{ '--subagent-pane-width': `${subAgentPaneWidth}px` }"
      >
        <div class="chat-pane">
          <section ref="chatContainer" class="chat-area" @scroll="onScroll">
            <div v-if="memoryLoading" class="history-load-state" role="status">
              <LoaderCircle class="spin" :size="15" aria-hidden="true" />
              <span>{{ t.loadingMemory }}</span>
            </div>
            <div v-else-if="memoryError" class="history-load-state error" role="alert">
              <span>{{ memoryError }}</span>
              <button
                type="button"
                class="history-retry-button"
                :title="t.retry"
                :disabled="!agent.canSend.value"
                @click="retryMemoryHistory"
              >
                <RefreshCw :size="14" aria-hidden="true" />
              </button>
            </div>
            <div
              v-else-if="!memoryHasMore && !hasOlderMessages && agent.canSend.value"
              class="history-load-state"
            >
              <History :size="14" aria-hidden="true" />
              <span>{{ t.noEarlierMemory }}</span>
            </div>
            <div v-if="!visibleChatItems.length && !memoryLoading" class="empty">
              {{ t.empty }}
            </div>
            <template v-for="item in visibleChatItems" :key="item.key">
              <SystemLogGroup
                v-if="item.type === 'system-group'"
                :labels="t"
                :messages="item.messages"
              />
              <ChatMessage
                v-else
                :labels="t"
                :message="item.message"
                :show-debug-info="showDebugInfo"
                :deleting-memory="memoryDeleting && pendingMemoryDeleteIds.includes(item.message.memoryCreateId || 0)"
                :memory-delete-disabled="!agent.canSend.value || memoryReadMode !== null || memoryDeleting"
                @delete-memory-message="deleteMemoryMessage"
                @resend-user-message="resendUserMessage"
                @update-user-message="updateAndResendUserMessage"
              />
            </template>
          </section>
          <button
            v-if="!shouldAutoScroll"
            type="button"
            class="scroll-bottom-floating"
            :title="t.scrollToBottom"
            @click="scrollToBottom"
          >
            <ArrowDownToLine :size="18" aria-hidden="true" />
          </button>
        </div>

        <div
          v-if="selectedSubAgent"
          class="subagent-resizer"
          role="separator"
          tabindex="0"
          aria-orientation="vertical"
          :aria-label="t.resizeSubAgentPanel"
          :aria-valuemin="SUB_AGENT_MIN_WIDTH"
          :aria-valuemax="SUB_AGENT_MAX_WIDTH"
          :aria-valuenow="subAgentPaneWidth"
          @keydown="resizeSubAgentWithKeyboard"
          @pointerdown="startSubAgentResize"
          @pointermove="resizeSubAgentPanel"
          @pointerup="stopSubAgentResize"
          @pointercancel="stopSubAgentResize"
        ></div>

        <SubAgentPanel
          v-if="selectedSubAgent"
          :agent="selectedSubAgent"
          :labels="t"
          :messages="subAgentMessages"
          :show-debug-info="showDebugInfo"
          @close="closeSubAgentPanel"
          @resend-user-message="resendUserMessage"
          @update-user-message="updateAndResendUserMessage"
        />
      </div>

      <SettingsView
        v-else-if="currentView === 'settings'"
        :app-version="appVersion"
        :basic-settings="basicSettings"
        :connected="agent.connected.value"
        :connecting="agent.connecting.value"
        :config-json="configJson"
        :config-json-error="configJsonError"
        :labels="t"
        :locale="locale"
        :setting-status="settingStatus"
        :setting-status-tone="settingStatusTone"
        :show-debug-info="showDebugInfo"
        :theme="theme"
        :ws-token="agent.wsToken.value"
        :ws-url="agent.wsUrl.value"
        @connect="agent.connect"
        @disconnect="agent.disconnect"
        @get-config="requestServerConfig"
        @get-default-config="requestDefaultServerConfig"
        @save-config="saveServerConfig"
        @set-locale="setLocale"
        @set-theme="setTheme"
        @update:basic-setting="updateBasicSetting"
        @update:config-json="updateConfigJson"
        @update:show-debug-info="showDebugInfo = $event"
        @update:ws-token="updateWsToken"
        @update:ws-url="updateWsUrl"
      />

      <Composer
        v-if="currentView === 'chat'"
        :labels="t"
        :disabled="!agent.canSend.value"
        :available-models="availableModels"
        :model-name="basicSettings.modelName"
        @select-model="selectComposerModel"
        @send="onSend"
        @stop="agent.stopCurrent"
      />
    </main>
  </div>
</template>
