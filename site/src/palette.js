// Tema personalizado: a partir de 3 cores (fundo, destaque e degradê) monta a
// paleta inteira do app, conferindo o contraste para o texto nunca ficar ilegível.
// Script simples (sem módulo) para rodar antes da página aparecer; a tela inicial
// do app recebe uma cópia dele.
(function () {
  var VARS = ['--bg', '--bg-mid', '--bg-glow', '--surface', '--surface-2', '--field', '--ink', '--muted', '--faint',
    '--line', '--accent', '--accent-strong', '--action', '--action-hover', '--on-action', '--warm', '--table-border',
    '--table-a', '--table-b', '--table-glow', '--seat-a', '--seat-b', '--shadow'];
  var DEFAULTS = { bg: '#101820', accent: '#6fc3df', glow: '#c86fdf' };
  var HEX = /^#[0-9a-f]{6}$/i;

  function parse(hex) {
    return [1, 3, 5].map(function (index) { return parseInt(hex.slice(index, index + 2), 16); });
  }
  function toHex(rgb) {
    return '#' + rgb.map(function (value) {
      return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
    }).join('');
  }
  // Mistura: amount = quanto de "other" entra (0 a 1).
  function mix(color, other, amount) {
    var a = parse(color);
    var b = parse(other);
    return toHex(a.map(function (value, index) { return value + (b[index] - value) * amount; }));
  }
  function luminance(hex) {
    var channels = parse(hex).map(function (value) {
      var c = value / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }
  function contrast(a, b) {
    var la = luminance(a);
    var lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  // Aproxima a cor do texto até atingir o contraste mínimo com o fundo.
  function readable(color, background, ink, minimum) {
    var result = color;
    for (var step = 1; step <= 10 && contrast(result, background) < minimum; step += 1) {
      result = mix(color, ink, step / 10);
    }
    return result;
  }

  function clean(colors) {
    colors = colors || {};
    return {
      bg: HEX.test(colors.bg || '') ? colors.bg.toLowerCase() : DEFAULTS.bg,
      accent: HEX.test(colors.accent || '') ? colors.accent.toLowerCase() : DEFAULTS.accent,
      glow: HEX.test(colors.glow || '') ? colors.glow.toLowerCase() : DEFAULTS.glow,
    };
  }

  function build(colors) {
    var c = clean(colors);
    var light = luminance(c.bg) > 0.4;
    var ink = mix(light ? '#1d1922' : '#f3eff6', c.accent, 0.06);
    var accent = readable(c.accent, c.bg, ink, 3.2);
    var action = light ? mix(c.accent, '#000000', 0.25) : mix(c.accent, c.bg, 0.35);
    var onAction = contrast(action, '#ffffff') >= contrast(action, '#111111') ? '#ffffff' : '#111111';
    for (var step = 1; step <= 6 && contrast(action, onAction) < 4.5; step += 1) {
      action = mix(action, onAction === '#ffffff' ? '#000000' : '#ffffff', 0.12);
    }
    return {
      scheme: light ? 'light' : 'dark',
      values: {
        '--bg': c.bg,
        '--bg-mid': mix(c.bg, c.glow, light ? 0.06 : 0.12),
        '--bg-glow': mix(c.bg, c.glow, light ? 0.28 : 0.45),
        '--surface': light ? mix(c.bg, '#ffffff', 0.75) : mix(c.bg, ink, 0.05),
        '--surface-2': light ? mix(c.bg, c.accent, 0.06) : mix(c.bg, ink, 0.09),
        '--field': light ? mix(c.bg, '#ffffff', 0.45) : c.bg,
        '--ink': ink,
        '--muted': mix(ink, c.bg, 0.34),
        '--faint': mix(ink, c.bg, 0.52),
        '--line': mix(ink, c.bg, 0.8),
        '--accent': accent,
        '--accent-strong': readable(mix(accent, ink, 0.45), c.bg, ink, 4.5),
        '--action': action,
        '--action-hover': mix(action, onAction, 0.14),
        '--on-action': onAction,
        '--warm': readable(c.glow, c.bg, ink, 3),
        '--table-border': mix(c.accent, c.bg, 0.5),
        '--table-a': light ? mix(c.bg, '#ffffff', 0.8) : mix(c.bg, c.glow, 0.14),
        '--table-b': light ? mix(c.bg, c.accent, 0.05) : mix(c.bg, '#000000', 0.2),
        '--table-glow': mix(c.glow, c.bg, 0.4),
        '--seat-a': light ? '#ffffff' : mix(c.bg, c.accent, 0.1),
        '--seat-b': light ? mix(c.bg, c.accent, 0.04) : mix(c.bg, '#000000', 0.15),
        '--shadow': light ? mix(c.accent, '#000000', 0.6) : '#000000',
      },
    };
  }

  // Aplica (theme = 'custom') ou limpa (outros temas) as cores no elemento.
  function apply(root, theme, colors) {
    var style = root.style;
    if (theme !== 'custom') {
      VARS.forEach(function (name) { style.removeProperty(name); });
      style.removeProperty('color-scheme');
      return;
    }
    var palette = build(colors);
    Object.keys(palette.values).forEach(function (name) { style.setProperty(name, palette.values[name]); });
    style.setProperty('color-scheme', palette.scheme);
  }

  window.DadosPalette = { apply: apply, clean: clean, defaults: DEFAULTS };
})();
