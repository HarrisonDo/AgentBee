<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { Trash2, X } from 'lucide-vue-next';

defineProps<{
  cancelLabel: string;
  confirmLabel: string;
  message: string;
  title: string;
}>();

const emit = defineEmits<{
  cancel: [];
  confirm: [];
}>();

const cancelButton = ref<HTMLButtonElement | null>(null);
const dialog = ref<HTMLElement | null>(null);
let previouslyFocused: HTMLElement | null = null;

onMounted(() => {
  previouslyFocused = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  nextTick(() => cancelButton.value?.focus());
});

onBeforeUnmount(() => {
  if (previouslyFocused?.isConnected && !previouslyFocused.hasAttribute('disabled')) {
    previouslyFocused.focus();
  }
});

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('cancel');
    return;
  }

  if (event.key !== 'Tab' || !dialog.value) return;
  const buttons = Array.from(dialog.value.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  if (!first || !last) return;

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="confirm-dialog-backdrop" @click.self="emit('cancel')" @keydown="onKeydown">
      <section
        ref="dialog"
        class="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirmDialogTitle"
        aria-describedby="confirmDialogMessage"
      >
        <header class="confirm-dialog-header">
          <span class="confirm-dialog-icon" aria-hidden="true">
            <Trash2 :size="18" />
          </span>
          <h2 id="confirmDialogTitle">{{ title }}</h2>
          <button
            type="button"
            class="confirm-dialog-close icon-button"
            :title="cancelLabel"
            :aria-label="cancelLabel"
            @click="emit('cancel')"
          >
            <X :size="17" aria-hidden="true" />
          </button>
        </header>
        <p id="confirmDialogMessage">{{ message }}</p>
        <footer class="confirm-dialog-actions">
          <button ref="cancelButton" type="button" class="confirm-dialog-cancel" @click="emit('cancel')">
            {{ cancelLabel }}
          </button>
          <button type="button" class="confirm-dialog-submit" @click="emit('confirm')">
            <Trash2 :size="15" aria-hidden="true" />
            <span>{{ confirmLabel }}</span>
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
