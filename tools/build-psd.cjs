// PSD de départ pour Live2D Cubism, tiré de l'image HD (src/renderer/capri.png) :
//   npx electron tools/build-psd.cjs   →   live2d/capri-depart.psd (+ live2d/apercu-calques.png)
// Mêmes découpes que le visage HD de l'application (buildRig de capri.js) : orbites, iris, visage sans yeux ni
// bouche ; bouches dessinées par drawMouthShape d'après les poses. Ce que l'image ne montre pas (crâne sous les
// mèches, visière sous les yeux et sous les mèches) est rempli d'une couleur unie : c'est une base à retoucher.
// Pixels transparents à RGBA 0,0,0,0 : Cubism ferait sinon des îlots parasites.
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');
const { writePsdBuffer } = require('ag-psd');
const { PNG } = require('pngjs');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'live2d');
const RENDERER = path.join(ROOT, 'src', 'renderer');

// Exécuté dans la page : découpe, rend { width, height, layers: [{ name, group?, hidden?, data (base64 RGBA) }] }.
const CUT = `(async () => {
  const P = window.CAPRI_PIECES;
  const image = new Image();
  image.src = window.CAPRI_PNG;
  await image.decode();
  const W = P.SRC.w, H = P.SRC.h;
  const canvas = (w = W, h = H) => Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctxOf = (c) => c.getContext('2d', { willReadFrequently: true });
  const work = ctxOf(canvas());
  work.drawImage(image, 0, 0);
  const src = work.getImageData(0, 0, W, H).data;

  // Tête : ellipse qui couvre la visière, le menton et le crâne caché sous les mèches.
  const HEAD = { x: 870, y: 590, rx: 180, ry: 165 };
  const inHead = (x, y) => ((x - HEAD.x) / HEAD.rx) ** 2 + ((y - HEAD.y) / HEAD.ry) ** 2 <= 1;
  // Cou et buste (bandes rouges comprises).
  const TORSO = [[820, 745], [905, 745], [912, 800], [1090, 838], [1105, 912], [625, 912], [640, 838], [812, 800]];
  // Visière : quadrilatère relevé sur l'image (coins du haut cachés par les mèches).
  const VISOR = [[703, 524], [1036, 526], [1036, 600], [1020, 648], [722, 656]];
  const inPoly = (poly, x, y) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const inTorso = (x, y) => inPoly(TORSO, x, y);
  const isRed = (r, g, b) => r > 70 && r > g + 45 && r > b + 20;
  const isBg = (r, g, b) => Math.max(r, g, b) < 75 && (r - g >= 7 || b - g >= 7);

  const blank = () => new Uint8ClampedArray(W * H * 4);
  const L = { fond: blank(), cheveux: blank(), corps: blank(), tete: blank(), meches: blank() };
  const set = (a, i, r, g, b) => { a[i] = r; a[i + 1] = g; a[i + 2] = b; a[i + 3] = 255; };

  // Visage sans yeux ni bouche (plaque de buildRig, repère FACE) et vert moyen de la visière.
  const rig = P.buildRig(image);
  const plate = ctxOf(rig.plate).getImageData(0, 0, P.FACE.w, P.FACE.h).data;
  let gr = 0, gg = 0, gb = 0, gn = 0;
  for (let i = 0; i < src.length; i += 4) if (src[i + 1] > 200 && src[i + 1] > src[i] + 60 && src[i + 1] > src[i + 2] + 40) { gr += src[i]; gg += src[i + 1]; gb += src[i + 2]; gn++; }
  const green = [gr / gn, gg / gn, gb / gn].map(Math.round);

  // Fond : couleur moyenne du fond, ligne par ligne.
  for (let y = 0; y < H; y++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; if (isBg(src[i], src[i + 1], src[i + 2])) { r += src[i]; g += src[i + 1]; b += src[i + 2]; n++; } }
    const c = n ? [r / n, g / n, b / n] : [15, 5, 14];
    for (let x = 0; x < W; x++) set(L.fond, (y * W + x) * 4, ...c);
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const r = src[i], g = src[i + 1], b = src[i + 2];
      const red = isRed(r, g, b);
      if (inTorso(x, y)) { if (!isBg(r, g, b)) set(L.corps, i, r, g, b); continue; }
      if (inHead(x, y) && y < 755) {
        if (red) set(L.meches, i, r, g, b);
        // Visage : plaque dans la zone FACE, image ailleurs ; sous les mèches et le fond, visière ou peau noire.
        const fx = x - P.FACE.x, fy = y - P.FACE.y;
        const inFace = fx >= 0 && fy >= 0 && fx < P.FACE.w && fy < P.FACE.h;
        const p = inFace ? (fy * P.FACE.w + fx) * 4 : i;
        const s = inFace ? plate : src;
        const sr = s[p], sg = s[p + 1], sb = s[p + 2];
        const greenish = sg > sr + 40 && sg > sb + 20;
        // Dans la visière, ce qui n'est pas vert vient des mèches (rouge, bords, ombres), sauf le long du bord
        // du bas (contour et ombre du nez) ; sur la moitié haute, le vert sombre est l'ombre des mèches.
        const bottom = 648 + ((1020 - x) * 8) / 298;
        const covered = inPoly(VISOR, x, y) && (greenish ? y < 600 && sg < 190 : y < bottom - 12);
        if (covered) set(L.tete, i, ...green);
        else if (!isRed(sr, sg, sb) && !isBg(sr, sg, sb)) set(L.tete, i, sr, sg, sb);
        else set(L.tete, i, 17, 17, 17);
        continue;
      }
      if (red) set(L.cheveux, i, r, g, b);
    }
  }

  // Calques dessinés au canevas, à leur place dans l'image.
  const drawn = (paint) => { const c = canvas(); const ctx = ctxOf(c); paint(ctx); return ctx.getImageData(0, 0, W, H).data; };
  const eyeLayer = (piece, e) => drawn((ctx) => ctx.drawImage(piece, Math.round(P.EYES[e].cx - P.EYE_R), Math.round(P.EYES[e].cy - P.EYE_R)));
  // Paupière : disque de visière qui couvre l'œil, à déformer en « U » pour le fermer (yeux de la série).
  const lid = (e) => drawn((ctx) => {
    ctx.fillStyle = 'rgb(' + green.join(',') + ')';
    ctx.beginPath();
    ctx.arc(P.EYES[e].cx, P.EYES[e].cy, P.EYE_R - 4, 0, Math.PI * 2);
    ctx.fill();
  });
  const mouth = (m) => drawn((ctx) => P.drawMouthShape(ctx, { open: 0, width: 1, curve: 0, zig: 0, tooth: 0, round: 0, tri: 0, pixel: 0, ...m }, false));

  // Convention Live2D (ParamEyeLOpen…) : G = œil gauche de CAPRI, à droite de l'écran (EYES[1]).
  const E = ['D', 'G'];
  const eyes = [1, 0].flatMap((e) => [
    { name: 'Orbite ' + E[e], group: 'Œil ' + E[e], data: eyeLayer(rig.sockets[e], e) },
    { name: 'Iris ' + E[e], group: 'Œil ' + E[e], data: eyeLayer(rig.irises[e], e) },
    { name: 'Paupière ' + E[e], group: 'Œil ' + E[e], hidden: true, data: lid(e) },
  ]);
  const M = P.POSES;
  const mouths = [
    ['Bouche sourire', M.neutre.mouth, false],
    ['Bouche ouverte', { ...M.parle.mouth, open: 0.6 }, true],
    ['Bouche rire', M.rire.mouth, true],
    ['Bouche o', M.surprise.mouth, true],
    ['Bouche triangle', { tri: 1 }, true],
    ['Bouche zigzag', M.fache.mouth, true],
    ['Bouche moue', M.triste.mouth, true],
    ['Bouche plate', M.boude.mouth, true],
  ].map(([name, m, hidden]) => ({ name, group: 'Bouche', hidden, data: mouth(m) }));

  const layers = [
    { name: 'Fond', data: L.fond },
    { name: 'Cheveux arrière', data: L.cheveux },
    { name: 'Corps', data: L.corps },
    { name: 'Tête', data: L.tete },
    ...eyes,
    ...mouths,
    { name: 'Mèches devant', data: L.meches },
  ];
  const b64 = (a) => { let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
  return { width: W, height: H, layers: layers.map((l) => ({ ...l, data: b64(l.data) })) };
})()`;

