// Visage « visière » de CAPRI, relevé au pixel sur IMAGE_DE_REFERENCE/HVFvnXxXcAE2SVD.webp (724 × 570) :
//   npx electron tools/mesure-visiere.cjs   →   src/renderer/visage-visiere.js (window.CAPRI_VISOR)
// Pièces : visière (avec ses ailes), orbites (pointes comprises), anneau, iris, pupille de chaque œil. Le liseré
// violet de l'image est le flanc de chaque pièce en relief : on le reproduit par une copie violette décalée,
// dessinée sous la pièce ; le décalage de chaque pièce est celui qui retrouve le mieux le violet de l'image.
// Repère de sortie : celui du visage plat (420 × 420, visière de 97 à 290), comme les bouches de visage-plat.js.
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const IMG = path.join(ROOT, 'IMAGE_DE_REFERENCE', 'HVFvnXxXcAE2SVD.webp');
const OUT = path.join(ROOT, 'src', 'renderer', 'visage-visiere.js');
// Passage au repère du visage plat (même passage que le cri de visage-plat.js : haut de la visière 49 → 97).
const K = 193 / 297;
const toFrame = ([x, y]) => [round1((x - 362) * K + 210), round1((y - 49) * K + 97)];
const round1 = (v) => Math.round(v * 10) / 10;
const OVERSCAN = 500; // les bords coupés par l'image sont prolongés bien au-delà de l'écran (la tête bouge)

