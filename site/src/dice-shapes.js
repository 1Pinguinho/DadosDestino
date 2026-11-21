// Desenho dos dados: cada tipo (d4, d6, d8, d10, d12, d20) é um SVG com as faces
// lapidadas e sombreadas, e cada modelo é um "material" (cristal, metal, neon...)
// aplicado por cima, com textura própria. As cores vêm de CSS (--die-base), então
// qualquer modelo aceita qualquer cor, inclusive a personalizada.
const SVG = 'http://www.w3.org/2000/svg';
const FATE = -1;
let serial = 0;

export const DICE_STYLES = ['classic', 'crystal', 'metal', 'neon', 'rune', 'galaxy', 'lava', 'ice', 'wood', 'pixel', 'dragon', 'bone'];

// Faces de cada tipo: o contorno e as facetas (com o tom de cada uma).
// "front" é a face onde o número aparece.
const HEX = ['50,3', '92,27', '92,73', '50,97', '8,73', '8,27'];
const SHAPES = {
  4: {
    outline: '50,5 96,89 4,89',
    facets: [['50,5 4,89 50,63', 'light'], ['50,5 96,89 50,63', 'mid'], ['4,89 96,89 50,63', 'front']],
  },
  6: {
    outline: 'M22 6H78Q94 6 94 22V78Q94 94 78 94H22Q6 94 6 78V22Q6 6 22 6Z',
    facets: [
      ['0,0 100,0 80,20 20,20', 'light'], ['0,0 20,20 20,80 0,100', 'mid'],
      ['100,0 100,100 80,80 80,20', 'dark'], ['0,100 20,80 80,80 100,100', 'darker'],
      ['20,20 80,20 80,80 20,80', 'front'],
    ],
  },
  8: {
    outline: '50,3 96,50 50,97 4,50',
    facets: [['50,3 4,50 50,60', 'light'], ['50,3 96,50 50,60', 'front'], ['4,50 50,97 50,60', 'dark'], ['96,50 50,97 50,60', 'darker']],
  },
  10: {
    outline: '50,3 96,40 50,97 4,40',
    facets: [
      ['50,3 26,44 4,40', 'light'], ['50,3 96,40 74,44', 'mid'],
      ['4,40 26,44 50,72 50,97', 'dark'], ['96,40 74,44 50,72 50,97', 'darker'],
      ['50,3 74,44 50,72 26,44', 'front'],
    ],
  },
  12: {
    outline: '50,3 96,36 78,95 22,95 4,36',
    facets: [
      ['50,3 96,36 76,41 50,22', 'light'], ['96,36 78,95 66,72 76,41', 'mid'],
      ['78,95 22,95 34,72 66,72', 'dark'], ['22,95 4,36 24,41 34,72', 'darker'],
      ['4,36 50,3 50,22 24,41', 'light'], ['50,22 76,41 66,72 34,72 24,41', 'front'],
    ],
  },
  20: {
    outline: HEX.join(' '),
    facets: [
      [`${HEX[0]} ${HEX[1]} 50,25`, 'light'], [`${HEX[1]} 74,65 50,25`, 'mid'],
      [`${HEX[1]} ${HEX[2]} 74,65`, 'dark'], [`${HEX[2]} ${HEX[3]} 74,65`, 'darker'],
      [`${HEX[3]} 26,65 74,65`, 'dark'], [`${HEX[3]} ${HEX[4]} 26,65`, 'darker'],
      [`${HEX[4]} ${HEX[5]} 26,65`, 'mid'], [`${HEX[5]} 50,25 26,65`, 'light'],
      [`${HEX[5]} ${HEX[0]} 50,25`, 'light'], ['50,25 74,65 26,65', 'front'],
    ],
  },
};
SHAPES[100] = SHAPES[10];
SHAPES.fate = SHAPES[6];
SHAPES.other = SHAPES[20];

export function shapeOf(sides) {
  if (sides === FATE) {
    return 'fate';
  }
  return [4, 6, 8, 10, 12, 20, 100].includes(sides) ? String(sides) : 'other';
}

export function labelOf(sides) {
  if (sides === FATE) {
    return 'DF';
  }
  return sides ? `D${sides}` : 'D?';
}

function node(name, attributes = {}, parent = null) {
  const element = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }
  parent?.append(element);
  return element;
}

function shapeNode(points, attributes, parent) {
  return points.startsWith('M')
    ? node('path', { d: points, ...attributes }, parent)
    : node('polygon', { points, ...attributes }, parent);
}

