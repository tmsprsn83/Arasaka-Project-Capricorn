// Éclairage qui suit Cyberpunk 2077 : une vignette minuscule de l'écran principal (64 × 36) est analysée ici, sur le
// PC, sans jamais être enregistrée ni envoyée. On en tire la couleur dominante (vive) de l'image, les dégâts (bords
// de l'écran qui virent au rouge, comme quand V se fait toucher) et les coupures brutales (glitch, changement
// d'écran). Les images arrivent en BGRA (NativeImage.toBitmap d'Electron).

// Couleur poussée vers un néon : la composante la plus forte à 255, les autres creusées.
function neon([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max < 1) return [0, 0, 0];
  const k = 255 / Math.max(1, max - min * 0.7);
  return [r, g, b].map((c) => Math.max(0, Math.min(255, Math.round((c - min * 0.7) * k))));
}

// Une image : couleur dominante, part de couleur vive, rouge sur les bords et au centre, et une grille 8 × 4 de
// luminosité pour comparer avec l'image d'avant.
function analyse(bmp, w, h) {
  let sr = 0, sg = 0, sb = 0, sw = 0;
  let edge = 0, edgeRed = 0, center = 0, centerRed = 0;
  const grid = new Array(32).fill(0), cells = new Array(32).fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const b = bmp[i], g = bmp[i + 1], r = bmp[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const s = max ? (max - min) / max : 0;
      const weight = s * s * (max / 255);
      sr += r * weight; sg += g * weight; sb += b * weight; sw += weight;
      const red = r > 110 && r > g * 1.8 && r > b * 1.4;
      if (x < w * 0.12 || x >= w * 0.88 || y < h * 0.15 || y >= h * 0.85) { edge++; if (red) edgeRed++; }
      else { center++; if (red) centerRed++; }
      const cell = Math.min(3, Math.floor((y / h) * 4)) * 8 + Math.min(7, Math.floor((x / w) * 8));
      grid[cell] += (r + g + b) / 3; cells[cell]++;
    }
  }
  return {
    color: sw > 0 ? neon([sr / sw, sg / sw, sb / sw]) : [0, 0, 0],
    vivid: sw / (w * h),
    red: edge ? edgeRed / edge : 0,
    redCenter: center ? centerRed / center : 0,
    grid: grid.map((v, k) => (cells[k] ? v / cells[k] : 0)),
  };
}

// Écart moyen de luminosité entre deux images (0 à 1).
function cut(a, b) {
  if (!a || !b) return 0;
  let d = 0;
  for (let k = 0; k < a.length; k++) d += Math.abs(a[k] - b[k]);
  return d / a.length / 255;
}

// Néons de la palette du jeu : la couleur de l'écran est ramenée à l'un d'eux d'après sa teinte. Chaque changement de
// couleur relance l'effet de la carte mère depuis le début : moins de couleurs, moins de saccades.
const NEONS = [
  [10, 'rouge', [255, 0, 60]], [40, 'orange', [255, 90, 0]], [70, 'jaune', [252, 238, 10]], [160, 'vert', [0, 255, 102]],
  [200, 'cyan', [0, 240, 255]], [250, 'bleu', [0, 80, 255]], [300, 'violet', [160, 0, 255]], [345, 'magenta', [255, 0, 170]],
  [360, 'rouge', [255, 0, 60]],
];
function neonOf([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min || 1;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  const [, name, color] = NEONS.find(([upTo]) => h < upTo) || NEONS[NEONS.length - 1];
  return { name, color };
}

const HOLD = 10; // images (2 s à 5 par seconde) avant de passer à une autre couleur

// Suit les images successives et dit quoi faire : { color } (assez de couleur vive à l'écran), { degats }, { glitch }.
function createSuivi({ now = () => Date.now() } = {}) {
  let prev = null, smooth = null, hitAt = -Infinity, glitchAt = -Infinity, wasRed = false;
  let stable = null, candidate = null, seen = 0;
  return (bmp, w, h) => {
    const a = analyse(bmp, w, h);
    const t = now();
    const out = {};
    const red = a.red >= 0.3 && a.red - a.redCenter > 0.15;
    if (red && !wasRed && t - hitAt > 1500) { out.degats = true; hitAt = t; }
    wasRed = red;
    if (cut(prev?.grid, a.grid) > 0.3 && t - glitchAt > 4000) { out.glitch = true; glitchAt = t; }
    if (a.vivid > 0.02) {
      smooth = smooth ? smooth.map((c, k) => Math.round(c * 0.7 + a.color[k] * 0.3)) : a.color;
      const n = neonOf(smooth);
      if (!stable) stable = n;
      else if (n.name !== stable.name) {
        if (candidate?.name === n.name) seen++; else { candidate = n; seen = 1; }
        if (seen >= HOLD) { stable = n; candidate = null; }
      } else candidate = null;
    }
    if (stable) out.color = stable.color; // image sombre : on garde la dernière couleur plutôt que de changer d'effet
    prev = a;
    return out;
  };
}

module.exports = { analyse, cut, neon, neonOf, createSuivi };
