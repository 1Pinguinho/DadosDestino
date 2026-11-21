// Roda antes de a página aparecer: aplica tema, cores personalizadas, zoom,
// animações e idioma salvos, para a tela não piscar com o padrão.
// Precisa de palette.js carregado antes.
(function () {
  var themes = ['purple', 'red', 'green', 'blue', 'teal', 'gold', 'pink', 'white', 'gray', 'black', 'custom'];
  var root = document.documentElement;
  try {
    var settings = JSON.parse(localStorage.getItem('dados-destino-settings') || '{}') || {};
    var language = localStorage.getItem('dados-destino-language');
    var zoom = Number(settings.zoom);
    root.dataset.theme = themes.indexOf(settings.theme) >= 0 ? settings.theme : 'purple';
    if (root.dataset.theme === 'custom' && window.DadosPalette) {
      window.DadosPalette.apply(root, 'custom', settings.custom);
    }
    if (zoom >= 0.7 && zoom <= 1.5 && zoom !== 1) {
      root.style.zoom = String(zoom);
    }
    if (settings.animations === false) {
      root.classList.add('reduce-motion');
    }
    if (language === 'pt-BR' || language === 'en') {
      root.lang = language;
    }
  } catch (error) {
    root.dataset.theme = 'purple';
  }
})();
