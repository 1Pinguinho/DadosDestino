// Roda antes de a página aparecer: aplica o tema e o idioma salvos para a tela
// não piscar com as cores ou o idioma padrão.
(function () {
  var themes = ['purple', 'red', 'green', 'white', 'gray', 'black'];
  var root = document.documentElement;
  try {
    var theme = localStorage.getItem('dados-destino-theme');
    var language = localStorage.getItem('dados-destino-language');
    root.dataset.theme = themes.indexOf(theme) >= 0 ? theme : 'purple';
    if (language === 'pt-BR' || language === 'en') {
      root.lang = language;
    }
    if (localStorage.getItem('dados-destino-animations') === 'off') {
      root.classList.add('reduce-motion');
    }
  } catch (error) {
    root.dataset.theme = 'purple';
  }
})();
