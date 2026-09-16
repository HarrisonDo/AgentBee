<script setup lang="ts">
import { PlugZap, RefreshCw, Settings } from 'lucide-vue-next';
import { computed } from 'vue';
import type { ConnectionState } from '../composables/useWebSocketAgent';

const props = defineProps<{
  autoConnectPaused: boolean;
  connected: boolean;
  connecting: boolean;
  connectionError: string;
  connectionState: ConnectionState;
  labels: Record<string, string>;
}>();

const emit = defineEmits<{
  connect: [];
  openSettings: [];
}>();

const statusLabel = computed(() => ({
  connected: props.labels.connected,
  connecting: props.labels.connecting,
  idle: props.labels.notConnected,
  offline: props.labels.connectionOfflineShort,
  paused: props.labels.waitingManualConnect,
  retrying: props.labels.reconnecting,
})[props.connectionState]);
</script>

<template>
  <div class="connection">
    <div class="connection-compact">
      <div class="status-pill" :title="connectionError || statusLabel">
        <span
          class="dot"
          :class="{
            connected,
            connecting: connectionState === 'connecting' || connectionState === 'retrying',
            offline: connectionState === 'offline',
            paused: autoConnectPaused && !connected,
          }"
        ></span>
        <span>{{ statusLabel }}</span>
      </div>
      <button
        v-if="!connected"
        type="button"
        class="connection-action icon-button"
        :title="labels.reconnect"
        :disabled="connecting"
        @click="emit('connect')"
      >
        <RefreshCw v-if="connectionState === 'retrying'" :class="{ spin: connecting }" :size="16" aria-hidden="true" />
        <PlugZap v-else :size="16" aria-hidden="true" />
      </button>
      <button type="button" class="icon-button" :title="labels.settings" @click="emit('openSettings')">
        <Settings :size="16" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
