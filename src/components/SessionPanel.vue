<script setup lang="ts">
import { LoaderCircle, MessageSquarePlus, RefreshCw, Trash2 } from 'lucide-vue-next';
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
}>();

const emit = defineEmits<{
  newSession: [];
  refresh: [];
  remove: [string];
  select: [string];
}>();

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
      </span>
    </header>

    <div class="session-list" role="list">
      <p v-if="!sessions.length" class="session-empty">{{ labels.noSessions }}</p>
      <div
        v-for="session in sessions"
        :key="session.id"
        class="session-item"
        :class="{ active: session.id === activeSessionId, streaming: isStreaming(session) }"
        role="listitem"
      >
        <button
          type="button"
          class="session-item-main"
          :title="sessionTitle(session)"
          @click="emit('select', session.id)"
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
          class="icon-button session-item-delete"
          :title="labels.deleteSession"
          :disabled="!canRemove(session)"
          @click="emit('remove', session.id)"
        >
          <Trash2 :size="14" aria-hidden="true" />
        </button>
      </div>
    </div>
  </section>
</template>
