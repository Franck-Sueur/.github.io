(() => {
  'use strict';
  const key = 'franck-sueur-theme';
  const root = document.documentElement;
  const system = window.matchMedia('(prefers-color-scheme: dark)');

  function savedTheme() {
    try {
      const saved = window.localStorage.getItem(key);
      return saved === 'dark' || saved === 'light' ? saved : null;
    } catch (_) {
      return null;
    }
  }
  let preference = savedTheme();

  function updateButtons() {
    const dark = root.dataset.theme === 'dark';
    for (const button of document.querySelectorAll('[data-theme-toggle]')) {
      const label = dark ? 'Light mode' : 'Dark mode';
      button.querySelector('[data-theme-label]').textContent = label;
      button.querySelector('[data-theme-icon]').textContent = dark ? '☀' : '☾';
      button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      button.title = label;
      button.hidden = false;
      if (!button.dataset.themeBound) {
        button.addEventListener('click', () => {
          preference = root.dataset.theme === 'dark' ? 'light' : 'dark';
          try { window.localStorage.setItem(key, preference); } catch (_) {}
          applyTheme();
        });
        button.dataset.themeBound = 'true';
      }
    }
  }
  function applyTheme() {
    const theme = preference || (system.matches ? 'dark' : 'light');
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    updateButtons();
  }

  // Run in the head so the saved theme is selected before the first paint.
  applyTheme();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateButtons, { once: true });
  } else {
    updateButtons();
  }
  function systemChanged() { if (!preference) applyTheme(); }
  if (system.addEventListener) system.addEventListener('change', systemChanged);
  else system.addListener(systemChanged);
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) {
      preference = savedTheme();
      applyTheme();
    }
  });
})();
