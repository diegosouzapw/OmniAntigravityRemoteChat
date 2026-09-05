document.documentElement.dataset.theme = localStorage.getItem('omni-theme') || 'dark';
if (localStorage.getItem('omni_compact_mode') === 'true') {
  document.documentElement.classList.add('compact-mode');
}
