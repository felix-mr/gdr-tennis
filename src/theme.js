const KEY = 'gdr-appearance';
export function setupTheme(button) {
  const media = matchMedia('(prefers-color-scheme: dark)');
  let preference;
  try { const saved = localStorage.getItem(KEY); if (['light', 'dark'].includes(saved)) preference = saved; } catch {}
  const apply = mode => {
    document.documentElement.dataset.theme = mode;
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', mode === 'dark' ? '#19161f' : '#faf8fc');
    button.setAttribute('aria-label', mode === 'dark' ? '라이트 모드로 변경' : '다크 모드로 변경');
    button.title = button.getAttribute('aria-label');
    button.innerHTML = mode === 'dark'
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.7 13.1A8.8 8.8 0 0 1 10.9 3.3 8.8 8.8 0 1 0 20.7 13.1Z"/></svg>';
  };
  apply(preference || (media.matches ? 'dark' : 'light'));
  button.addEventListener('click', () => {
    preference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, preference); } catch {}
    apply(preference);
  });
  media.addEventListener('change', () => { if (!preference) apply(media.matches ? 'dark' : 'light'); });
}
