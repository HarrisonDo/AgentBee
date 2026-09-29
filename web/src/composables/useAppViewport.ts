import { onBeforeUnmount, onMounted } from 'vue';

/**
 * 移动端软键盘会改变**可视视口**（visual viewport），却不一定改 CSS 视口单位；
 * iOS 还会顺手把**布局视口**滚一段，好让聚焦的输入框浮在键盘上方——那段滚动
 * 就体现为 `visualViewport.offsetTop`。
 *
 * 补偿这段偏移是必须的（否则固定定位的 .app 会被顶出可视区），但补偿有个硬前提：
 * **`top + height` 不能超出布局视口**。一旦超出去，输入框就掉到可视区外面，
 * 浏览器开始滚动页面去把它拉回来；而 `position: fixed` 的容器根本不跟着页面滚，
 * 于是这个滚动永远收敛不了——页面就一直往上跑，输入框却始终够不着。
 * 所以这里把两个值都夹在布局视口内，让那个状态不可达。
 */
export function useAppViewport() {
  let frame: number | null = null;

  function updateViewport() {
    frame = null;
    const viewport = window.visualViewport;
    // 页面被缩放时，可视视口给的是缩放后的几何，已经不是布局依赖的那套 CSS 像素，
    // 保持上一次的取值即可（至少它是自洽的，不会把 .app 撑出布局视口）。
    if (viewport && viewport.scale !== 1) return;

    const layoutHeight = window.innerHeight;
    const visibleHeight = viewport?.height ?? layoutHeight;
    // 布局视口里真正可见的那一段：从 offsetTop 开始，最多到布局视口底部。
    const maxOffset = Math.max(0, layoutHeight - visibleHeight);
    const offsetTop = Math.min(Math.max(viewport?.offsetTop ?? 0, 0), maxOffset);
    const height = Math.max(0, Math.min(visibleHeight, layoutHeight - offsetTop));

    const style = document.documentElement.style;
    style.setProperty('--app-height', `${height}px`);
    style.setProperty('--app-offset-top', `${offsetTop}px`);
  }

  function scheduleUpdate() {
    if (frame === null) frame = window.requestAnimationFrame(updateViewport);
  }

  onMounted(() => {
    updateViewport();
    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('pageshow', scheduleUpdate);
    window.visualViewport?.addEventListener('resize', scheduleUpdate);
    window.visualViewport?.addEventListener('scroll', scheduleUpdate);
  });

  onBeforeUnmount(() => {
    if (frame !== null) window.cancelAnimationFrame(frame);
    window.removeEventListener('resize', scheduleUpdate);
    window.removeEventListener('pageshow', scheduleUpdate);
    window.visualViewport?.removeEventListener('resize', scheduleUpdate);
    window.visualViewport?.removeEventListener('scroll', scheduleUpdate);
    document.documentElement.style.removeProperty('--app-height');
    document.documentElement.style.removeProperty('--app-offset-top');
  });
}
