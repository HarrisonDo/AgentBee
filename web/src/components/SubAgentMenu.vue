<script setup lang="ts">
import { Bot, ChevronDown, Trash2, UsersRound } from 'lucide-vue-next';
import { onBeforeUnmount, onMounted, ref } from 'vue';

export interface SubAgentSummary {
  count: number;
  lastActive: string;
  name: string;
  role: string;
  status: string;
}

defineProps<{
  agents: SubAgentSummary[];
  labels: Record<string, string>;
  selectedAgentName: string | null;
}>();

const emit = defineEmits<{
  deleteSubAgent: [agentName: string];
  selectAgent: [agentName: string];
}>();

const isOpen = ref(false);
const menuRoot = ref<HTMLElement | null>(null);

function toggleMenu() {
  isOpen.value = !isOpen.value;
}

function selectAgent(agentName: string) {
  emit('selectAgent', agentName);
  isOpen.value = false;
}

function deleteSubAgent(agentName: string) {
  emit('deleteSubAgent', agentName);
}

function getAgentInitial(agentName: string) {
  return Array.from(agentName.trim())[0]?.toUpperCase() || '?';
}

function getAgentStatusLabel(status: string, labels: Record<string, string>) {
  return {
    loading: labels.subAgentRunning,
    done: labels.subAgentCompleted,
    error: labels.subAgentError,
    stopped: labels.subAgentStopped,
  }[status] || labels.subAgentCompleted;
}

function onDocumentPointerDown(event: PointerEvent) {
  if (!menuRoot.value?.contains(event.target as Node)) {
    isOpen.value = false;
  }
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') isOpen.value = false;
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown);
  document.addEventListener('keydown', onDocumentKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown);
  document.removeEventListener('keydown', onDocumentKeydown);
});
</script>

<template>
  <div ref="menuRoot" class="subagent-menu">
    <button
      type="button"
      class="subagent-menu-trigger"
      :class="{ active: isOpen || selectedAgentName }"
      :aria-expanded="isOpen"
      aria-haspopup="menu"
      :title="labels.subAgents"
      @click="toggleMenu"
    >
      <UsersRound :size="17" aria-hidden="true" />
      <span class="subagent-menu-count">{{ agents.length }}</span>
      <ChevronDown :size="14" aria-hidden="true" />
    </button>

    <div v-if="isOpen" class="subagent-menu-popover" role="menu">
      <div class="subagent-menu-heading">
        <span>{{ labels.subAgents }}</span>
        <span>{{ agents.length }}</span>
      </div>
      <div class="subagent-menu-list">
        <div
          v-for="agent in agents"
          :key="agent.name"
          class="subagent-menu-row"
          :class="{ selected: selectedAgentName === agent.name }"
        >
          <button
            type="button"
            class="subagent-menu-select"
            role="menuitem"
            @click="selectAgent(agent.name)"
          >
            <span class="subagent-avatar" aria-hidden="true">
              {{ getAgentInitial(agent.name) }}
              <i class="subagent-status-dot" :class="agent.status || 'done'"></i>
            </span>
            <span class="subagent-menu-copy">
              <strong>{{ agent.name }}</strong>
              <span>
                {{ agent.role || labels.subAgent }} · {{ getAgentStatusLabel(agent.status, labels) }} · {{ agent.count }} {{ labels.items }}
              </span>
            </span>
            <Bot :size="15" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="subagent-menu-delete"
            :title="labels.deleteSubAgent"
            @click.stop="deleteSubAgent(agent.name)"
          >
            <Trash2 :size="14" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.subagent-menu {
  position: relative;
}

.subagent-menu-trigger {
  height: 32px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0 9px;
  color: var(--muted);
  background: transparent;
  border-color: var(--line-soft);
}

.subagent-menu-trigger:hover,
.subagent-menu-trigger.active {
  color: var(--text);
  background: var(--surface-raised);
  border-color: var(--line);
}

.subagent-menu-count {
  min-width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 5px;
  border-radius: 999px;
  color: var(--text);
  background: var(--accent-soft);
  font-size: 0.72rem;
  font-weight: 700;
}

.subagent-menu-popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 40;
  width: min(320px, calc(100vw - 24px));
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: var(--shadow);
}

.subagent-menu-heading {
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  border-bottom: 1px solid var(--line-soft);
  color: var(--muted);
  font-size: 0.74rem;
  font-weight: 700;
}

.subagent-menu-list {
  max-height: min(420px, calc(100vh - 100px));
  overflow-y: auto;
  padding: 6px;
}

.subagent-menu-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 30px;
  align-items: center;
  border-radius: 6px;
}

.subagent-menu-row:hover,
.subagent-menu-row.selected {
  background: var(--surface-soft);
}

.subagent-menu-select {
  min-width: 0;
  min-height: 52px;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) 18px;
  align-items: center;
  gap: 9px;
  padding: 7px 6px;
  text-align: left;
  color: var(--text);
  background: transparent;
  border: 0;
}

.subagent-menu-select:hover {
  background: transparent;
  border-color: transparent;
}

.subagent-avatar {
  position: relative;
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: white;
  background: var(--accent-strong);
  font-size: 0.82rem;
  font-weight: 750;
}

.subagent-status-dot {
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 10px;
  height: 10px;
  border: 2px solid var(--surface);
  border-radius: 50%;
  background: var(--faint);
}

.subagent-status-dot.loading {
  background: var(--success);
}

.subagent-status-dot.error {
  background: var(--danger);
}

.subagent-status-dot.stopped {
  background: var(--warn);
}

.subagent-menu-copy {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.subagent-menu-copy strong,
.subagent-menu-copy span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subagent-menu-copy strong {
  font-size: 0.8rem;
}

.subagent-menu-copy span {
  color: var(--muted);
  font-size: 0.7rem;
}

.subagent-menu-delete {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  color: var(--faint);
  background: transparent;
  border: 0;
}

.subagent-menu-delete:hover {
  color: var(--danger);
  background: var(--danger-soft);
}
</style>
