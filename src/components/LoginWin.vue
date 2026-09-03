<script setup lang="ts">
import { KeyRound, Link, LogIn } from 'lucide-vue-next';

const props = defineProps<{
  connectionError: boolean;
  connecting: boolean;
  labels: Record<string, string>;
  wsToken: string;
  wsUrl: string;
}>();

const emit = defineEmits<{
  connect: [];
  'update:wsToken': [value: string];
  'update:wsUrl': [value: string];
}>();
</script>

<template>
  <div class="login-window-backdrop">
    <form
      class="login-window"
      role="dialog"
      aria-modal="true"
      aria-labelledby="loginWindowTitle"
      @submit.prevent="emit('connect')"
    >
      <div class="login-window-title">
        <div class="login-window-mark" aria-hidden="true">
          <LogIn :size="19" />
        </div>
        <div>
          <h1 id="loginWindowTitle">AgentBee Web</h1>
          <p>{{ labels.initialConnection }}</p>
        </div>
      </div>

      <label class="settings-field" for="initialWsUrl">
        <span>
          <Link :size="14" aria-hidden="true" />
          {{ labels.wsUrl }}
        </span>
        <input
          id="initialWsUrl"
          :value="wsUrl"
          type="text"
          placeholder="ws://127.0.0.1:8686"
          spellcheck="false"
          @input="emit('update:wsUrl', ($event.target as HTMLInputElement).value)"
        />
      </label>

      <label class="settings-field" for="initialWsToken">
        <span>
          <KeyRound :size="14" aria-hidden="true" />
          {{ labels.wsToken }}
        </span>
        <input
          id="initialWsToken"
          :value="wsToken"
          type="password"
          autocomplete="off"
          autofocus
          :placeholder="labels.wsTokenPlaceholder"
          @input="emit('update:wsToken', ($event.target as HTMLInputElement).value)"
        />
      </label>

      <div v-if="connectionError" class="login-window-error" role="alert" aria-live="polite">
        {{ labels.wsConnectionError }}
      </div>

      <button
        type="submit"
        class="login-window-submit icon-text-button"
        :disabled="connecting || !props.wsUrl.trim()"
      >
        <LogIn :size="16" aria-hidden="true" />
        <span>{{ connecting ? labels.connecting : labels.connect }}</span>
      </button>
    </form>
  </div>
</template>
