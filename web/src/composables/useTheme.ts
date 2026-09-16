import { ref } from 'vue';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'beeweb.theme';

const theme = ref<Theme>(readTheme());

export function useTheme() {
  applyTheme(theme.value);

  function setTheme(nextTheme: Theme) {
    theme.value = nextTheme;
    localStorage.setItem(STORAGE_KEY, nextTheme);
    applyTheme(nextTheme);
  }

  function toggleTheme() {
    setTheme(theme.value === 'dark' ? 'light' : 'dark');
  }

  return {
    setTheme,
    theme,
    toggleTheme,
  };
}

function readTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(nextTheme: Theme) {
  document.documentElement.dataset.theme = nextTheme;
}
