// Découpe le rig de CAPRI dans les planches de pièces de Tommy (IMAGE_DE_REFERENCE) :
// chaque pièce est détourée, placée sur le personnage complet de la planche (recherche d'échelle et de
// position), puis exportée dans src/renderer/rig/ avec rig.js (calques, positions, pivots).
// Lancer : node tools/build-rig.cjs
const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'src', 'renderer', 'rig');
const read = (name) => PNG.sync.read(fs.readFileSync(path.join(ROOT, 'IMAGE_DE_REFERENCE', name)));
const SHEET = read('planche-pieces-damier.png');
const SHEET_DARK = read('planche-pieces-noir.png');

// Zones des pièces sur la planche damier.
const ZONES = {
  compo: [10, 6, 587, 463],
  visor: [18, 513, 395, 671],
  torso: [11, 738, 415, 963],
  shards: [1140, 10, 1520, 432],
  deco: [1235, 785, 1515, 935],
};
// Bouches de la planche « expressions faciales » (fond noir).
const EXPRESSIONS = { zigzag: [515, 560, 700, 670], ouverte: [712, 560, 900, 670], cri: [910, 560, 1097, 670], pixel: [1105, 560, 1292, 670] };

const px = (img, x, y) => { const i = (y * img.width + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
// Pixel de pièce : saturé ou sombre (le damier est clair et gris).
const isPart = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b) > 60 || Math.max(r, g, b) < 90;
const isCheckerGray = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b) < 25 && r > 165 && r < 228;
// Classe de couleur : 0 clair, 1 sombre, 2 rouge, 3 vert, 4 bleu.
function cls([r, g, b]) {
  const mx = Math.max(r, g, b);
  if (mx - Math.min(r, g, b) <= 60) return mx < 90 ? 1 : 0;
  if (r === mx) return 2;
  if (g === mx) return 3;
  return 4;
}

// Composantes connexes d'un masque (4-voisinage).
function components(mask, w, h) {
  const lab = new Int32Array(w * h).fill(-1);
  const out = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || lab[s] >= 0) continue;
    const pixels = [];
    const stack = [s];
    lab[s] = out.length;
    while (stack.length) {
      const q = stack.pop();
      pixels.push(q);
      const x = q % w;
      for (const o of [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, q - w, q + w]) {
        if (o >= 0 && o < w * h && mask[o] && lab[o] < 0) { lab[o] = out.length; stack.push(o); }
      }
    }
    out.push(pixels);
  }
  return out;
}

// Détoure les pièces d'une zone : composantes assez grandes, trous bouchés sauf ceux qui montrent le damier.
function cut(img, [x0, y0, x1, y1], minArea = 300) {
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = isPart(px(img, x0 + x, y0 + y)) ? 1 : 0;
  const kept = new Uint8Array(w * h);
  for (const c of components(mask, w, h)) if (c.length >= minArea) for (const q of c) kept[q] = 1;
  const holes = components(kept.map((v) => 1 - v), w, h);
  for (const hole of holes) {
    const touches = hole.some((q) => q % w === 0 || q % w === w - 1 || q < w || q >= w * (h - 1));
    if (touches) continue;
    const gray = hole.filter((q) => isCheckerGray(px(img, x0 + (q % w), y0 + ((q / w) | 0)))).length;
    if (gray < hole.length * 0.15) for (const q of hole) kept[q] = 1;
  }
  return { x0, y0, w, h, mask: kept, img };
}

