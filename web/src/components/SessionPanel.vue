<script setup lang="ts">
import { nextTick, ref } from 'vue';
import {
  LoaderCircle,
  MessageSquarePlus,
  Pencil,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-vue-next';
import { MAX_SESSION_TITLE_LENGTH, normalizeSessionTitle } from '../composables/useSessions';
import type { ChatSession } from '../protocol/types';

const props = defineProps<{
  labels: Record<string, string>;
  sessions: ChatSession[];
  activeSessionId: string;
  loading: boolean;
  /**
   * 正在流式输出的会话 id。
   * 只用来打「生成中」标记，**不再阻止切换**：每一轮都记住了自己的归属会话，
   * 切走之后后端推来的内容仍会落回原会话。
   */
  streamingSessionIds: string[];
  canRequest: boolean;
  /** 会话相关的错误（读取超时 / 删除失败 / 标题为空），为空则不显示。 */
  error?: string;
  /**
   * 移动端抽屉里用：标题栏右侧多给一个关闭按钮。
   * 面板本身不关心宽度，桌面侧栏里不传就不显示。
   */
  showClose?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  newSession: [];
  refresh: [];
  remove: [string];
  rename: [string, string];
  select: [string];
}>();

/**
 * 正在重命名的会话 id（同一时刻只允许一条进入编辑态）。
 * `editInputEl` 用函数 ref 挂载：`ref` 写在 `v-for` 里会被收集成数组，
 * 这里只有一个输入框实例，函数 ref 拿到的就是元素本身。
 */
const editingSessionId = ref('');
const editingTitle = ref('');
const editInputEl = ref<HTMLInputElement | null>(null);

function bindEditInput(el: unknown) {
  editInputEl.value = el instanceof HTMLInputElement ? el : null;
}

async function startRename(session: ChatSession) {
  editingSessionId.value = session.id;
  editingTitle.value = session.title;
  await nextTick();
  editInputEl.value?.focus();
  editInputEl.value?.select();
}

function cancelRename() {
  editingSessionId.value = '';
  editingTitle.value = '';
}

/**
 * 提交重命名。空标题 / 没改动都当作「放弃」，保持原名——不弹错，
 * 也不会让用户觉得名字被系统悄悄改掉了。
 */
function commitRename(session: ChatSession) {
  if (editingSessionId.value !== session.id) return;
  const raw = editingTitle.value;
  // 先退出编辑态：下面无论是提交还是放弃，输入框都不该继续留着。
  cancelRename();
  const normalized = normalizeSessionTitle(raw);
  if (!normalized || normalized === session.title) return;
  emit('rename', session.id, normalized);
}

function onEditKeydown(event: KeyboardEvent, session: ChatSession) {
  if (event.key === 'Enter') {
    event.preventDefault();
    commitRename(session);
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    // 先清掉 id，随后可能触发的 blur 会因为 id 不匹配而变成空操作。
    cancelRename();
  }
}

function sessionTime(session: ChatSession): string {
  const parsed = Date.parse(session.updatedAt);
  if (!Number.isFinite(parsed)) return '';
  const date = new Date(parsed);
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} `
    + `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function canRemove(session: ChatSession): boolean {
  return props.canRequest || props.sessions.length > 1;
}

function isStreaming(session: ChatSession): boolean {
  return props.streamingSessionIds.includes(session.id);
}

function sessionTitle(session: ChatSession): string {
  return isStreaming(session)
    ? `${session.title} · ${props.labels.sessionStreaming}`
    : session.title;
}
</script>

<template>
  <section class="session-panel" :aria-label="labels.sessions">
    <header class="session-panel-head">
      <strong>{{ labels.sessions }}</strong>
      <span class="session-panel-tools">
        <button
          type="button"
          class="icon-button session-panel-tool"
          :title="labels.newSession"
          @click="emit('newSession')"
        >
          <MessageSquarePlus :size="15" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="icon-button session-panel-tool"
          :title="labels.refreshSessions"
          :disabled="!canRequest || loading"
          @click="emit('refresh')"
        >
          <LoaderCircle v-if="loading" class="spin" :size="15" aria-hidden="true" />
          <RefreshCw v-else :size="15" aria-hidden="true" />
        </button>
        <button
          v-if="showClose"
          type="button"
          class="icon-button session-panel-tool"
          :title="labels.closeSessions"
          :aria-label="labels.closeSessions"
          @click="emit('close')"
        >
          <X :size="16" aria-hidden="true" />
        </button>
      </span>
    </header>

    <div class="session-list" role="list">
      <p v-if="!sessions.length" class="session-empty">{{ labels.noSessions }}</p>
      <div
        v-for="session in sessions"
        :key="session.id"
        class="session-item"
        :class="{
          active: session.id === activeSessionId,
          streaming: isStreaming(session),
          editing: session.id === editingSessionId,
        }"
        role="listitem"
      >
        <input
          v-if="session.id === editingSessionId"
          :ref="bindEditInput"
          v-model="editingTitle"
          class="session-item-edit"
          type="text"
          :maxlength="MAX_SESSION_TITLE_LENGTH"
          :aria-label="labels.renameSession"
          :placeholder="labels.renameSessionHint"
          @blur="commitRename(session)"
          @keydown="onEditKeydown($event, session)"
        />
        <template v-else>
          <button
            type="button"
            class="session-item-main"
            :title="sessionTitle(session)"
            @click="emit('select', session.id)"
            @dblclick.prevent="startRename(session)"
          >
            <span class="session-item-title">{{ session.title }}</span>
            <span class="session-item-time">{{ sessionTime(session) }}</span>
          </button>
          <LoaderCircle
            v-if="isStreaming(session)"
            class="session-item-spinner spin"
            :size="13"
            aria-hidden="true"
          />
          <button
            type="button"
            class="icon-button session-item-rename"
            :title="labels.renameSession"
            @click="startRename(session)"
          >
            <Pencil :size="13" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="icon-button session-item-delete"
            :title="labels.deleteSession"
            :disabled="!canRemove(session)"
            @click="emit('remove', session.id)"
          >
            <Trash2 :size="14" aria-hidden="true" />
          </button>
        </template>
      </div>
    </div>

    <p v-if="error" class="session-error" role="alert">{{ error }}</p>
  </section>
</template>