async function pixels() {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<body>');
  const b64 = fs.readFileSync(IMG).toString('base64');
  const r = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image(); img.src = 'data:image/webp;base64,${b64}'; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height);
    return { w: d.width, h: d.height, data: Array.from(d.data) };
  })()`);
  win.destroy();
  return r;
}

// Classes : W blanc, G vert, P violet, B bleu, D sombre (fond, orbites).
const classify = (r, g, b) => {
  if (r > 200 && g > 200 && b > 200) return 'W';
  if (g > 140 && g > r + 60 && g > b + 40) return 'G';
  if (b > 110 && b > g + 60 && r > 40) return 'P';
  if (b > 150 && r < 40) return 'B';
  return 'D';
};

function measure({ w: W, h: H, data }) {
  const cls = new Array(W * H);
  for (let i = 0; i < W * H; i++) cls[i] = classify(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? null : cls[y * W + x]);
  const rgbAt = (i) => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];

  // Composante 4-connexe d'une classe depuis une graine (ou masque déjà donné), dans une boîte.
  const flood = (seeds, ok, box = [0, 0, W - 1, H - 1]) => {
    const m = new Uint8Array(W * H);
    const st = [];
    for (const [x, y] of seeds) if (ok(x, y)) { m[y * W + x] = 1; st.push([x, y]); }
    while (st.length) {
      const [x, y] = st.pop();
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const u = x + a, v = y + b;
        if (u < box[0] || v < box[1] || u > box[2] || v > box[3] || m[v * W + u] || !ok(u, v)) continue;
        m[v * W + u] = 1;
        st.push([u, v]);
      }
    }
    return m;
  };
  // Trous bouchés : ce que le bord de l'image n'atteint pas sans traverser le masque.
  const fill = (m) => {
    const out = flood(
      Array.from({ length: W }, (_, x) => [[x, 0], [x, H - 1]]).flat().concat(Array.from({ length: H }, (_, y) => [[0, y], [W - 1, y]]).flat()),
      (x, y) => !m[y * W + x],
    );
    const f = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) f[i] = out[i] ? 0 : 1;
    return f;
  };
  const count = (m) => m.reduce((a, v) => a + v, 0);

  // Les orbites sortent de l'image par les côtés, au-dessus de la pointe de chaque aile de la visière (qui n'atteint
  // pas toujours le bord) : entre la pointe et le bord, ce qui est au-dessus est de l'orbite, dessous du fond.
  const green = flood([[362, 100]], (x, y) => at(x, y) === 'G');
  const tips = [0, 1].map((side) => {
    let tip = null;
    for (let i = 0; i < W * H; i++) {
      const x = i % W, y = (i / W) | 0;
      if (!green[i] || y < 150 || (side ? x < W / 2 : x > W / 2)) continue;
      if (!tip || (side ? x > tip[0] : x < tip[0])) tip = [x, y];
    }
    return tip;
  });
  const tipY = tips.map((t) => t[1]);
  const edgeSide = (x) => (x <= tips[0][0] + 2 ? 0 : x >= tips[1][0] - 2 ? 1 : -1);
  const socketStrip = (x, y) => { const side = edgeSide(x); return side >= 0 && y > 60 && y < tipY[side]; };
  // Fond : le sombre relié au haut et au bas de l'image, sans passer par le bord des orbites.
  const bg = flood([[362, 5], [362, H - 5], [5, H - 5], [W - 5, H - 5], [5, 5], [W - 5, 5]], (x, y) => at(x, y) === 'D' && !socketStrip(x, y));

  // Pupilles : les deux plus grandes taches blanches dans la visière.
  const seen = new Uint8Array(W * H);
  const blobs = [];
  for (let y = 60; y < 340; y++) for (let x = 0; x < W; x++) {
    if (seen[y * W + x] || at(x, y) !== 'W') continue;
    const m = flood([[x, y]], (u, v) => at(u, v) === 'W');
    let n = 0, sx = 0, sy = 0;
    for (let i = 0; i < W * H; i++) if (m[i]) { seen[i] = 1; n++; sx += i % W; sy += (i / W) | 0; }
    blobs.push({ n, cx: sx / n + 0.5, cy: sy / n + 0.5 });
  }
  const pupils = blobs.sort((a, b) => b.n - a.n).slice(0, 2).sort((a, b) => a.cx - b.cx);

  const eyes = pupils.map((p, index) => {
    const box = index ? [362, 60, W - 1, 335] : [0, 60, 361, 335];
    const inBox = (x, y) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];
    // Iris : bleu et blanc autour de la pupille (centre de l'iris = centre de ces pixels).
    let n = 0, sx = 0, sy = 0;
    for (let y = box[1]; y <= box[3]; y++) for (let x = box[0]; x <= box[2]; x++) {
      const k = at(x, y);
      if ((k === 'B' || k === 'W') && Math.hypot(x - p.cx, y - p.cy) < 95) { n++; sx += x + 0.5; sy += y + 0.5; }
    }
    const cx = sx / n, cy = sy / n;
    const iris = Math.sqrt(n / Math.PI);
    const pupil = Math.sqrt(p.n / Math.PI);
    // Anneau : sur chaque rayon partant de l'iris, premier passage vert après l'iris. Là où il est mince et bordé de
    // sombre ou de violet, c'est l'anneau (ailleurs, la visière mord dans l'œil et le recouvre) : cercle ajusté sur
    // le bord intérieur de ces passages, épaisseur médiane.
    const inner = [], widths = [];
    for (let a = 0; a < 360; a += 1) {
      const dx = Math.cos((a * Math.PI) / 180), dy = Math.sin((a * Math.PI) / 180);
      let start = -1, end = -1, left = false;
      for (let r = iris * 0.7; r < 130; r += 0.5) {
        const k = at(Math.round(cx + dx * r), Math.round(cy + dy * r));
        if (!left) { if (k !== 'B' && k !== 'W') left = true; else continue; }
        if (start < 0 && k === 'G') start = r;
        else if (start >= 0 && k !== 'G') { end = r; break; }
      }
      const after = end > 0 ? at(Math.round(cx + dx * (end + 2)), Math.round(cy + dy * (end + 2))) : null;
      if (start > 0 && end - start < 16 && (after === 'D' || after === 'P')) { inner.push([cx + dx * start, cy + dy * start]); widths.push(end - start); }
    }
    const [rcx, rcy] = fitCircle(inner);
    const rIn = inner.reduce((sum, [x, y]) => sum + Math.hypot(x - rcx, y - rcy), 0) / inner.length;
    const width = widths.sort((p, q) => p - q)[widths.length >> 1];
    const ring = [rIn, rIn + width];
    const ringAt = [rcx - cx, rcy - cy];
    // Orbite : le sombre de la boîte qui n'est pas le fond, plus le disque de l'anneau ; trous bouchés.
    const dark = new Uint8Array(W * H);
    for (let y = box[1]; y <= box[3]; y++) for (let x = box[0]; x <= box[2]; x++) {
      const i = y * W + x;
      const strip = edgeSide(x) >= 0;
      // Sombre hors fond ; dans l'anneau, tout ce qui n'est pas vert (iris, pupille, liserés) ; l'anneau lui-même là
      // où il est bordé de sombre. Le vert de la visière qui mord dans l'œil reste dehors.
      const d = Math.hypot(x + 0.5 - rcx, y + 0.5 - rcy);
      const k = at(x, y);
      const outside = at(Math.round(rcx + ((x + 0.5 - rcx) / d) * (ring[1] + 3)), Math.round(rcy + ((y + 0.5 - rcy) / d) * (ring[1] + 3)));
      if ((k === 'D' && !bg[i] && (!strip || socketStrip(x, y)))
        || (d <= ring[1] && k !== 'G')
        || (d >= ring[0] - 1 && d <= ring[1] + 1 && (outside === 'D' || outside === 'P'))) dark[i] = 1;
    }
    // Garde les morceaux d'au moins 300 px (l'anneau peut couper l'orbite en deux) ; les grains isolés sont écartés.
    // Contour lissé par une fermeture (bouche les entailles) ; pas d’ouverture, qui rognerait les pointes fines.
    const socket = fill(close(pieces(dark, W, H, flood, 300), W, H, 2));
    return { index, cx, cy, iris, pupil, pupilAt: [p.cx - cx, p.cy - cy], ring, ringAt, socket, inBox };
  });

  // Visière : vert relié au milieu, plus les orbites ; trous bouchés.
  const visorMask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) visorMask[i] = green[i] || eyes[0].socket[i] || eyes[1].socket[i] ? 1 : 0;
  const visor = fill(visorMask);

  // Copie violette : décalage (dx, dy) qui pose le plus de violet là où la pièce décalée dépasse d'elle-même,
  // et le moins sur du vert visible.
  const purple = (cls_) => cls_ === 'P';
  const bestShift = (mask, near) => {
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let i = 0; i < W * H; i++) if (mask[i]) { const x = i % W, y = (i / W) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    x0 = Math.max(0, x0 - 15); y0 = Math.max(0, y0 - 15); x1 = Math.min(W - 1, x1 + 15); y1 = Math.min(H - 1, y1 + 15);
    let best = { score: -1e9, d: [0, 0] };
    for (let dy = -14; dy <= 14; dy++) for (let dx = -14; dx <= 14; dx++) {
      let score = 0;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        if (mask[i] || !near(x, y)) continue;
        const sx = x - dx, sy = y - dy;
        if (sx < 0 || sy < 0 || sx >= W || sy >= H || !mask[sy * W + sx]) continue;
        const k = cls[i];
        score += purple(k) ? 1 : k === 'G' || k === 'W' ? -0.6 : -0.15;
      }
      if (score > best.score) best = { score, d: [dx, dy] };
    }
    return best.d;
  };
  const disc = (cx, cy, r0, r1) => {
    const m = new Uint8Array(W * H);
    for (let y = Math.floor(cy - r1 - 1); y <= cy + r1 + 1; y++) for (let x = Math.floor(cx - r1 - 1); x <= cx + r1 + 1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (x >= 0 && y >= 0 && x < W && y < H && d <= r1 && d >= r0) m[y * W + x] = 1;
    }
    return m;
  };
  const visorShift = bestShift(visor, () => true);
  const rx = (e) => e.cx + e.ringAt[0], ry = (e) => e.cy + e.ringAt[1];
  for (const e of eyes) {
    e.shift = {
      // Chaque recherche regarde la zone de sa pièce : bord de l'orbite hors anneau, autour de l'anneau, dans l'anneau.
      socket: bestShift(e.socket, (x, y) => e.inBox(x, y) && Math.hypot(x - rx(e), y - ry(e)) > e.ring[1] + 4),
      ring: bestShift(disc(rx(e), ry(e), e.ring[0], e.ring[1]), (x, y) => e.socket[y * W + x] && Math.hypot(x - rx(e), y - ry(e)) < e.ring[1] + 14),
      iris: bestShift(disc(e.cx, e.cy, 0, e.iris), (x, y) => Math.hypot(x - rx(e), y - ry(e)) < e.ring[0]),
    };
  }

  // Couleurs : médianes.
  const medianColor = (pick) => {
    const ch = [[], [], []];
    for (let i = 0; i < W * H; i += 3) if (pick(i)) rgbAt(i).forEach((v, c) => ch[c].push(v));
    return ch.map((v) => v.sort((a, b) => a - b)[v.length >> 1]);
  };
  const colors = {
    green: medianColor((i) => cls[i] === 'G'),
    purple: medianColor((i) => cls[i] === 'P'),
    blue: medianColor((i) => cls[i] === 'B'),
    white: medianColor((i) => cls[i] === 'W'),
    black: medianColor((i) => cls[i] === 'D' && eyes.some((e) => e.socket[i] && Math.hypot((i % W) - e.cx, ((i / W) | 0) - e.cy) > e.ring[1] + 3)),
    background: medianColor((i) => bg[i]),
  };

  // Contours : suivi de bord, simplification, prolongement des bords coupés, passage au repère.
  const shape = (mask) => {
    const pts = simplify(trace(mask, W, H), 0.8);
    return pts.map(([x, y]) => toFrame([x <= 0.6 ? x - OVERSCAN : x >= W - 0.6 ? x + OVERSCAN : x, y]));
  };
  const s = (v) => round1(v * K);
  return {
    source: { file: 'HVFvnXxXcAE2SVD.webp', size: [W, H], scale: round1(K * 1000) / 1000 },
    tipY,
    colors,
    visor: { shape: shape(visor), shift: visorShift.map(s) },
    eyes: eyes.map((e) => {
      const [fx, fy] = toFrame([e.cx, e.cy]);
      return {
        cx: fx, cy: fy, iris: s(e.iris), pupil: s(e.pupil), pupilAt: e.pupilAt.map(s), ring: e.ring.map(s), ringAt: e.ringAt.map(s),
        socket: shape(e.socket).map(([x, y]) => [round1(x - fx), round1(y - fy)]),
        shift: Object.fromEntries(Object.entries(e.shift).map(([k, d]) => [k, d.map(s)])),
      };
    }),
  };
}

// Morphologie sur masque binaire (voisinage 3 × 3, répété n fois).
function morph(m, W, H, n, grow) {
  let cur = m;
  for (let k = 0; k < n; k++) {
    const next = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let any = 0, all = 1;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const u = Math.min(W - 1, Math.max(0, x + dx)), v = Math.min(H - 1, Math.max(0, y + dy));
        if (cur[v * W + u]) any = 1; else all = 0;
      }
      next[y * W + x] = grow ? any : all;
    }
    cur = next;
  }
  return cur;
}
const close = (m, W, H, n) => morph(morph(m, W, H, n, true), W, H, n, false);

// Cercle des moindres carrés (méthode de Kåsa) : centre.
function fitCircle(pts) {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  const n = pts.length;
  for (const [x, y] of pts) {
    const z = x * x + y * y;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z;
  }
  // Résout [sxx sxy sx; sxy syy sy; sx sy n] [D E F] = -[sxz syz sz].
  const A = [[sxx, sxy, sx, -sxz], [sxy, syy, sy, -syz], [sx, sy, n, -sz]];
  for (let c = 0; c < 3; c++) {
    const p = A.slice(c).reduce((best, row, i) => (Math.abs(row[c]) > Math.abs(A[best][c]) ? i + c : best), c);
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 3; r++) if (r !== c) { const k = A[r][c] / A[c][c]; for (let j = c; j < 4; j++) A[r][j] -= k * A[c][j]; }
  }
  return [-(A[0][3] / A[0][0]) / 2, -(A[1][3] / A[1][1]) / 2];
}

// Union des composantes d'au moins `min` pixels.
function pieces(m, W, H, flood, min) {
  const seen = new Uint8Array(W * H);
  const out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (!m[i] || seen[i]) continue;
    const c = flood([[i % W, (i / W) | 0]], (x, y) => m[y * W + x] === 1);
    let n = 0;
    for (let j = 0; j < W * H; j++) if (c[j]) { seen[j] = 1; n++; }
    if (n >= min) for (let j = 0; j < W * H; j++) if (c[j]) out[j] = 1;
  }
  return out;
}

// Contour extérieur (suivi de Moore) en coordonnées de bord de pixel.
function trace(m, W, H) {
  const has = (x, y) => x >= 0 && y >= 0 && x < W && y < H && m[y * W + x];
  let start = -1;
  for (let q = 0; q < W * H && start < 0; q++) if (m[q]) start = q;
  const sx = start % W, sy = (start / W) | 0;
  const dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const pts = [[sx, sy]];
  let x = sx, y = sy, d = 6;
  for (let n = 0; n < 200000; n++) {
    let found = false;
    for (let k = 0; k < 8; k++) {
      const dd = (d + 6 + k) % 8;
      const u = x + dirs[dd][0], v = y + dirs[dd][1];
      if (has(u, v)) { x = u; y = v; d = dd; found = true; break; }
    }
    if (!found || (x === sx && y === sy)) break;
    pts.push([x, y]);
  }
  // Bord de pixel : les pixels collés aux bords de l'image vont jusqu'au bord.
  return pts.map(([a, b]) => [a === 0 ? 0 : a === W - 1 ? W : a + 0.5, b + 0.5]);
}

// Douglas-Peucker sur un contour fermé.
function simplify(pts, eps) {
  const dp = (a, b) => {
    let best = -1, idx = -1;
    const [x1, y1] = pts[a], [x2, y2] = pts[b];
    const L = Math.hypot(x2 - x1, y2 - y1) || 1;
    for (let i = a + 1; i < b; i++) {
      const dd = Math.abs((x2 - x1) * (y1 - pts[i][1]) - (x1 - pts[i][0]) * (y2 - y1)) / L;
      if (dd > best) { best = dd; idx = i; }
    }
    return best > eps ? [...dp(a, idx).slice(0, -1), ...dp(idx, b)] : [a, b];
  };
  const far = pts.reduce((bi, p, i) => (Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) > Math.hypot(pts[bi][0] - pts[0][0], pts[bi][1] - pts[0][1]) ? i : bi), 0);
  const idx = [...dp(0, far).slice(0, -1), ...dp(far, pts.length - 1)];
  return idx.map((i) => pts[i]);
}

setTimeout(() => { console.error('délai dépassé'); process.exit(1); }, 180000);
app.on('window-all-closed', () => {}); // la fenêtre cachée se ferme avant le calcul
app.whenReady().then(async () => {
  const data = measure(await pixels());
  const header = '// Visage « visière » de CAPRI, relevé au pixel sur IMAGE_DE_REFERENCE/HVFvnXxXcAE2SVD.webp par\n'
    + '// tools/mesure-visiere.cjs (ne pas modifier à la main). Repère du visage plat (420 × 420) ; orbites données\n'
    + '// par rapport au centre de l\'iris ; shift = décalage de la copie violette (flanc en relief) de chaque pièce.\n';
  fs.writeFileSync(OUT, header + 'window.CAPRI_VISOR = ' + JSON.stringify(data) + ';\n');
  console.log(JSON.stringify({ tipY: data.tipY, colors: data.colors, visor: { points: data.visor.shape.length, shift: data.visor.shift }, eyes: data.eyes.map((e) => ({ cx: e.cx, cy: e.cy, iris: e.iris, pupil: e.pupil, pupilAt: e.pupilAt, ring: e.ring, points: e.socket.length, shift: e.shift })) }, null, 1));
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