// Recadre un calque sur ses pixels visibles et remet à 0 le RGB des pixels transparents.
function crop(data, W, H) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (data[i + 3] === 0) { data[i] = data[i + 1] = data[i + 2] = 0; continue; }
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) out.set(data.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0 + w) * 4), y * w * 4);
  return { left: x0, top: y0, imageData: { width: w, height: h, data: out } };
}

setTimeout(() => { console.error('délai dépassé'); process.exit(1); }, 120000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<meta charset="utf-8"><body>');
  await win.webContents.executeJavaScript(`window.CAPRI_PNG = 'data:image/png;base64,${fs.readFileSync(path.join(RENDERER, 'capri.png')).toString('base64')}'`);
  await win.webContents.executeJavaScript(fs.readFileSync(path.join(RENDERER, 'capri.js'), 'utf8'));
  const cut = await win.webContents.executeJavaScript(CUT);
  win.destroy();

  const { width: W, height: H } = cut;
  const composite = new Uint8ClampedArray(W * H * 4);
  const children = [];
  const groups = new Map();
  for (const layer of cut.layers) {
    const data = new Uint8ClampedArray(Buffer.from(layer.data, 'base64'));
    // Image d'ensemble : calques visibles empilés (tous opaques ou transparents, sans fondu partiel hors bords).
    if (!layer.hidden) for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] / 255;
      for (let c = 0; c < 3; c++) composite[i + c] = data[i + c] * a + composite[i + c] * (1 - a);
      composite[i + 3] = 255;
    }
    const piece = crop(data, W, H);
    if (!piece) continue;
    const entry = { name: layer.name, hidden: !!layer.hidden, ...piece };
    if (!layer.group) { children.push(entry); continue; }
    if (!groups.has(layer.group)) { const g = { name: layer.group, opened: true, children: [] }; groups.set(layer.group, g); children.push(g); }
    groups.get(layer.group).children.push(entry);
  }

  fs.mkdirSync(OUT, { recursive: true });
  const psd = path.join(OUT, 'capri-depart.psd');
  fs.writeFileSync(psd, writePsdBuffer({ width: W, height: H, imageData: { width: W, height: H, data: composite }, children }));
  const png = new PNG({ width: W, height: H });
  png.data = Buffer.from(composite);
  fs.writeFileSync(path.join(OUT, 'apercu-calques.png'), PNG.sync.write(png));
  const count = children.reduce((n, c) => n + (c.children ? c.children.length : 1), 0);
  console.log(`${psd} : ${count} calques, ${Math.round(fs.statSync(psd).size / 1024)} ko`);
  app.quit();
});
