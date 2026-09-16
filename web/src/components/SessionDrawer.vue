<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';

/**
 * 移动端的会话抽屉：从左侧滑出，里面装的就是 `SessionPanel`（同一条列表、同一套操作），
 * 这样桌面端和移动端只有一份列表实现，不会出现「手机上少做了某个操作」。
 *
 * 只在移动端布局下渲染（由 `App.vue` 的 `isMobileLayout` 控制），
 * 所以这里不需要再判断视口宽度。
 */
const props = defineProps<{
  /** 抽屉标题，用于 `aria-label`（面板自己的头里已经显示了「会话」）。 */
  label: string;
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const drawer = ref<HTMLElement | null>(null);
let previouslyFocused: HTMLElement | null = null;

/** Esc 关闭；Tab 在抽屉内部循环（和 ConfirmDialog 同一套做法）。 */
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('close');
    return;
  }

  if (event.key !== 'Tab' || !drawer.value) return;
  const focusable = Array.from(
    drawer.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'),
  );
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

watch(() => props.open, (open) => {
  if (open) {
    previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    // 焦点收进抽屉，键盘 / 读屏用户不会跑到被遮住的界面上。
    nextTick(() => drawer.value?.focus());
    return;
  }
  // 关闭后把焦点还给触发按钮。
  if (previouslyFocused?.isConnected && !previouslyFocused.hasAttribute('disabled')) {
    previouslyFocused.focus();
  }
  previouslyFocused = null;
});

onBeforeUnmount(() => {
  previouslyFocused = null;
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="session-drawer-layer" @keydown="onKeydown">
      <div class="session-drawer-backdrop" @click="emit('close')" />
      <aside
        ref="drawer"
        class="session-drawer"
        role="dialog"
        aria-modal="true"
        :aria-label="label"
        tabindex="-1"
      >
        <slot />
      </aside>
    </div>
  </Teleport>
</template>
