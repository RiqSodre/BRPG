// Alterna entre tema claro e escuro. A leitura inicial já roda inline no <head>
// de cada página (evita flash do tema errado); aqui só cuida do botão, quando existe.
(function () {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;

  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    btn.innerHTML = theme === 'light'
      ? '<svg class="icon"><use href="#i-moon"/></svg>Tema escuro'
      : '<svg class="icon"><use href="#i-sun"/></svg>Tema claro';
  }

  apply(document.documentElement.getAttribute('data-theme') || 'dark');

  btn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    localStorage.setItem('brpg-theme', next);
    apply(next);
  });
})();