// Pièces séparées d'une zone (une par composante), chacune recadrée.
function cutEach(img, zone, minArea) {
  const all = cut(img, zone, minArea);
  return components(all.mask, all.w, all.h).filter((c) => c.length >= minArea).map((c) => {
    let x0 = all.w, y0 = all.h, x1 = 0, y1 = 0;
    for (const q of c) { const x = q % all.w, y = (q / all.w) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const mask = new Uint8Array(w * h);
    for (const q of c) mask[((q / all.w | 0) - y0) * w + (q % all.w) - x0] = 1;
    return { x0: all.x0 + x0, y0: all.y0 + y0, w, h, mask, img };
  });
}

// Recherche de l'échelle et de la position qui font coïncider une pièce avec le personnage complet.
function locate(piece, compo, { s, x, y }, stride = 3) {
  const cmap = new Uint8Array(compo.w * compo.h);
  for (let j = 0; j < compo.h; j++) for (let i = 0; i < compo.w; i++) cmap[j * compo.w + i] = compo.mask[j * compo.w + i] ? cls(px(compo.img, compo.x0 + i, compo.y0 + j)) : 9;
  const samples = [];
  for (let j = 0; j < piece.h; j += stride) for (let i = 0; i < piece.w; i += stride) {
    if (piece.mask[j * piece.w + i]) samples.push([i, j, cls(px(piece.img, piece.x0 + i, piece.y0 + j))]);
  }
  const score = (ss, dx, dy) => {
    // Le personnage complet est coupé en bas : ce qui dépasse dessous ne compte pas.
    let ok = 0, n = 0;
    for (const [i, j, c] of samples) {
      const u = Math.round(dx + i * ss), v = Math.round(dy + j * ss);
      if (v >= compo.h) continue;
      n++;
      if (u >= 0 && v >= 0 && u < compo.w && cmap[v * compo.w + u] === c) ok++;
    }
    return n > samples.length * 0.4 ? ok / n : 0;
  };
  let best = { score: -1 };
  const scan = (sr, xr, yr, ss, sx) => {
    for (let a = sr[0]; a <= sr[1] + 1e-9; a += ss) for (let dx = xr[0]; dx <= xr[1]; dx += sx) for (let dy = yr[0]; dy <= yr[1]; dy += sx) {
      const v = score(a, dx, dy);
      if (v > best.score) best = { score: v, s: a, x: dx, y: dy };
    }
  };
  scan(s, x, y, 0.02, 3);
  const b = { ...best };
  scan([b.s - 0.02, b.s + 0.02], [b.x - 3, b.x + 3], [b.y - 3, b.y + 3], 0.004, 1);
  return best;
}

// --- Export des sprites ---

// Image RGBA d'une pièce : bord rogné d'un pixel (pour perdre le liseré du damier) puis adouci. Seul le
// contour contre le damier est rogné : entre deux calques découpés dans la même image, pas de fente.
function sprite(piece, keep = (i) => piece.mask[i], color = null) {
  const { w, h } = piece;
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && piece.mask[y * w + x];
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!keep(y * w + x)) continue;
    let edge = 0;
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!inside(x + a, y + b)) edge++;
    let far = 0;
    for (const [a, b] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) if (!inside(x + a, y + b)) far++;
    const t = (y * w + x) * 4;
    const c = color ? color(x, y) : px(piece.img, piece.x0 + x, piece.y0 + y);
    out.data[t] = c[0]; out.data[t + 1] = c[1]; out.data[t + 2] = c[2];
    out.data[t + 3] = edge ? 0 : far ? 150 : 255;
  }
  return out;
}

// Bouche dessinée en blanc (ou vert) sur la planche noire : alpha tiré de la luminosité, couleur normalisée.
function glyph(img, [x0, y0, x1, y1]) {
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const bright = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) bright[y * w + x] = Math.max(...px(img, x0 + x, y0 + y)) > 120 ? 1 : 0;
  const zone = new Uint8Array(w * h);
  for (const c of components(bright, w, h)) if (c.length >= 40) for (const q of c) zone[q] = 1;
  let bx0 = w, by0 = h, bx1 = 0, by1 = 0;
  for (let q = 0; q < w * h; q++) if (zone[q]) { const x = q % w, y = (q / w) | 0; bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
  bx0 -= 2; by0 -= 2; bx1 += 2; by1 += 2;
  const near = (x, y) => { for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) if (zone[(y + b) * w + x + a]) return true; return false; };
  const gw = bx1 - bx0 + 1, gh = by1 - by0 + 1;
  const out = new PNG({ width: gw, height: gh });
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    if (!near(bx0 + x, by0 + y)) continue;
    const c = px(img, x0 + bx0 + x, y0 + by0 + y);
    const m = Math.max(...c);
    const a = Math.min(1, Math.max(0, (m - 30) / 190));
    if (!a) continue;
    const t = (y * gw + x) * 4;
    for (let k = 0; k < 3; k++) out.data[t + k] = Math.round((c[k] * 255) / m);
    out.data[t + 3] = Math.round(a * 255);
  }
  return { png: out, cx: x0 + bx0 + gw / 2, cy: y0 + by0 + gh / 2, w: gw, h: gh };
}

