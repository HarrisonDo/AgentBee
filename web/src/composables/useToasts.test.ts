import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToasts } from './useToasts';

/** 可控的定时器：把回调攒起来，测试里手动触发，避免依赖真实时间。 */
const timers = new Map<number, () => void>();
const delays: number[] = [];
let timerSeq = 0;

function runTimers() {
  Array.from(timers.values()).forEach((callback) => callback());
}

beforeEach(() => {
  timers.clear();
  delays.length = 0;
  timerSeq = 0;
  vi.stubGlobal('window', {
    clearTimeout: (id: number) => {
      timers.delete(id);
    },
    setTimeout: (callback: () => void, delay: number) => {
      timerSeq += 1;
      timers.set(timerSeq, callback);
      delays.push(delay);
      return timerSeq;
    },
  });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useToasts', () => {
  it('keeps the message and the tone of each toast', () => {
    const toasts = useToasts();
    toasts.pushToast('会话已删除：测试', 'success');
    toasts.pushToast('重命名失败：缺少会话ID', 'error');

    expect(toasts.toasts.value.map((toast) => toast.tone)).toEqual(['success', 'error']);
    expect(toasts.toasts.value[1].message).toBe('重命名失败：缺少会话ID');
  });

  it('ignores an empty message instead of pushing a blank toast', () => {
    const toasts = useToasts();
    // 失败提示常把「后端返回的 error」拼进来，取不到文本时不该弹一个空壳。
    expect(toasts.pushToast('', 'error')).toBeNull();
    expect(toasts.pushToast('   ', 'error')).toBeNull();
    expect(toasts.toasts.value).toHaveLength(0);
  });

  it('keeps at most three toasts and drops the oldest', () => {
    const toasts = useToasts();
    ['一', '二', '三', '四'].forEach((text) => toasts.pushToast(text, 'info'));

    expect(toasts.toasts.value.map((toast) => toast.message)).toEqual(['二', '三', '四']);
    // 被挤掉的那条定时器要一起清掉，否则到点还会去 dismiss 一个不存在的 id。
    expect(timers.size).toBe(3);
  });

  it('auto-dismisses a success toast and lets errors stay longer', () => {
    const toasts = useToasts();
    toasts.pushToast('会话已重命名：新的标题', 'success');
    toasts.pushToast('删除会话失败：xxx', 'error');

    // 第二个参数是停留时长：错误提示要留得久一些，用户才来得及看清。
    expect(delays[0]).toBeLessThan(delays[1]);

    runTimers();
    expect(toasts.toasts.value).toHaveLength(0);
  });

  it('dismisses a single toast by id', () => {
    const toasts = useToasts();
    const first = toasts.pushToast('第一条', 'success');
    toasts.pushToast('第二条', 'success');

    toasts.dismissToast(first as string);

    expect(toasts.toasts.value.map((toast) => toast.message)).toEqual(['第二条']);
  });

  it('clears everything at once', () => {
    const toasts = useToasts();
    toasts.pushToast('一', 'success');
    toasts.pushToast('二', 'error');

    toasts.clearToasts();

    expect(toasts.toasts.value).toHaveLength(0);
    expect(timers.size).toBe(0);
  });
});
