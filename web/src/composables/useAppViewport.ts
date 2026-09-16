import { onBeforeUnmount, onMounted } from 'vue';

// Mobile keyboards resize the visual viewport without always resizing CSS viewport units.
export function useAppViewport() {
  let frame: number | null = null;

  function updateViewport() {
    frame = null;
    const viewport = window.visualViewport;
    if (viewport && viewport.scale !== 1) return;

    const style = document.documentElement.style;
    style.setProperty('--app-height', `${viewport?.height ?? window.innerHeight}px`);
    style.setProperty('--app-offset-top', `${viewport?.offsetTop ?? 0}px`);
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