// Bouche chaque trou en lui donnant la moyenne de ses voisins déjà remplis.
function inpaint(png, holes) {
  const { width: w, height: h, data } = png;
  let todo = [...holes];
  const filled = new Uint8Array(w * h).fill(1);
  for (const q of todo) filled[q] = 0;
  while (todo.length) {
    const next = [];
    const done = [];
    for (const q of todo) {
      const x = q % w, y = (q / w) | 0;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const o = (y + dy) * w + x + dx;
        if (x + dx < 0 || x + dx >= w || y + dy < 0 || y + dy >= h || !filled[o] || !data[o * 4 + 3]) continue;
        r += data[o * 4]; g += data[o * 4 + 1]; b += data[o * 4 + 2]; n++;
      }
      if (n) done.push([q, r / n, g / n, b / n]); else next.push(q);
    }
    if (!done.length) break;
    for (const [q, r, g, b] of done) { data[q * 4] = r; data[q * 4 + 1] = g; data[q * 4 + 2] = b; filled[q] = 1; }
    todo = next;
  }
}

function box(c, w) {
  let x0 = 1e9, y0 = 1e9, x1 = 0, y1 = 0;
  for (const q of c) { const x = q % w, y = (q / w) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { contains: (b) => b.x0 >= x0 && b.y0 >= y0 && b.x1 <= x1 && b.y1 <= y1, x0, y0, x1, y1 };
}

const save = (name, png) => fs.writeFileSync(path.join(OUT, name), PNG.sync.write(png));
const r1 = (v) => Math.round(v * 1000) / 1000;

function build() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) fs.unlinkSync(path.join(OUT, f));
  const compo = cut(SHEET, ZONES.compo, 8000);
  const piece = (name) => cut(SHEET, ZONES[name], 8000);
  const P = { compo, visor: piece('visor'), torso: piece('torso') };
  const at = {
    compo: { s: 1, x: 0, y: 0 },
    visor: locate(P.visor, compo, { s: [0.3, 0.6], x: [150, 260], y: [150, 260] }, 3),
    torso: locate(P.torso, compo, { s: [0.6, 1.2], x: [-20, 160], y: [250, 400] }, 4),
  };
  for (const [k, v] of Object.entries(at)) console.log(k, JSON.stringify(v));
  const covers = (name, u, v) => {
    const p = P[name], t = at[name];
    const i = Math.round((u - t.x) / t.s), j = Math.round((v - t.y) / t.s);
    return i >= 0 && j >= 0 && i < p.w && j < p.h && p.mask[j * p.w + i];
  };
  const C = (q) => cls(px(compo.img, compo.x0 + (q % compo.w), compo.y0 + ((q / compo.w) | 0)));

  // Zigzag de la bouche du personnage complet (traits blancs sous la visière, loin des bords).
  const vx0 = at.visor.x, vx1 = at.visor.x + P.visor.w * at.visor.s;
  const vy0 = at.visor.y, vy1 = at.visor.y + P.visor.h * at.visor.s;
  const cz = { x0: 1e9, y0: 1e9, x1: -1, y1: -1 };
  for (let y = Math.ceil(vy1); y < vy1 + 45; y++) for (let x = Math.ceil(vx0 + (vx1 - vx0) * 0.2); x < vx1 - (vx1 - vx0) * 0.2; x++) {
    if (Math.min(...px(compo.img, compo.x0 + x, compo.y0 + y)) <= 170) continue;
    cz.x0 = Math.min(cz.x0, x); cz.y0 = Math.min(cz.y0, y); cz.x1 = Math.max(cz.x1, x); cz.y1 = Math.max(cz.y1, y);
  }

  // Le visage du personnage complet, à sa forme exacte : le noir et le vert reliés à la visière, entre la
  // racine des cheveux et le cou. Ligne par ligne, son étendue dit ce qui est devant (mèches) ou derrière.
  const neckY = Math.round(at.torso.y + 6);
  const face = new Uint8Array(compo.w * compo.h);
  const start = Math.round((vy0 + vy1) / 2) * compo.w + Math.round((vx0 + vx1) / 2);
  const stack = [start];
  face[start] = 1;
  while (stack.length) {
    const q = stack.pop();
    const x = q % compo.w, y = (q / compo.w) | 0;
    for (const o of [x > 0 ? q - 1 : -1, x < compo.w - 1 ? q + 1 : -1, q - compo.w, q + compo.w]) {
      const oy = (o / compo.w) | 0;
      if (o < 0 || o >= face.length || face[o] || !compo.mask[o] || C(o) === 2 || oy > neckY || oy < vy0 - 40) continue;
      const ox = o % compo.w;
      if (ox < vx0 - 25 || ox > vx1 + 25) continue;
      face[o] = 1;
      stack.push(o);
    }
  }
  const span = [];
  for (let y = 0; y < compo.h; y++) {
    let a = -1, b = -1;
    for (let x = 0; x < compo.w; x++) if (face[y * compo.w + x]) { if (a < 0) a = x; b = x; }
    span.push(a < 0 ? null : [a, b]);
  }
  const inSpan = (q) => { const s = span[(q / compo.w) | 0]; const x = q % compo.w; return s && x >= s[0] && x <= s[1]; };
  const onTorso = (q) => { const u = q % compo.w, v = (q / compo.w) | 0; return v > neckY && covers('torso', u, v); };
  // Derrière le visage, la chevelure est pleine (sombre) : quand elle bouge, aucun jour n'apparaît.
  save('cheveux.png', sprite(compo, (q) => compo.mask[q] && !onTorso(q), (x, y) => (inSpan(y * compo.w + x) ? [22, 6, 10] : px(compo.img, compo.x0 + x, compo.y0 + y))));
  save('meches.png', sprite(compo, (q) => compo.mask[q] && inSpan(q) && C(q) === 2));
  save('torse.png', sprite(P.torso));
  // Visage sans son zigzag (repeint avec le noir autour) : les bouches d'expression se posent dessus.
  const head = sprite(compo, (q) => face[q]);
  const zig = [];
  for (let y = cz.y0 - 2; y <= cz.y1 + 2; y++) for (let x = cz.x0 - 2; x <= cz.x1 + 2; x++) zig.push(y * compo.w + x);
  inpaint(head, zig);
  save('tete.png', head);

  // Visière sans les yeux, et chaque œil en deux pièces : orbite et iris.
  const V = P.visor;
  const greens = [];
  const isGreen = (q) => cls(px(SHEET, V.x0 + (q % V.w), V.y0 + ((q / V.w) | 0))) === 3;
  for (let q = 0; q < V.w * V.h; q++) if (V.mask[q] && isGreen(q)) greens.push(px(SHEET, V.x0 + (q % V.w), V.y0 + ((q / V.w) | 0)));
  const median = (k) => greens.map((c) => c[k]).sort((a, b) => a - b)[greens.length >> 1];
  const green = [median(0), median(1), median(2)];
  const nonGreen = new Uint8Array(V.w * V.h);
  for (let q = 0; q < V.w * V.h; q++) nonGreen[q] = V.mask[q] && !isGreen(q) ? 1 : 0;
  // Bords de la visière exclus : seules les orbites sont à l'intérieur.
  const margin = 6;
  const sockets = components(nonGreen, V.w, V.h).filter((c) => c.length > 800 && c.every((q) => q % V.w > margin && q % V.w < V.w - margin && q / V.w > margin && q / V.w < V.h - margin))
    // Le disque de l'iris est séparé de l'orbite par l'anneau vert : on ne garde que les orbites.
    .filter((c, _, all) => !all.some((o) => o !== c && o.length > c.length && box(o, V.w).contains(box(c, V.w))));
  const eyes = [];
  const plate = sprite(V);
  sockets.sort((a, b) => (a[0] % V.w) - (b[0] % V.w));
  for (const [n, sock] of sockets.entries()) {
    // L'orbite englobe l'anneau vert et l'iris : on bouche ses trous.
    let x0 = V.w, y0 = V.h, x1 = 0, y1 = 0;
    for (const q of sock) { const x = q % V.w, y = (q / V.w) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const m = new Uint8Array(w * h);
    for (const q of sock) m[((q / V.w | 0) - y0) * w + (q % V.w) - x0] = 1;
    for (const hole of components(m.map((v) => 1 - v), w, h)) {
      if (!hole.some((q) => q % w === 0 || q % w === w - 1 || q < w || q >= w * (h - 1))) for (const q of hole) m[q] = 1;
    }
    // Centre et rayon de l'iris : le bleu, puis l'anneau vert jusqu'au noir.
    let bx = 0, by = 0, bn = 0;
    for (let q = 0; q < w * h; q++) {
      if (m[q] && cls(px(SHEET, V.x0 + x0 + (q % w), V.y0 + y0 + ((q / w) | 0))) === 4) { bx += q % w; by += (q / w) | 0; bn++; }
    }
    const cx = bx / bn, cy = by / bn;
    const radii = [];
    for (let a = 0; a < 32; a++) {
      const dx = Math.cos((a / 32) * Math.PI * 2), dy = Math.sin((a / 32) * Math.PI * 2);
      let seenGreen = false;
      for (let r = 2; r < w; r++) {
        const x = Math.round(cx + dx * r), y = Math.round(cy + dy * r);
        if (x < 0 || y < 0 || x >= w || y >= h) break;
        const c = cls(px(SHEET, V.x0 + x0 + x, V.y0 + y0 + y));
        if (c === 3) seenGreen = true;
        else if (seenGreen && c === 1) { radii.push(r); break; }
      }
    }
    radii.sort((a, b) => a - b);
    const R = radii[radii.length >> 1] + 1;
    const sub = { x0: V.x0 + x0, y0: V.y0 + y0, w, h, mask: m, img: SHEET };
    const inIris = (q) => Math.hypot((q % w) - cx, ((q / w) | 0) - cy) <= R;
    save(`orbite-${n}.png`, sprite(sub, (q) => m[q], (x, y) => (inIris(y * w + x) ? [8, 10, 12] : px(SHEET, sub.x0 + x, sub.y0 + y))));
    save(`iris-${n}.png`, sprite(sub, (q) => m[q] && inIris(q)));
    eyes.push({ socket: `orbite-${n}.png`, iris: `iris-${n}.png`, x: x0, y: y0, w, h, cx: r1(cx), cy: r1(cy), r: R });
    // La plaque reçoit du vert à la place de l'œil (débordement de 2 px pour le liseré).
    const holes = new Set();
    for (let q = 0; q < w * h; q++) if (m[q]) for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) {
      const x = x0 + (q % w) + a, y = y0 + ((q / w) | 0) + b;
      if (V.mask[y * V.w + x]) holes.add(y * V.w + x);
    }
    for (const q of holes) { plate.data[q * 4] = green[0]; plate.data[q * 4 + 1] = green[1]; plate.data[q * 4 + 2] = green[2]; }
  }
  save('visiere.png', plate);

  // Bouches d'expression (planche noire), mises à l'échelle du zigzag du personnage complet.
  const glyphs = Object.fromEntries(Object.entries(EXPRESSIONS).map(([k, z]) => [k, glyph(SHEET_DARK, z)]));
  const gs = (cz.x1 - cz.x0 + 5) / glyphs.zigzag.w;
  const mouths = {};
  for (const [k, g] of Object.entries(glyphs)) {
    save(`bouche-${k}.png`, g.png);
    mouths[k] = { src: `bouche-${k}.png`, s: r1(gs), dx: r1((g.cx - glyphs.zigzag.cx) * 0 ), dy: r1((g.cy - glyphs.zigzag.cy) * gs) };
  }

  // Éclats de cheveux et du torse, pour les effets.
  const shards = cutEach(SHEET, ZONES.shards, 500).map((p, i) => { save(`eclat-${i}.png`, sprite(p)); return `eclat-${i}.png`; });
  const deco = cutEach(SHEET, ZONES.deco, 400).map((p, i) => { save(`deco-${i}.png`, sprite(p)); return `deco-${i}.png`; });

  const layer = (src, name) => ({ src, x: r1(at[name].x), y: r1(at[name].y), s: r1(at[name].s), w: P[name].w, h: P[name].h });
  const rig = {
    size: [compo.w, compo.h],
    layers: {
      cheveux: layer('cheveux.png', 'compo'),
      meches: layer('meches.png', 'compo'),
      torse: layer('torse.png', 'torso'),
      tete: layer('tete.png', 'compo'),
      visiere: layer('visiere.png', 'visor'),
    },
    neck: [r1((vx0 + vx1) / 2), neckY],
    eyes,
    mouth: { cx: r1((cz.x0 + cz.x1) / 2), cy: r1((cz.y0 + cz.y1) / 2), shapes: mouths },
    shards,
    deco,
  };
  // En script plutôt qu'en JSON : une page file:// ne peut pas lire un fichier par fetch.
  fs.writeFileSync(path.join(OUT, 'rig.js'), `// Généré par tools/build-rig.cjs.\nwindow.CAPRI_RIG = ${JSON.stringify(rig, null, 1)};\n`);
  console.log('rig :', Object.keys(rig.layers).length, 'calques,', eyes.length, 'yeux,', Object.keys(mouths).length, 'bouches,', shards.length + deco.length, 'éclats');
}

module.exports = { SHEET, SHEET_DARK, ZONES, EXPRESSIONS, cut, cutEach, locate, cls, px, components };

if (require.main === module) build();
