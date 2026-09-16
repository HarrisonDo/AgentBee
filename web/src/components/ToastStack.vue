<script setup lang="ts">
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-vue-next';
import type { ToastItem } from '../composables/useToasts';

defineProps<{
  toasts: ToastItem[];
  dismissLabel: string;
}>();

const emit = defineEmits<{
  dismiss: [string];
}>();

const icons = {
  error: AlertCircle,
  info: Info,
  success: CheckCircle2,
} as const;
</script>

<template>
  <Teleport to="body">
    <!-- 容器本身不吃点击（pointer-events: none），只有每条提示可交互，不挡底下的界面。 -->
    <div class="toast-stack">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="toast"
        :class="`toast-${toast.tone}`"
        :role="toast.tone === 'error' ? 'alert' : 'status'"
      >
        <component :is="icons[toast.tone] || icons.info" class="toast-icon" :size="16" aria-hidden="true" />
        <p class="toast-message">{{ toast.message }}</p>
        <button
          type="button"
          class="icon-button toast-close"
          :title="dismissLabel"
          :aria-label="dismissLabel"
          @click="emit('dismiss', toast.id)"
        >
          <X :size="14" aria-hidden="true" />
        </button>
      </div>
    </div>
  </Teleport>
</template>
