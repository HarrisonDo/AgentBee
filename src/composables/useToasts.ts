import { onBeforeUnmount, ref } from 'vue';

/**
 * 操作结果提示（删除 / 重命名这类一次性动作的「成功 / 失败」反馈）。
 *
 * 刻意**不复用 `ConfirmDialog`**：那是需要用户决策的模态框，
 * 用它来播报结果就得每次多点一下「确定」。这里做成右下角自动消失的轻提示，
 * 成功的看一眼就走，失败的停留久一些并且可以手动关掉。
 */
export type ToastTone = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  message: string;
  tone: ToastTone;
}

/** 各语气的默认停留时长（毫秒）；0 表示不自动关闭。 */
const DURATION_BY_TONE: Record<ToastTone, number> = {
  success: 2600,
  info: 3400,
  error: 6000,
};

/** 同屏最多几条，超了挤掉最旧的。 */
const MAX_TOASTS = 3;

let toastSeq = 0;

export function useToasts() {
  const toasts = ref<ToastItem[]>([]);
  const timers = new Map<string, number>();

  function clearTimer(id: string) {
    const timer = timers.get(id);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    timers.delete(id);
  }

  function dismissToast(id: string) {
    clearTimer(id);
    toasts.value = toasts.value.filter((toast) => toast.id !== id);
  }

  /**
   * 弹一条结果提示，返回它的 id。
   *
   * 空文案直接忽略：调用方经常是把「后端返回的 error」拼进消息里，
   * 失败路径上偶尔取不到文本，这时不该弹一个空壳。
   */
  function pushToast(message: string, tone: ToastTone = 'success'): string | null {
    const text = (message || '').trim();
    if (!text) return null;

    toastSeq += 1;
    const id = `toast-${toastSeq}`;
    toasts.value = [...toasts.value, { id, message: text, tone }];

    // 挤掉最旧的：定时器一并清掉，否则它到点还会去 dismiss 一个已经不存在的 id。
    while (toasts.value.length > MAX_TOASTS) {
      const dropped = toasts.value.shift();
      if (dropped) clearTimer(dropped.id);
    }

    const duration = DURATION_BY_TONE[tone];
    if (duration > 0) {
      timers.set(id, window.setTimeout(() => dismissToast(id), duration));
    }

    return id;
  }

  function clearToasts() {
    timers.forEach((timer) => window.clearTimeout(timer));
    timers.clear();
    toasts.value = [];
  }

  onBeforeUnmount(clearToasts);

  return { clearToasts, dismissToast, pushToast, toasts };
}
