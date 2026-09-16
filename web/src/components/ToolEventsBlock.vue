<script setup lang="ts">
import { computed, ref } from 'vue';
import { Wrench } from 'lucide-vue-next';
import type { ToolEvent } from '../protocol/types';

const props = defineProps<{
  events: ToolEvent[];
  labels: Record<string, string>;
}>();

const expanded = ref(false);
const openGroups = ref(new Set<ToolEvent['kind']>());
const openEvents = ref(new Set<string>());

const groupedEvents = computed(() => {
  const calls = props.events.filter((event) => event.kind === 'tool_calls');
  const results = props.events.filter((event) => event.kind === 'tool_result');

  return [
    { kind: 'tool_calls' as const, title: props.labels.toolCalls, count: calls.length, events: calls },
    { kind: 'tool_result' as const, title: props.labels.toolResults, count: results.length, events: results },
  ].filter((group) => group.count > 0);
});

const toolNames = computed(() => {
  const names = props.events.map((event) => event.name || event.summary).filter(Boolean);
  return Array.from(new Set(names)).slice(0, 3);
});

const summary = computed(() => {
  const calls = props.events.filter((event) => event.kind === 'tool_calls').length;
  const total = calls || props.events.length;
  const suffix = toolNames.value.length ? ` · ${toolNames.value.join(', ')}` : '';
  const commandLabel = total === 1 ? props.labels.command : props.labels.commands;
  return `${props.labels.ranCommands} ${total} ${commandLabel}${suffix}`;
});

function groupIsOpen(kind: ToolEvent['kind']) {
  return openGroups.value.has(kind);
}

function eventIsOpen(event: ToolEvent, index: number) {
  return openEvents.value.has(eventKey(event, index));
}

function toggleGroup(kind: ToolEvent['kind']) {
  const next = new Set(openGroups.value);
  if (next.has(kind)) {
    next.delete(kind);
  } else {
    next.add(kind);
  }
  openGroups.value = next;
}

function toggleEvent(event: ToolEvent, index: number) {
  const key = eventKey(event, index);
  const next = new Set(openEvents.value);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  openEvents.value = next;
}

function eventKey(event: ToolEvent, index: number) {
  return `${event.kind}-${event.id || index}`;
}
</script>

<template>
  <section class="codex-fold tool-stack" :class="{ expanded }">
    <button
      type="button"
      class="codex-fold-head"
      :title="expanded ? labels.collapse : labels.expand"
      @click="expanded = !expanded"
    >
      <Wrench class="codex-fold-icon" :size="14" aria-hidden="true" />
      <span class="codex-fold-title">{{ summary }}</span>
    </button>

    <div v-if="expanded" class="tool-stack-body">
      <section
        v-for="group in groupedEvents"
        :key="group.kind"
        class="tool-group"
        :class="group.kind"
      >
        <button type="button" class="tool-group-head" @click="toggleGroup(group.kind)">
          <span class="fold-chevron" :class="{ open: groupIsOpen(group.kind) }" aria-hidden="true"></span>
          <span>{{ group.title }}</span>
          <span class="tool-count">{{ group.count }}</span>
        </button>

        <div v-if="groupIsOpen(group.kind)" class="tool-event-list">
          <article
            v-for="(event, index) in group.events"
            :key="eventKey(event, index)"
            class="tool-event"
            :class="{ open: eventIsOpen(event, index), failed: event.ok === false }"
          >
            <button type="button" class="tool-event-head" @click="toggleEvent(event, index)">
              <span class="tool-status-dot"></span>
              <span class="tool-event-name">{{ event.name || event.summary || labels.toolEvent }}</span>
              <span v-if="event.ok === false" class="tool-status-label">{{ labels.failed }}</span>
              <span class="tool-event-time">{{ event.time }}</span>
            </button>
            <div v-if="event.summary" class="tool-event-summary">{{ event.summary }}</div>
            <pre v-if="eventIsOpen(event, index)" class="tool-event-data">{{ event.data }}</pre>
          </article>
        </div>
      </section>
    </div>
  </section>
</template>