// Rachaduras aleatórias (lava e osso): linhas quebradas que atravessam o dado.
function cracks(count) {
  const paths = [];
  for (let index = 0; index < count; index += 1) {
    let x = 15 + Math.random() * 70;
    let y = 10 + Math.random() * 20;
    let d = `M${x.toFixed(1)} ${y.toFixed(1)}`;
    for (let step = 0; step < 5; step += 1) {
      x += (Math.random() - 0.5) * 22;
      y += 10 + Math.random() * 10;
      d += `L${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    paths.push(d);
  }
  return paths;
}

// Texturas de cada material, desenhadas por cima das faces e recortadas no formato.
function addTexture(style, defs, layer, id) {
  const pattern = (width, height, build) => {
    const element = node('pattern', { id: `${id}-tex`, width, height, patternUnits: 'userSpaceOnUse' }, defs);
    build(element);
    node('rect', { x: 0, y: 0, width: 100, height: 100, fill: `url(#${id}-tex)`, class: 'die-texture' }, layer);
  };
  switch (style) {
    case 'crystal':
      node('path', { d: 'M18 30 L40 12 L46 16 L24 36 Z', class: 'die-gleam' }, layer);
      node('circle', { cx: 70, cy: 30, r: 2.2, class: 'die-sparkle' }, layer);
      break;
    case 'metal':
      pattern(100, 3, (element) => node('rect', { x: 0, y: 0, width: 100, height: 1, class: 'tex-brush' }, element));
      break;
    case 'rune':
      pattern(9, 9, (element) => {
        node('circle', { cx: 2, cy: 3, r: 0.9, class: 'tex-dark' }, element);
        node('circle', { cx: 6.5, cy: 7, r: 0.6, class: 'tex-light' }, element);
        node('circle', { cx: 7, cy: 1.5, r: 0.5, class: 'tex-dark' }, element);
      });
      break;
    case 'galaxy': {
      const gradient = node('radialGradient', { id: `${id}-neb`, cx: '35%', cy: '35%', r: '70%' }, defs);
      node('stop', { offset: '0%', class: 'neb-a' }, gradient);
      node('stop', { offset: '60%', class: 'neb-b' }, gradient);
      node('stop', { offset: '100%', class: 'neb-c' }, gradient);
      node('rect', { x: 0, y: 0, width: 100, height: 100, fill: `url(#${id}-neb)`, class: 'die-nebula' }, layer);
      for (let index = 0; index < 18; index += 1) {
        node('circle', { cx: (Math.random() * 100).toFixed(1), cy: (Math.random() * 100).toFixed(1), r: (0.4 + Math.random() * 0.9).toFixed(2), class: 'die-star' }, layer);
      }
      break;
    }
    case 'lava':
      for (const d of cracks(3)) node('path', { d, class: 'die-crack-glow' }, layer);
      break;
    case 'ice':
      pattern(22, 22, (element) => {
        node('path', { d: 'M2 20 L11 9 M11 9 L20 14 M11 9 L13 1', class: 'tex-frost' }, element);
      });
      break;
    case 'wood':
      pattern(100, 9, (element) => {
        node('path', { d: 'M0 4 Q25 1 50 4 T100 4', class: 'tex-grain' }, element);
        node('path', { d: 'M0 7.5 Q30 9 60 7 T100 7.5', class: 'tex-grain thin' }, element);
      });
      break;
    case 'pixel':
      pattern(4, 4, (element) => node('rect', { x: 0, y: 3, width: 4, height: 1, class: 'tex-scan' }, element));
      break;
    case 'dragon':
      pattern(12, 9, (element) => {
        node('path', { d: 'M0 9 A6 6 0 0 1 12 9', class: 'tex-scale' }, element);
        node('path', { d: 'M-6 4.5 A6 6 0 0 1 6 4.5 M6 4.5 A6 6 0 0 1 18 4.5', class: 'tex-scale' }, element);
      });
      break;
    case 'bone':
      for (const d of cracks(2)) node('path', { d, class: 'die-crack' }, layer);
      break;
    default:
      break;
  }
}

// Monta um dado: o desenho (SVG), o número e a legenda (D6, D20...).
export function createDieElement(sides, style = 'classic') {
  const shapeKey = shapeOf(sides);
  const shape = SHAPES[shapeKey] || SHAPES.other;
  const id = `die${serial += 1}`;
  const material = DICE_STYLES.includes(style) ? style : 'classic';

  const element = document.createElement('span');
  element.className = 'roll-die';
  element.dataset.shape = shapeKey;

  const svg = node('svg', { class: 'die-svg', viewBox: '0 0 100 100', 'aria-hidden': 'true' });
  const defs = node('defs', {}, svg);
  const clip = node('clipPath', { id: `${id}-clip` }, defs);
  shapeNode(shape.outline, {}, clip);
  const body = node('g', { 'clip-path': `url(#${id}-clip)` }, svg);
  for (const [points, tone] of shape.facets) {
    shapeNode(points, { class: `die-facet f-${tone}` }, body);
  }
  addTexture(material, defs, body, id);
  shapeNode(shape.outline, { class: 'die-outline' }, svg);

  const face = document.createElement('span');
  const label = document.createElement('small');
  face.className = 'roll-die-face';
  label.className = 'roll-die-label';
  label.textContent = labelOf(sides);
  element.append(svg, face, label);
  return { element, face };
}
