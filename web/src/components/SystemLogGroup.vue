<script setup lang="ts">
import { computed, ref } from 'vue';
import { SquareTerminal } from 'lucide-vue-next';
import type { ChatMessage } from '../protocol/types';

const props = defineProps<{
  labels: Record<string, string>;
  messages: ChatMessage[];
}>();

const expanded = ref(false);

const summary = computed(() => {
  const total = props.messages.length;
  const countLabel = total === 1 ? props.labels.event : props.labels.events;
  const latest = props.messages[props.messages.length - 1]?.content?.replace(/\s+/g, ' ').trim() || '';
  return latest
    ? `${props.labels.roleSystem} ${total} ${countLabel} · ${latest}`
    : `${props.labels.roleSystem} ${total} ${countLabel}`;
});
</script>

<template>
  <section class="message system system-log-group">
    <section class="codex-fold system-stack" :class="{ expanded }">
      <button
        type="button"
        class="codex-fold-head"
        :title="expanded ? labels.collapse : labels.expand"
        @click="expanded = !expanded"
      >
        <SquareTerminal class="codex-fold-icon" :size="14" aria-hidden="true" />
        <span class="codex-fold-title">{{ summary }}</span>
      </button>

      <div v-if="expanded" class="system-stack-body">
        <article v-for="message in messages" :key="message.id" class="system-log-entry">
          <span class="system-log-text">{{ message.content }}</span>
          <span class="system-log-time">{{ message.time }}</span>
        </article>
      </div>
    </section>
  </section>
</template>
