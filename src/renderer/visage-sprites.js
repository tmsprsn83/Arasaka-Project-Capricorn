// Visage « écran » de CAPRI fait de ses images (src/renderer/visage/, fournies par Tommy) : visière de face,
// bouches (zigzag, vague, ouverte, cri), et l'exemple de composition pour placer le cri. Au chargement, la visière
// est découpée en pièces : iris de chaque œil (mobile, suit le regard, vu seulement dans son anneau), anneau,
// visière, et l'orbite qui reçoit les paupières. Couleurs ramenées à la palette exacte de CAPRI ; halo néon (glow)
// précalculé. Les paupières sont de la visière : même vert, posées par-dessus le bord de l'orbite, pour qu'un œil
// fermé ne laisse aucune démarcation ; les pointes restent.
(function () {
  const PALETTE = [[0, 255, 102], [128, 0, 255], [0, 85, 255], [255, 255, 255]]; // vert, violet, bleu, blanc
  const [GREEN, PURPLE, BLUE, WHITE] = [1, 2, 3, 4];
  const css = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const smooth = (v) => { const t = clamp(v); return t * t * (3 - 2 * t); };
  const canvasOf = (w, h) => Object.assign(document.createElement('canvas'), { width: Math.ceil(w), height: Math.ceil(h) });
  const load = (src) => new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = src; });
  const pixels = (img) => { const c = canvasOf(img.width, img.height); const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height); };

  const LID_EDGE = 16; // la paupière déborde de l'orbite de l'épaisseur de son liseré (aucune démarcation)
  const LID_STRIPE = 8; // liseré violet au bord de la paupière qui descend
  const MOUTH_DROP = 14; // bouches descendues sous la visière (unités du visage plat)

  // Découpe de la visière. Repère : pixels de visage.png.
  function cut(face, composition, mouthTri) {
    const W = face.width, H = face.height;
    const N = W * H;
    const cls = new Uint8Array(N), alpha = new Uint8Array(N);
    const d = face.data;
    for (let i = 0; i < N; i++) {
      const a = d[i * 4 + 3], r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
      if (a < 25 || Math.max(r, g, b) < 60) continue; // transparent, ou taches sombres parasites du détourage
      let best = 0, bestD = 1e9;
      PALETTE.forEach((p, k) => { const dd = (r - p[0]) ** 2 + (g - p[1]) ** 2 + (b - p[2]) ** 2; if (dd < bestD) { bestD = dd; best = k + 1; } });
      cls[i] = best;
      alpha[i] = a > 235 ? 255 : a; // intérieur pleinement opaque : sinon (0, 253, 101), et les paupières (0, 255, 102) s'y voyaient
    }
    const xy = (i) => [i % W, (i / W) | 0];
    // Composante 4-connexe.
    const flood = (seeds, ok) => {
      const m = new Uint8Array(N);
      const st = [];
      for (const i of seeds) if (!m[i] && ok(i)) { m[i] = 1; st.push(i); }
      while (st.length) {
        const i = st.pop();
        const x = i % W;
        for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W]) {
          if (j < 0 || j >= N || m[j] || !ok(j)) continue;
          m[j] = 1;
          st.push(j);
        }
      }
      return m;
    };
    // Dilatation de distance `n` (pas de 8-voisinage), dans une boîte.
    const dilate = (m, n, [x0, y0, x1, y1]) => {
      let cur = m;
      for (let k = 0; k < n; k++) {
        const next = cur.slice();
        for (let y = Math.max(1, y0); y < Math.min(H - 1, y1); y++) for (let x = Math.max(1, x0); x < Math.min(W - 1, x1); x++) {
          const i = y * W + x;
          if (cur[i]) continue;
          if (cur[i - 1] || cur[i + 1] || cur[i - W] || cur[i + W] || cur[i - W - 1] || cur[i - W + 1] || cur[i + W - 1] || cur[i + W + 1]) next[i] = 1;
        }
        cur = next;
      }
      return cur;
    };

    // Visière : lignes où le vert domine ; centre et repères.
    let vy0 = -1, vy1 = -1, vx0 = W, vx1 = 0;
    for (let y = 0; y < H; y++) {
      let n = 0;
      for (let x = 0; x < W; x++) { const k = cls[y * W + x]; if (k === GREEN) n++; if (k) { vx0 = Math.min(vx0, x); vx1 = Math.max(vx1, x); } }
      if (n > W * 0.05) { if (vy0 < 0) vy0 = y; vy1 = y; }
    }

    // Pupilles : les deux plus grandes taches blanches de la visière.
    const seen = new Uint8Array(N);
    const blobs = [];
    for (let i = 0; i < N; i++) {
      if (seen[i] || cls[i] !== WHITE || i / W > vy1) continue;
      const m = flood([i], (j) => cls[j] === WHITE);
      let n = 0, sx = 0, sy = 0;
      for (let j = 0; j < N; j++) if (m[j]) { seen[j] = 1; n++; sx += j % W; sy += (j / W) | 0; }
      blobs.push({ n, x: sx / n, y: sy / n });
    }
    const pupils = blobs.sort((a, b) => b.n - a.n).slice(0, 2).sort((a, b) => a.x - b.x);

    const irisLayer = new Uint8Array(N), ringLayer = new Uint8Array(N);
    const eyes = pupils.map((p) => {
      // Iris : bleu et blanc autour de la pupille.
      let n = 0, sx = 0, sy = 0;
      for (let y = Math.max(0, p.y - 260 | 0); y < Math.min(H, p.y + 260); y++) for (let x = Math.max(0, p.x - 260 | 0); x < Math.min(W, p.x + 260); x++) {
        const k = cls[y * W + x];
        if (k === BLUE || k === WHITE) { n++; sx += x; sy += y; }
      }
      const cx = sx / n, cy = sy / n, r = Math.sqrt(n / Math.PI);
      const dist = (i) => Math.hypot((i % W) - cx, ((i / W) | 0) - cy);
      const box = [Math.max(0, cx - r * 4 | 0), Math.max(0, vy0 - 2), Math.min(W, cx + r * 4 | 0), Math.min(H, vy1 + 2)];
      // Pièce de l'iris : bleu, blanc, et son ombre violette.
      for (let y = box[1]; y < box[3]; y++) for (let x = box[0]; x < box[2]; x++) {
        const i = y * W + x, k = cls[i], dd = dist(i);
        if (((k === BLUE || k === WHITE) && dd < r + 8) || (k === PURPLE && dd < r + 11)) irisLayer[i] = 1;
      }
      // Écart entre l'iris et l'anneau : le transparent qui touche l'iris.
      const seeds = [];
      for (let a = 0; a < 360; a += 3) {
        for (let rr = r + 4; rr < r + 60; rr += 1) {
          const x = Math.round(cx + Math.cos((a * Math.PI) / 180) * rr), y = Math.round(cy + Math.sin((a * Math.PI) / 180) * rr);
          const i = y * W + x;
          if (!cls[i] && !irisLayer[i]) { seeds.push(i); break; }
          if (cls[i] && !irisLayer[i]) break;
        }
      }
      const gap = flood(seeds, (i) => !cls[i] && dist(i) < r * 2.2);
      // Épaisseur de l'anneau : passages opaques après l'écart, vers le bas et les côtés.
      const runs = [];
      for (const a of [45, 70, 90, 110, 135, 180, 0]) {
        let inGap = false, start = -1;
        for (let rr = r; rr < r * 2.4; rr += 1) {
          const i = Math.round(cy + Math.sin((a * Math.PI) / 180) * rr) * W + Math.round(cx + Math.cos((a * Math.PI) / 180) * rr);
          if (gap[i]) { inGap = true; continue; }
          if (inGap && start < 0 && cls[i]) start = rr;
          if (start >= 0 && !cls[i]) { runs.push(rr - start); break; }
        }
      }
      const thick = Math.round(runs.sort((a, b) => a - b)[runs.length >> 1] || 30) + 2;
      // Anneau : l'opaque à moins de `thick` de l'écart (hors iris).
      const near = dilate(gap, thick, box);
      for (let y = box[1]; y < box[3]; y++) for (let x = box[0]; x < box[2]; x++) { const i = y * W + x; if (near[i] && cls[i] && !irisLayer[i] && !gap[i]) ringLayer[i] = 1; }
      // Intérieur de l'anneau : là où l'iris peut se promener.
      const inside = dilate(gap.map((v, i) => v || irisLayer[i]), 2, box);
      return { cx, cy, r, box, gap, inside, thick };
    });

    // Visière sans iris ni anneaux.
    const visor = new Uint8Array(N);
    for (let i = 0; i < N; i++) visor[i] = cls[i] && !irisLayer[i] && !ringLayer[i] ? cls[i] : 0;

    // Orbite de chaque œil (pour les paupières) : le vide de la visière autour de l'iris, dans la silhouette de la
    // visière (au bord, on regarde les lignes au-dessus : l'orbite s'ouvre entre le bandeau et l'aile).
    const rowMin = new Int32Array(H).fill(W), rowMax = new Int32Array(H).fill(-1);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (cls[y * W + x]) { rowMin[y] = Math.min(rowMin[y], x); rowMax[y] = Math.max(rowMax[y], x); }
    const hullMin = (y) => { let m = W; for (let k = Math.max(vy0, y - 70); k <= y; k++) m = Math.min(m, rowMin[k]); return m; };
    const hullMax = (y) => { let m = -1; for (let k = Math.max(vy0, y - 70); k <= y; k++) m = Math.max(m, rowMax[k]); return m; };
    const hull = Array.from({ length: H }, (_, y) => [hullMin(y), hullMax(y)]);
    const sockets = new Uint8Array(N); // orbites pleines : le halo de la visière n'y entre pas
    const colMax = new Int32Array(W).fill(-1); // bas de la visière, colonne par colonne
    for (let y = vy0; y <= vy1; y++) for (let x = 0; x < W; x++) if (cls[y * W + x]) colMax[x] = y;
    for (const e of eyes) {
      const start = Math.round(e.cy) * W + Math.round(e.cx);
      // Côté extérieur, l'orbite s'ouvre entre le bout du bandeau et la pointe de l'aile : la paupière s'y arrête
      // sur la ligne qui les relie (l'œil fermé garde la forme de la visière, sans débord).
      const left = e.cx < W / 2;
      const edgeX = (y) => (left ? rowMin[y] : rowMax[y]);
      let yb = -1, yw = -1;
      for (let y = vy0 + 1; y <= vy1; y++) {
        const jump = left ? edgeX(y) - edgeX(y - 1) : edgeX(y - 1) - edgeX(y);
        if (yb < 0 && jump > 40) yb = y - 1;
        else if (yb >= 0 && yw < 0 && jump < -40) { yw = y; break; }
      }
      const outer = (y) => {
        if (yb < 0 || yw < 0) return left ? hull[y][0] : hull[y][1];
        if (y <= yb) return left ? hull[y][0] : hull[y][1];
        if (y >= yw) return edgeX(y);
        return edgeX(yb) + ((edgeX(yw) - edgeX(yb)) * (y - yb)) / (yw - yb);
      };
      const hole = flood([start], (i) => {
        const [x, y] = xy(i);
        if (visor[i] || y < vy0 || y > vy1) return false;
        return left ? x >= outer(y) && x <= hull[y][1] : x <= outer(y) && x >= hull[y][0];
      });
      let x0 = W, x1 = 0, y0 = H, y1 = 0;
      const top = new Map(), bottom = new Map();
      for (let i = 0; i < N; i++) {
        if (!hole[i]) continue;
        sockets[i] = 1;
        const [x, y] = xy(i);
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        top.set(x, Math.min(top.get(x) ?? H, y));
        bottom.set(x, Math.max(bottom.get(x) ?? -1, y));
      }
      // Bords lissés (médiane sur ± 45 px) : ce qui dépasse en haut ou en bas, ce sont les pointes.
      const median = (map, x) => { const v = []; for (let k = x - 45; k <= x + 45; k += 3) if (map.has(k)) v.push(map.get(k)); v.sort((a, b) => a - b); return v[v.length >> 1]; };
      const topM = new Map(), botM = new Map();
      for (let x = x0; x <= x1; x++) { topM.set(x, median(top, x)); botM.set(x, median(bottom, x)); }
      // Puis moyennés sur ± 14 px : la médiane avance par paliers, et la paupière qui s'y arrête (au-dessus des pointes)
      // dessinait des marches d'escalier.
      const average = (map) => { const out = new Map(); for (let x = x0; x <= x1; x++) { let s = 0, n = 0; for (let k = x - 14; k <= x + 14; k++) if (map.has(k)) { s += map.get(k); n++; } out.set(x, s / n); } return out; };
      const topS = average(topM), botS = average(botM);
      const spikes = new Uint8Array(N);
      for (let i = 0; i < N; i++) {
        if (!hole[i]) continue;
        const [x, y] = xy(i);
        if (y < topS.get(x) - 4 || y > botS.get(x) + 4) spikes[i] = 1;
      }
      const box = [x0 - LID_EDGE - 2, y0 - LID_EDGE - 2, x1 + LID_EDGE + 3, y1 + LID_EDGE + 3];
      const grown = dilate(hole, LID_EDGE, box);
      const keepOut = dilate(spikes, LID_EDGE, box);
      // Masque de paupière : l'orbite et son bord, sauf les pointes (et leur bord), et rien hors de la visière.
      const mw = box[2] - box[0], mh = box[3] - box[1];
      const mask = canvasOf(mw, mh);
      const mg = mask.getContext('2d');
      const md = mg.createImageData(mw, mh);
      // Liseré de la paupière : seulement sur le creux de l'œil (et 1 px autour, pour l'anticrénelage). Sur le vert de
      // la visière, il dessinait un trait sombre qui dépassait de l'œil vers le nez. Le creux, c'est le vide et l'iris :
      // sur le vert ou le violet des anneaux, le liseré séparait deux zones de même couleur au lieu de les fondre (Tommy).
      const hollowPx = (j) => !cls[j] || (irisLayer[j] && cls[j] !== GREEN);
      const nearHollow = (x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H && hollowPx(yy * W + xx)) return true; } return false; };
      const stripeMask = canvasOf(mw, mh);
      const sg = stripeMask.getContext('2d');
      const sd = sg.createImageData(mw, mh);
      for (let y = box[1]; y < box[3]; y++) for (let x = box[0]; x < box[2]; x++) {
        const i = y * W + x;
        if (x < 0 || y < 0 || x >= W || y >= H || !grown[i] || !(visor[i] || hole[i])) continue;
        // Pointes du bas (les « cils » de l'œil fermé) : jamais recouvertes. Les cornes du haut, si : la paupière du
        // haut glisse par-dessus en descendant ; découpées, elles laissaient une encoche là où le bord les croisait.
        if (keepOut[i] && y > botS.get(x)) continue;
        md.data[((y - box[1]) * mw + x - box[0]) * 4 + 3] = 255;
        if (nearHollow(x, y)) sd.data[((y - box[1]) * mw + x - box[0]) * 4 + 3] = 255;
      }
      mg.putImageData(md, 0, 0);
      sg.putImageData(sd, 0, 0);
      // Paupière du bas (œil rieur) : elle recouvre tout le bas de l'œil jusqu'au bord de la visière, orbite, pointes
      // et aile (les « cils ») comprises — sinon ils restaient noirs à côté de la paupière (Tommy : « elles doivent
      // recouvrir le visage »). Elle est découpée dans le masque (idée de Tommy) : elle ne remplit que le creux de l'œil
      // (orbite, anneau, iris, vide entre les traits), jamais par-dessus la visière — ses traits et liserés violets
      // restent intacts, sans superposition. Zone : la silhouette de la visière de ce côté, rentrée de 3 px.
      const inSil = (x, y) => y >= vy0 && y <= vy1 && x >= 0 && x < W && y <= colMax[x] &&
        (left ? x >= outer(y) && x <= hull[y][1] : x <= outer(y) && x >= hull[y][0]);
      let ox = left ? W : 0;
      for (let y = vy0; y <= vy1; y++) ox = left ? Math.min(ox, outer(y)) : Math.max(ox, outer(y));
      // Côté intérieur, elle s'arrête au bord de l'orbite : le milieu vert de la visière ne bouge pas.
      const lowBox = left ? [Math.max(0, ox - 2), y0 - LID_EDGE - 2, x1 + LID_EDGE + 3, vy1 + 2] : [x0 - LID_EDGE - 2, y0 - LID_EDGE - 2, Math.min(W, ox + 3), vy1 + 2];
      const lw = lowBox[2] - lowBox[0], lh = lowBox[3] - lowBox[1];
      const lowMask = canvasOf(lw, lh);
      const lg = lowMask.getContext('2d');
      const ld = lg.createImageData(lw, lh);
      const lowStripeMask = canvasOf(lw, lh);
      const lsg = lowStripeMask.getContext('2d');
      const lsd = lsg.createImageData(lw, lh);
      for (let y = lowBox[1]; y < lowBox[3]; y++) for (let x = lowBox[0]; x < lowBox[2]; x++) {
        if (!inSil(x - 3, y) || !inSil(x + 3, y) || !inSil(x, y + 3)) continue;
        // Contour extérieur de la visière (violet, à moins de 9 px du bord) : découpé, jamais recouvert. Les traits
        // violets de l'intérieur de l'aile (les « cils ») sont recouverts : laissés, ils flottaient en diagonale dans la
        // paupière verte.
        if (visor[y * W + x] === PURPLE && (!inSil(x - 9, y) || !inSil(x + 9, y) || !inSil(x, y + 9))) continue;
        const k = ((y - lowBox[1]) * lw + x - lowBox[0]) * 4 + 3;
        ld.data[k] = 255;
        if (nearHollow(x, y)) lsd.data[k] = 255;
      }
      lg.putImageData(ld, 0, 0);
      lsg.putImageData(lsd, 0, 0);
      Object.assign(e, {
        hole: { x0, x1, y0, y1 }, top, topMin: y0, topS, botS, lidBox: box, lidMask: mask, stripeMask, lowBox, lowMask, lowStripeMask,
        lowCanvas: canvasOf(lw, lh), lidCanvas: canvasOf(mw, mh), stripeCanvas: canvasOf(mw, mh), lowStripeCanvas: canvasOf(lw, lh),
      });
      const h = (x) => botS.get(x) - topS.get(x);
      const xc = Math.round(clamp(e.cx, x0, x1));
      // Œil fermé : un « U » d'un coin à l'autre, au plus bas au milieu (comme dans la vidéo).
      e.u = { mid: botS.get(xc) - 0.22 * h(xc), left: botS.get(x0) - 0.08 * h(x0), right: botS.get(x1) - 0.08 * h(x1), xc };
    }

    // Calques en couleurs exactes, avec halo.
    const layer = (pick, glows) => {
      const c = canvasOf(W, H);
      const g = c.getContext('2d');
      const img = g.createImageData(W, H);
      for (let i = 0; i < N; i++) {
        const k = pick(i);
        if (!k) continue;
        const p = PALETTE[k - 1];
        img.data.set([p[0], p[1], p[2], alpha[i]], i * 4);
      }
      g.putImageData(img, 0, 0);
      if (!glows) return c;
      const out = canvasOf(W, H);
      const o = out.getContext('2d');
      for (const [color, blur] of glows) { o.shadowColor = color; o.shadowBlur = blur; o.drawImage(c, 0, 0); }
      o.shadowColor = 'transparent';
      o.drawImage(c, 0, 0);
      return out;
    };
    // Halo de la visière vers l'extérieur : ombre de la visière seule, creusée par la visière et par les orbites (qui
    // restent nettes, sans voile). Côté extérieur, l'orbite s'ouvre sur le fond : l'ombre de la silhouette pleine y
    // dessinait un bord droit, et la découpe nette de l'orbite une marche (« shadow box », Tommy). La découpe s'efface
    // donc en approchant de l'ouverture, et le halo s'y fond dans le fond.
    const GLOW_GREEN = [['rgba(128, 0, 255, 0.4)', 60], ['rgba(0, 255, 102, 0.55)', 22]];
    const OPEN_FADE = 70; // distance (px de l'image) sur laquelle l'orbite rejoint le fond
    const visorCanvas = (() => {
      const paint = (value) => {
        const c = canvasOf(W, H);
        const g = c.getContext('2d');
        const d = g.createImageData(W, H);
        for (let i = 0; i < N; i++) { const a = value(i); if (a) d.data.set([0, 255, 102, a], i * 4); }
        g.putImageData(d, 0, 0);
        return c;
      };
      // Distance de chaque pixel d'orbite à l'ouverture (voisin ni visière ni orbite), en largeur d'abord.
      const dist = new Int32Array(N).fill(-1);
      let wave = [];
      for (let i = 0; i < N; i++) {
        if (!sockets[i]) continue;
        const x = i % W;
        for (const j of [i - 1, i + 1, i - W, i + W]) {
          if (j < 0 || j >= N || (Math.abs((j % W) - x) > 1)) continue;
          if (!sockets[j] && !visor[j]) { dist[i] = 0; wave.push(i); break; }
        }
      }
      for (let step = 1; wave.length && step <= OPEN_FADE; step++) {
        const next = [];
        for (const i of wave) {
          const x = i % W;
          for (const j of [i - 1, i + 1, i - W, i + W]) {
            if (j < 0 || j >= N || Math.abs((j % W) - x) > 1 || !sockets[j] || dist[j] >= 0) continue;
            dist[j] = step;
            next.push(j);
          }
        }
        wave = next;
      }
      const shape = paint((i) => (visor[i] ? alpha[i] : 0));
      const cut = paint((i) => (visor[i] ? alpha[i] : sockets[i] ? (dist[i] < 0 ? 255 : Math.round((255 * dist[i]) / OPEN_FADE)) : 0));
      const c = canvasOf(W, H);
      const g = c.getContext('2d');
      for (const [color, blur] of GLOW_GREEN) {
        g.shadowColor = color;
        g.shadowBlur = blur;
        g.shadowOffsetX = W + 200;
        g.drawImage(shape, -(W + 200), 0);
      }
      g.shadowColor = 'transparent';
      g.shadowOffsetX = 0;
      g.globalCompositeOperation = 'destination-out';
      g.drawImage(cut, 0, 0);
      g.globalCompositeOperation = 'source-over';
      g.drawImage(layer((i) => visor[i]), 0, 0);
      return c;
    })();
    const ringCanvas = layer((i) => (ringLayer[i] ? cls[i] : 0), [['rgba(0, 255, 102, 0.45)', 10]]);
    const irisCanvases = eyes.map((e) => {
      const [x0, y0, x1, y1] = e.box;
      const c = canvasOf(x1 - x0, y1 - y0);
      const g = c.getContext('2d');
      g.shadowColor = 'rgba(0, 85, 255, 0.75)';
      g.shadowBlur = 14;
      g.drawImage(layer((i) => (irisLayer[i] && (i % W) >= x0 && (i % W) < x1 ? cls[i] : 0)), -x0, -y0);
      // Masque de l'intérieur de l'anneau.
      const m = canvasOf(x1 - x0, y1 - y0);
      const mg = m.getContext('2d');
      const md = mg.createImageData(m.width, m.height);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (e.inside[y * W + x]) md.data[((y - y0) * m.width + x - x0) * 4 + 3] = 255;
      mg.putImageData(md, 0, 0);
      e.insideMask = m;
      e.work = canvasOf(m.width, m.height);
      return c;
    });

    // Cri : place du triangle dans l'exemple de composition (ce qui y est opaque et pas dans la visière).
    let tx0 = W, tx1 = 0, ty0 = H, ty1 = 0;
    const cd = composition.data;
    for (let y = vy1 - 60; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (cd[i * 4 + 3] > 128 && !cls[i] && Math.max(cd[i * 4], cd[i * 4 + 1], cd[i * 4 + 2]) > 60) { tx0 = Math.min(tx0, x); tx1 = Math.max(tx1, x); ty0 = Math.min(ty0, y); ty1 = Math.max(ty1, y); }
    }
    let bx0 = mouthTri.width, bx1 = 0, by0 = mouthTri.height, by1 = 0;
    for (let y = 0; y < mouthTri.height; y++) for (let x = 0; x < mouthTri.width; x++) if (mouthTri.data[(y * mouthTri.width + x) * 4 + 3] > 128) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
    const triScale = (tx1 - tx0) / (bx1 - bx0);
    const tri = { x: tx0 - bx0 * triScale, y: ty0 - by0 * triScale, scale: triScale, box: [tx0, ty0, tx1, ty1] };

    // Passage du repère des visages plats (420 × 420, visière 97–290, centre 210) à celui-ci.
    let mid = 0, cnt = 0;
    for (let x = 0; x < W; x++) if (cls[Math.round((vy0 + vy1) / 2) * W + x] === GREEN) { mid += x; cnt++; }
    const k = (vy1 - vy0) / 193;
    const flat = { k, x: (x) => mid / cnt + (x - 210) * k, y: (y) => vy0 + (y - 97) * k };
    return { W, H, vy0, vy1, vx0, vx1, eyes, visorCanvas, ringCanvas, irisCanvases, tri, flat };
  }

  window.createCapriSpriteFace = function createCapriSpriteFace(canvas, helpers) {
    const { drawMouthShape, MOUTH, HEAD, background } = helpers;
    const mainCtx = canvas.getContext('2d');
    let ctx = mainCtx; // le visage se dessine à part (turnCanvas) puis revient tourné en perspective
    const turnCanvas = document.createElement('canvas');
    const turnCtx = turnCanvas.getContext('2d');
    const pitchCanvas = document.createElement('canvas'); // étape intermédiaire : haut / bas fait, gauche / droite à faire
    const pitchCtx = pitchCanvas.getContext('2d');
    const face = { ready: false, draw() {} };
    const base = 'visage/';

    // Yeux animés par Motion (motion.dev, motion.js) : ressorts vers la pose visée pour les paupières, le sourcil,
    // le regard et la taille de l'iris (une nouvelle cible reprend la vitesse en cours, sans à-coup), images clés
    // pour le clignement (fermeture vive, tenue, réouverture plus lente). Sans Motion : valeurs de capri.js.
    const Mo = window.Motion;
    const LID = { type: 'spring', stiffness: 260, damping: 27 };
    const BROW = { type: 'spring', stiffness: 220, damping: 32 }; // assez amorti : un rebond fermait l'œil dans la colère
    const LOOK = { type: 'spring', stiffness: 650, damping: 40 };
    const IRIS = { type: 'spring', stiffness: 260, damping: 16 };
    const anim = { eyes: [{ open: 1, smile: 0 }, { open: 1, smile: 0 }], brow: { v: 0 }, look: { x: 0, y: 0, iris: 1 }, blink: { v: 0 }, blinkStart: -1 };
    const goals = new Map();
    const toward = (obj, key, value, options) => {
      let g = goals.get(obj);
      if (!g) goals.set(obj, (g = {}));
      if (g[key] !== undefined && Math.abs(g[key] - value) < 0.002) return;
      g[key] = value;
      Mo.animate(obj, { [key]: value }, options);
    };
    // Glitchs façon Blackwall (Cyberpunk 2077) par moments, plus souvent quand elle parle : corruption numérique, pas
    // d'éclairs. À chaque image du glitch (recomposée toutes les 35 à 80 ms) : séparation de l'image en couches rouge
    // et verte décalées, bandes déchirées, blocs corrompus (morceaux de l'image recopiés ailleurs, aplats), traits qui
    // balaient l'écran, fragments de texte système, et parfois l'image entière qui décroche. Uniquement le rouge des
    // cheveux de Capri (#F80030) et le vert de sa visière (#00FF66), sur noir.
    const BW_RED = 'rgb(248, 0, 48)', BW_GREEN = 'rgb(0, 255, 102)';
    const BW_TEXT = ['BLACKWALL', 'ACCÈS REFUSÉ', 'BRÈCHE RÉSEAU', 'ERR::0xDEAD', 'IA NON AUTORISÉE', '0x7F3A·FF00', '//NETWATCH', '▓▒░▒▓'];
    const zap = { until: 0, mood: 0, redraw: 0, frame: null, layers: null };
    const rnd = (a, b) => a + Math.random() * (b - a);
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    // Couche d'une seule couleur : l'image teinte (rouge ou vert), fond retiré (par différence avec sa couleur) pour
    // que seules les formes s'ajoutent, sans éclaircir l'écran.
    function tinted(w, h, color) {
      if (!zap.layers || zap.layers.w !== w || zap.layers.h !== h) zap.layers = { w, h, red: canvasOf(w, h), green: canvasOf(w, h) };
      const c = zap.layers[color === BW_RED ? 'red' : 'green'];
      const g = c.getContext('2d');
      g.globalCompositeOperation = 'copy';
      g.drawImage(canvas, 0, 0);
      g.globalCompositeOperation = 'difference';
      g.fillStyle = css(background);
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = color;
      g.fillRect(0, 0, w, h);
      return c;
    }
    const corruption = (w, h) => {
      const cell = Math.max(8, Math.round(h / 22));
      return {
        split: rnd(0.006, 0.02) * w * (Math.random() < 0.5 ? -1 : 1),
        tears: Array.from({ length: 5 + Math.floor(Math.random() * 8) }, () => ({ y: rnd(0, h), h: rnd(2, h * 0.06), dx: rnd(-0.09, 0.09) * w, tint: Math.random() < 0.4 ? pick([BW_RED, BW_GREEN]) : null })),
        blocks: Array.from({ length: 6 + Math.floor(Math.random() * 14) }, () => {
          const bw = cell * (1 + Math.floor(Math.random() * 6)), bh = cell * (1 + Math.floor(Math.random() * 2));
          const x = Math.floor(rnd(0, w) / cell) * cell, y = Math.floor(rnd(0, h) / cell) * cell;
          const kind = Math.random();
          return { x, y, w: bw, h: bh, sx: Math.floor(rnd(0, w - bw)), sy: Math.floor(rnd(0, h - bh)), fill: kind < 0.45 ? null : kind < 0.75 ? BW_RED : kind < 0.9 ? BW_GREEN : 'rgb(0, 0, 0)', alpha: rnd(0.55, 0.95) };
        }),
        lines: Array.from({ length: 2 + Math.floor(Math.random() * 4) }, () => ({ y: rnd(0, h), h: rnd(1, 3) * (h / 600), color: pick([BW_RED, BW_RED, BW_GREEN]) })),
        texts: Array.from({ length: Math.floor(Math.random() * 3) }, () => ({ text: pick(BW_TEXT), x: rnd(0.02, 0.7) * w, y: rnd(0.08, 0.95) * h, color: pick([BW_RED, BW_RED, BW_GREEN]) })),
        roll: Math.random() < 0.12 ? rnd(-0.12, 0.12) * h : 0,
      };
    };
    function drawZap(state, w, h) {
      const now = performance.now();
      // Sur une humeur [glitch] (balise ou démarrage), une fois ; et au hasard, comme la « version 5 » restaurée par
      // Tommy en plus des glitchs actuels : toutes les 20 à 45 s au repos, 3 à 7 s quand elle parle.
      if (state.mood === 'glitch' && now < state.moodUntil && zap.mood !== state.moodStart) {
        zap.mood = state.moodStart;
        zap.until = now + 200;
        zap.redraw = 0;
      }
      if (!zap.next) zap.next = now + 20000 + Math.random() * 25000;
      if (now > zap.next) {
        zap.until = now + 250 + Math.random() * 250;
        zap.redraw = 0;
        zap.next = now + (state.mode === 'speaking' ? 3000 + Math.random() * 4000 : 20000 + Math.random() * 25000);
      }
      if (now > zap.until) return;
      if (now > zap.redraw) {
        zap.frame = corruption(w, h);
        zap.redraw = now + 35 + Math.random() * 45;
      }
      const f = zap.frame;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.save();
      // Décrochage de l'image entière.
      if (f.roll) { ctx.drawImage(canvas, 0, f.roll); ctx.drawImage(canvas, 0, f.roll - Math.sign(f.roll) * h); }
      // Couches rouge et verte décalées de part et d'autre.
      const red = tinted(w, h, BW_RED), green = tinted(w, h, BW_GREEN);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55;
      ctx.drawImage(red, f.split, 0);
      ctx.drawImage(green, -f.split, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      // Bandes déchirées.
      for (const t of f.tears) {
        ctx.drawImage(canvas, 0, t.y, w, t.h, t.dx, t.y, w, t.h);
        if (t.tint) { ctx.globalAlpha = 0.35; ctx.fillStyle = t.tint; ctx.fillRect(0, t.y, w, t.h); ctx.globalAlpha = 1; }
      }
      // Blocs corrompus.
      for (const b of f.blocks) {
        ctx.globalAlpha = b.alpha;
        if (b.fill) { ctx.fillStyle = b.fill; ctx.fillRect(b.x, b.y, b.w, b.h); }
        else ctx.drawImage(canvas, b.sx, b.sy, b.w, b.h, b.x, b.y, b.w, b.h);
      }
      ctx.globalAlpha = 1;
      // Traits qui balaient l'écran.
      for (const l of f.lines) { ctx.fillStyle = l.color; ctx.fillRect(0, l.y, w, l.h); }
      // Fragments de texte système.
      ctx.font = `700 ${Math.round(h / 26)}px 'Cascadia Mono', Consolas, monospace`;
      ctx.textBaseline = 'top';
      for (const t of f.texts) {
        ctx.shadowColor = t.color;
        ctx.shadowBlur = h / 60;
        ctx.fillStyle = t.color;
        ctx.fillText(t.text, t.x, t.y);
      }
      ctx.restore();
    }

    // Signes qui sortent de CAPRI (capri.js, spawn) ; positions dans l'image HD, ramenées au visage plat.
    const VIOLET = `rgb(${PALETTE[PURPLE - 1]})`;
    const SIGN = {
      note: { text: ['♪', '♫'], fill: '#00ff66', glow: '#00ff66' },
      z: { text: ['z', 'Z'], fill: '#cfe0ff', glow: '#0055ff' },
      idee: { text: ['!'], fill: '#ffffff', glow: '#00ff66' },
      question: { text: ['?'], fill: '#ffffff', glow: '#00ff66' },
      etoile: { text: ['✦', '✧'], fill: '#ffffff', glow: '#00ff66' },
    };
    function drawSign(ctx, p, F) {
      const life = Math.min(1, p.life / p.max);
      const a = Math.sin(life * Math.PI);
      ctx.save();
      ctx.translate(F.x(210 + (p.x - HEAD.x) * 0.4), F.y(200 + (p.y - HEAD.y) * 0.4));
      const k = p.s * 0.8 * F.k;
      ctx.scale(k, k);
      ctx.globalAlpha = Math.min(1, a * 1.6);
      const kind = p.kind;
      if (SIGN[kind]) {
        const sign = SIGN[kind];
        if (kind === 'z') ctx.scale(0.7 + life * 0.8, 0.7 + life * 0.8);
        if (kind === 'idee' || kind === 'question') ctx.scale(1 + Math.max(0, 0.4 - life) * 1.5, 1 + Math.max(0, 0.4 - life) * 1.5);
        ctx.rotate(Math.sin(p.life * 0.12) * 0.25);
        ctx.font = '700 32px Bahnschrift, "Segoe UI Symbol", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const text = sign.text[Math.floor(p.x) % sign.text.length];
        // Contour violet, comme le visage (Tommy), puis la couleur du signe par-dessus.
        ctx.lineJoin = 'round';
        ctx.lineWidth = 6;
        ctx.strokeStyle = VIOLET;
        ctx.shadowColor = VIOLET;
        ctx.shadowBlur = 8;
        ctx.strokeText(text, 0, 0);
        ctx.fillStyle = sign.fill;
        ctx.shadowColor = sign.glow;
        ctx.shadowBlur = 12;
        ctx.fillText(text, 0, 0);
      } else if (kind === 'veine') {
        // Veine de colère façon manga : quatre crochets qui battent, rouge des cheveux.
        const beat = 1 + Math.abs(Math.sin(p.life * 0.35)) * 0.25;
        ctx.scale(beat, beat);
        ctx.lineCap = 'round';
        // Deux passes : trait violet large (contour), puis le rouge au centre.
        for (const [color, width] of [[VIOLET, 6], ['#f80030', 3]]) {
          ctx.strokeStyle = color;
          ctx.shadowColor = color;
          ctx.shadowBlur = color === VIOLET ? 8 : 12;
          ctx.lineWidth = width;
          for (let i = 0; i < 4; i++) {
            ctx.save();
            ctx.rotate((i * Math.PI) / 2);
            ctx.beginPath();
            ctx.moveTo(3, -10);
            ctx.quadraticCurveTo(3, -3, 10, -3);
            ctx.stroke();
            ctx.restore();
          }
        }
      } else if (kind === 'goutte') {
        // Goutte de gêne ou de peur, bleu de la palette.
        ctx.beginPath();
        ctx.moveTo(0, -10);
        ctx.bezierCurveTo(6, -2, 8, 4, 0, 8);
        ctx.bezierCurveTo(-8, 4, -6, -2, 0, -10);
        ctx.strokeStyle = VIOLET;
        ctx.shadowColor = VIOLET;
        ctx.shadowBlur = 8;
        ctx.lineWidth = 5;
        ctx.stroke();
        ctx.fillStyle = 'rgba(120, 170, 255, 0.95)';
        ctx.strokeStyle = '#ffffff';
        ctx.shadowColor = '#0055ff';
        ctx.shadowBlur = 10;
        ctx.lineWidth = 1.5;
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    // Fond animé derrière elle (Tommy : « qu'elle fasse moins vide », puis « style Cyberpunk 2077, le Blackwall, avec
    // des animations de piratage comme dans le jeu ») : un Breach Protocol qui se joue tout seul. Matrice de codes
    // hexadécimaux, ligne et colonne choisies en alternance, curseur qui prend un code et le pose dans le tampon, compte
    // à rebours et séquences à téléverser. Quand le tampon est plein ou le temps écoulé : « UPLOAD COMPLETE », puis une
    // nouvelle matrice qui se brouille avant de se fixer. De temps en temps (et à chaque glitch), le Blackwall passe :
    // un front rouge qui corrompt les codes. Plus vif quand elle réfléchit, discret derrière la visière.
    const LIME = '208, 237, 87', RED = '248, 0, 48';
    const HEX = ['1C', '55', '7A', 'BD', 'E9', 'FF'];
    const WALL_GLYPHS = ['▓', '▒', '░', '#', '%', '&', '0', '1', '//', '<>'];
    const anyOf = (list) => list[Math.floor(Math.random() * list.length)];
    const breach = { t: 0, last: 0, speed: 1, glow: 0, cols: 0, rows: 0, cells: [], line: 0, axis: 'row', cursor: null, at: { x: 0, y: 0 },
      nextAt: 0, buffer: [], seqs: [], timer: 1, done: 0, scramble: 0, wall: 0, wallX: 0, wallAt: 6 };
    function newBreach(cols, rows) {
      Object.assign(breach, { cols, rows, cells: Array.from({ length: cols * rows }, () => ({ v: anyOf(HEX), used: false })),
        line: 0, axis: 'row', cursor: null, buffer: [], timer: 1, done: 0, scramble: 1, nextAt: breach.t + 0.5 });
      breach.seqs = [['ICEPICK', 2], ['DATAMINE_V2', 3], ['BLACKWALL_BYPASS', 4]].map(([name, n]) => ({ name, codes: Array.from({ length: n }, () => anyOf(HEX)) }));
    }
    function stepBreach() {
      // Prochain code : sur la ligne (ou la colonne) en cours, une case pas encore prise.
      const { cols, rows, cells } = breach;
      const free = [];
      if (breach.axis === 'row') { for (let c = 0; c < cols; c++) if (!cells[breach.line * cols + c].used) free.push([breach.line, c]); }
      else for (let r = 0; r < rows; r++) if (!cells[r * cols + breach.line].used) free.push([r, breach.line]);
      if (!free.length || breach.buffer.length >= 8) { breach.done = 1; return; }
      const [r, c] = anyOf(free);
      const cell = cells[r * cols + c];
      cell.used = true;
      breach.cursor = { r, c, at: breach.t };
      breach.buffer.push(cell.v);
      // On alterne : la colonne de la case prise, puis sa ligne, etc.
      breach.axis = breach.axis === 'row' ? 'col' : 'row';
      breach.line = breach.axis === 'row' ? r : c;
    }
    function drawBackdrop(ctx, w, h, state) {
      const now = performance.now();
      const dt = Math.min(0.1, (now - (breach.last || now)) / 1000);
      breach.last = now;
      const thinking = state.mode === 'thinking', speaking = state.mode === 'speaking';
      breach.speed += ((thinking ? 2.2 : speaking ? 1.4 : 1) - breach.speed) * 0.08;
      breach.glow += ((speaking ? 1 : thinking ? 0.7 : 0.3) - breach.glow) * 0.05;
      const t = (breach.t += dt * breach.speed);
      const cell = Math.round(h / 11.5);
      const cols = Math.ceil(w / cell) + 1, rows = Math.ceil(h / cell) + 1;
      if (cols !== breach.cols || rows !== breach.rows) newBreach(cols, rows);
      const ox = (w - cols * cell) / 2, oy = (h - rows * cell) / 2;
      // Partie qui avance (vite, Tommy) : un code toutes les 0,28 s (plus vite quand elle réfléchit), chrono qui descend.
      if (breach.done > 0) {
        breach.done += dt;
        if (breach.done > 1.1) newBreach(cols, rows);
      } else {
        breach.timer -= (dt * breach.speed) / 12;
        if (breach.timer <= 0) { breach.timer = 0; breach.done = 1; }
        if (t > breach.nextAt) { stepBreach(); breach.nextAt = t + 0.28; }
      }
      breach.scramble = Math.max(0, breach.scramble - dt * 2.5);
      // Scintillement continu : quelques codes changent et s'allument à chaque image.
      for (let i = 0; i < 3 * breach.speed; i++) {
        const k = breach.cells[Math.floor(Math.random() * breach.cells.length)];
        if (!k.used) { k.v = anyOf(HEX); k.flash = 1; }
      }
      // Blackwall : toutes les 8 à 16 s, et à chaque glitch.
      if (state.glitch > 0.3 && breach.wall < 0.5) { breach.wall = 1; breach.wallX = Math.random(); }
      if (t > breach.wallAt) { breach.wall = 1; breach.wallX = -0.2; breach.wallAt = t + 8 + Math.random() * 8; }
      breach.wall = Math.max(0, breach.wall - dt * 0.9);
      breach.wallX += dt * 1.1;
      ctx.save();
      // Halo derrière la visière.
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.6);
      const halo = ctx.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h * 0.45, Math.max(w, h) * 0.6);
      halo.addColorStop(0, `rgba(128, 0, 255, ${0.12 + 0.08 * breach.glow + 0.05 * pulse})`);
      halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.fill();
      // Ligne ou colonne en cours : bande éclairée.
      const lineA = breach.done ? 0 : 0.06;
      ctx.fillStyle = `rgba(${LIME}, ${lineA})`;
      ctx.beginPath();
      if (breach.axis === 'row') ctx.rect(0, oy + breach.line * cell, w, cell); else ctx.rect(ox + breach.line * cell, 0, cell, h);
      ctx.fill();
      // Codes.
      ctx.font = `600 ${Math.round(cell * 0.36)}px Consolas, "Cascadia Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const wallPos = breach.wallX * (w + h * 0.4) - h * 0.2;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const k = breach.cells[r * cols + c];
        const x = ox + c * cell + cell / 2, y = oy + r * cell + cell / 2;
        // Plus discret au centre (derrière son visage), plus net vers les bords.
        // (ellipse de la visière : presque rien, pour ne pas voir de codes au fond de ses yeux).
        const ex = (x - w / 2) / (w * 0.42), ey = (y - h * 0.5) / (h * 0.3);
        const edge = 0.12 + 0.88 * clamp((Math.hypot(ex, ey) - 0.85) / 0.45);
        const onLine = !breach.done && (breach.axis === 'row' ? r === breach.line : c === breach.line);
        k.flash = Math.max(0, (k.flash || 0) - dt * 3);
        let text = k.used ? '[ ]' : k.v, color = LIME, a = (k.used ? 0.1 : onLine ? 0.55 : 0.2 + 0.5 * k.flash) * edge;
        if (breach.scramble > 0 && Math.random() < breach.scramble) text = anyOf(HEX);
        // Front du Blackwall : codes rouges corrompus.
        const d = Math.abs(x + y * 0.4 - wallPos) / (h * 0.25);
        if (breach.wall > 0 && d < 1 && Math.random() < breach.wall * (1 - d) + 0.15) {
          color = RED;
          text = anyOf(WALL_GLYPHS);
          a = Math.min(0.85, (0.3 + 0.5 * (1 - d)) * breach.wall + 0.1);
        }
        if (breach.done) a *= 0.5 + 0.5 * Math.abs(Math.sin(breach.done * 6)); // clignote à la fin de la partie
        ctx.fillStyle = `rgba(${color}, ${a})`;
        ctx.fillText(text, x, y);
      }
      // Curseur : case prise, cadre qui se resserre.
      if (breach.cursor) {
        const age = t - breach.cursor.at;
        const grow = Math.max(0, 1 - age * 8) * cell * 0.25;
        const x = ox + breach.cursor.c * cell, y = oy + breach.cursor.r * cell;
        ctx.strokeStyle = `rgba(${LIME}, ${Math.max(0.35, 0.95 - age * 2)})`;
        ctx.lineWidth = Math.max(1, h / 400);
        ctx.strokeRect(x + 4 - grow, y + 4 - grow, cell - 8 + grow * 2, cell - 8 + grow * 2);
      }
      drawTrails(ctx, w, h, t, state);
      // Panneaux du HUD, dans les coins du bas et en haut à gauche (le haut à droite reste aux signes).
      // Tailles en multiples de la police. Séquence et tampon toujours sur la même ligne (Tommy) : sur un écran étroit
      // (portrait), tout rapetisse pour tenir côte à côte.
      const pad = Math.round(Math.min(h, w) * 0.03);
      const fs = Math.max(6, Math.round(Math.min(h * 0.022, w * 0.026, (w - pad * 3) / 40.5)));
      const seqW = fs * 20, seqH = fs * 8.4, bufSize = fs * 2, bufGap = fs * 0.5;
      const bufW = 8 * (bufSize + bufGap) + bufGap, bufH = bufSize + fs * 2.6;
      const stacked = false;
      const seqY = h - pad - seqH;
      const panel = (x, y, pw, ph, title, color = LIME) => {
        ctx.fillStyle = 'rgba(8, 14, 18, 0.72)';
        ctx.beginPath(); ctx.rect(x, y, pw, ph); ctx.fill();
        ctx.strokeStyle = `rgba(${color}, 0.55)`;
        ctx.lineWidth = Math.max(1, h / 500);
        ctx.strokeRect(x, y, pw, ph);
        ctx.fillStyle = `rgba(${color}, 0.9)`;
        ctx.beginPath(); ctx.rect(x, y, pw, fs * 1.6); ctx.fill();
        ctx.fillStyle = '#0b1014';
        ctx.font = `700 ${fs}px Bahnschrift, Consolas, sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillText(title, x + fs * 0.6, y + fs * 0.85);
      };
      ctx.textBaseline = 'middle';
      // Chrono.
      {
        const pw = fs * 15, ph = fs * 4.2, x = pad, y = pad;
        panel(x, y, pw, ph, 'BREACH TIME REMAINING');
        ctx.font = `700 ${Math.round(fs * 1.5)}px Consolas, monospace`;
        ctx.fillStyle = `rgba(${LIME}, 0.95)`;
        ctx.textAlign = 'right';
        ctx.fillText((breach.timer * 12).toFixed(2), x + pw - fs * 0.6, y + fs * 2.75);
        ctx.fillStyle = `rgba(${LIME}, 0.25)`;
        ctx.beginPath(); ctx.rect(x + fs * 0.6, y + fs * 3.4, pw * 0.6, fs * 0.35); ctx.fill();
        ctx.fillStyle = `rgba(${breach.timer < 0.25 ? RED : LIME}, 0.9)`;
        ctx.beginPath(); ctx.rect(x + fs * 0.6, y + fs * 3.4, pw * 0.6 * breach.timer, fs * 0.35); ctx.fill();
      }
      // Séquences à téléverser.
      {
        const pw = seqW, ph = seqH, x = pad, y = seqY;
        panel(x, y, pw, ph, 'SEQUENCE REQUIRED TO UPLOAD');
        breach.seqs.forEach((s, i) => {
          const ok = breach.buffer.length >= s.codes.length * (i + 1) - i; // réussie au fil du tampon
          const ry = y + fs * (3 + i * 1.9);
          ctx.font = `600 ${fs}px Consolas, monospace`;
          ctx.textAlign = 'left';
          s.codes.forEach((code, j) => {
            ctx.fillStyle = `rgba(${LIME}, ${ok ? 0.95 : 0.55})`;
            ctx.fillText(code, x + fs * 0.8 + j * fs * 2.2, ry);
          });
          ctx.fillStyle = `rgba(${ok ? LIME : '160, 170, 180'}, ${ok ? 0.95 : 0.6})`;
          ctx.fillText((ok ? '✔ ' : '  ') + s.name, x + fs * 10, ry);
        });
      }
      // Tampon.
      {
        const slots = 8, size = fs * 2, gap = fs * 0.5;
        const pw = bufW, ph = bufH, x = w - pad - pw, y = h - pad - ph;
        panel(x, y, pw, ph, breach.done ? (breach.timer > 0 ? 'UPLOAD COMPLETE' : 'BREACH FAILED') : 'BUFFER', breach.done && breach.timer <= 0 ? RED : LIME);
        for (let i = 0; i < slots; i++) {
          const sx = x + gap + i * (size + gap), sy = y + fs * 2;
          ctx.strokeStyle = `rgba(${LIME}, 0.45)`;
          ctx.setLineDash([3, 3]);
          ctx.strokeRect(sx, sy, size, size);
          ctx.setLineDash([]);
          const code = breach.buffer[i];
          if (code) {
            ctx.fillStyle = `rgba(${LIME}, 0.95)`;
            ctx.font = `700 ${fs}px Consolas, monospace`;
            ctx.textAlign = 'center';
            ctx.fillText(code, sx + size / 2, sy + size / 2);
          }
        }
      }
      // Alerte du Blackwall : lignes déchirées rouges et message.
      if (breach.wall > 0.05) {
        for (let i = 0; i < 3; i++) {
          const y = (Math.sin(t * 7 + i * 2.1) * 0.5 + 0.5) * h;
          ctx.fillStyle = `rgba(${RED}, ${0.25 * breach.wall})`;
          ctx.beginPath(); ctx.rect(0, y, w, Math.max(1, h / 300)); ctx.fill();
        }
        ctx.font = `700 ${fs}px Bahnschrift, Consolas, sans-serif`;
        ctx.textAlign = 'right';
        ctx.fillStyle = `rgba(${RED}, ${0.9 * breach.wall * (Math.sin(t * 20) > -0.3 ? 1 : 0.3)})`;
        ctx.fillText('⚠ BLACKWALL — INTRUSION DÉTECTÉE', w - pad, (stacked ? seqY : h - pad - bufH) - fs * 0.9);
      }
      ctx.restore();
    }

    // Traînées du Blackwall (Tommy, d'après deux images : pluie de traits rouges, silhouette qui « coule »). Elles
    // appartiennent au fond, pas à CAPRI (Tommy) : des rafales de traits rouges verticaux, à un endroit et un moment
    // tirés au hasard, qui tombent en s'allongeant puis s'éteignent, avec des blocs de pixels qui s'en détachent. Plus
    // fournies pendant une intrusion du Blackwall ou un glitch.
    const rain = { list: [], next: 2 };
    function drawTrails(ctx, w, h, t, state) {
      const storm = (breach.wall || 0) + (state.glitch || 0);
      if (t > rain.next || (storm > 0.5 && rain.list.length < 40)) {
        const cx = Math.random(), spread = 0.08 + Math.random() * 0.45;
        const n = Math.round(6 + Math.random() * 26 + storm * 20);
        for (let i = 0; i < n; i++) {
          rain.list.push({ x: cx + (Math.random() - 0.5) * spread, y: -0.3 + Math.random() * 0.7, len: 0.12 + Math.random() * 0.6,
            v: 0.15 + Math.random() * 0.7, born: t + Math.random() * 0.6, life: 0.8 + Math.random() * 2.4,
            w: Math.random() < 0.2 ? 0.004 + Math.random() * 0.006 : 0.001 + Math.random() * 0.0025, hot: Math.random() < 0.25, blocks: Math.random() < 0.35 });
        }
        rain.next = t + 1.2 + Math.random() * 5;
      }
      rain.list = rain.list.filter((k) => t - k.born < k.life);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const k of rain.list) {
        const age = (t - k.born) / k.life;
        if (age < 0) continue;
        const a = Math.min(1, 0.6 * Math.sin(age * Math.PI) * (1 + storm * 0.6));
        const x = k.x * w, head = (k.y + (t - k.born) * k.v) * h, tail = head - k.len * h * (0.4 + 0.6 * Math.min(1, age * 2));
        const g = ctx.createLinearGradient(0, tail, 0, head);
        g.addColorStop(0, 'rgba(248, 0, 48, 0)');
        g.addColorStop(0.7, `rgba(248, 0, 48, ${a * 0.6})`);
        g.addColorStop(1, k.hot ? `rgba(255, 90, 110, ${a})` : `rgba(248, 0, 48, ${a})`);
        ctx.fillStyle = g;
        const kw = Math.max(1, k.w * w);
        ctx.fillRect(x - kw / 2, tail, kw, head - tail);
        if (k.blocks) {
          ctx.fillStyle = `rgba(248, 0, 48, ${a * 0.7})`;
          for (let i = 0; i < 3; i++) {
            const by = tail + ((i * 0.37 + k.born) % 1) * (head - tail);
            const bw = kw * (2 + ((i * 7 + Math.floor(t * 6)) % 4));
            ctx.fillRect(x - bw / 2, by, bw, h * 0.012);
          }
        }
      }
      ctx.restore();
    }

    // Trois points qui sautent l'un après l'autre pendant qu'elle réfléchit à sa réponse (Tommy), au-dessus de sa
    // tête à droite, vert à contour violet comme les autres signes ; fondu à l'entrée et à la sortie.
    const dots = { a: 0 };
    function drawDots(ctx, F, on) {
      dots.a += ((on ? 1 : 0) - dots.a) * 0.15;
      if (dots.a < 0.02) return;
      const t = performance.now() / 1000;
      const k = 1.5 * F.k;
      ctx.save();
      ctx.translate(F.x(window.CapriMusic ? 252 : 372), F.y(48)); // à gauche du panneau musique quand il est là
      ctx.scale(k, k);
      ctx.globalAlpha = dots.a;
      for (let i = 0; i < 3; i++) {
        const phase = (t * 2.2 - i * 0.22) % 1; // un saut par point et par cycle, en vague
        const up = phase < 0.4 ? Math.sin((phase / 0.4) * Math.PI) : 0;
        ctx.beginPath();
        ctx.arc(i * 13, -up * 8, 4 + up * 1.2, 0, Math.PI * 2);
        ctx.lineWidth = 4;
        ctx.strokeStyle = VIOLET;
        ctx.shadowColor = VIOLET;
        ctx.shadowBlur = 8;
        ctx.stroke();
        ctx.fillStyle = '#00ff66';
        ctx.shadowColor = '#00ff66';
        ctx.shadowBlur = 10 + up * 8;
        ctx.fill();
      }
      ctx.restore();
    }

    // Terminal de piratage (activité « piratage » de capri.js, Tommy) : au-dessus de sa tête à droite, là où sont les
    // trois points ; le « breach protocol » de Cyberpunk 2077 : en-tête jaune, codes hexadécimaux qui défilent, colonne
    // sélectionnée, barre d'envoi, puis ACCESS GRANTED. Fondu à l'entrée et à la sortie, petits sursauts de glitch.
    const hack = { a: 0, start: 0, on: false };
    const HACK_CODES = ['1C', '55', '7A', 'BD', 'E9', 'FF'];
    function drawHack(ctx, F, on) {
      const now = performance.now();
      if (on && !hack.on) hack.start = now;
      hack.on = on;
      hack.a += ((on ? 1 : 0) - hack.a) * 0.12;
      if (hack.a < 0.02) return;
      const t = (now - hack.start) / 1000;
      const p = Math.min(1, t / 6.2);
      const W = 190, H = 104, YEL = '#d0ed57', CY = '#5ef2f2';
      ctx.save();
      ctx.translate(F.x(window.CapriMusic ? 200 : 330) + (Math.random() < 0.04 ? (Math.random() - 0.5) * 8 : 0), F.y(-15));
      ctx.scale(F.k * 1.15, F.k * 1.15);
      ctx.globalAlpha = hack.a;
      // L'ouverture se déploie de gauche à droite.
      ctx.beginPath();
      ctx.rect(-4, -4, (W + 8) * Math.min(1, hack.a * 1.3), H + 8);
      ctx.clip();
      ctx.fillStyle = 'rgba(8, 12, 18, 0.88)';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = YEL; ctx.lineWidth = 1.5; ctx.shadowColor = YEL; ctx.shadowBlur = 8;
      ctx.strokeRect(0.75, 0.75, W - 1.5, H - 1.5);
      ctx.fillStyle = YEL; ctx.fillRect(0, 0, W, 15);
      ctx.shadowBlur = 0;
      ctx.font = '700 9px Bahnschrift, Consolas, sans-serif'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#0b0f14'; ctx.fillText('BREACH PROTOCOL', 6, 8);
      ctx.textAlign = 'right'; ctx.fillText(p < 1 ? (9.9 - p * 9.9).toFixed(2) : '0.00', W - 6, 8); ctx.textAlign = 'left';
      // Matrice de codes : elle défile, la colonne visée s'allume.
      ctx.font = '700 11px Consolas, monospace';
      const col = Math.floor(t * 2.4) % 6, tick = Math.floor(t * 7);
      for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) {
        const code = HACK_CODES[(r * 7 + c * 3 + tick * (r % 2 ? 1 : 5)) % 6];
        const lit = c === col;
        ctx.fillStyle = lit ? CY : 'rgba(208, 237, 87, 0.75)';
        ctx.shadowColor = lit ? CY : 'transparent'; ctx.shadowBlur = lit ? 6 : 0;
        ctx.fillText(code, 8 + c * 30, 27 + r * 14);
        if (lit && r === 0) { ctx.strokeStyle = CY; ctx.lineWidth = 1; ctx.strokeRect(4 + c * 30, 20, 25, 58); }
      }
      ctx.shadowBlur = 0;
      // Barre d'envoi.
      ctx.strokeStyle = 'rgba(208, 237, 87, 0.6)'; ctx.strokeRect(8, 86, W - 16, 10);
      ctx.fillStyle = p < 1 ? YEL : '#00ff66'; ctx.fillRect(10, 88, (W - 20) * p, 6);
      ctx.font = '700 9px Bahnschrift, Consolas, sans-serif';
      ctx.fillStyle = p < 1 ? YEL : '#00ff66';
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = p < 1 ? 0 : 10;
      ctx.textAlign = 'right';
      ctx.fillText(p < 1 ? `UPLOAD ${Math.floor(p * 100)}%` : 'ACCESS GRANTED', W - 8, 79);
      ctx.restore();
    }

    // Corps animé par Motion (Tommy : « débordante d'énergie », « anime-la avec Motion ») : trois couches additionnées
    // au mouvement des humeurs (fx de capri.js) :
    // - vie : rebond continu en boucle, dont le tempo et l'amplitude suivent son énergie (surexcitée → endormie) ;
    // - pop : écrasement / étirement à ressort à chaque changement d'humeur ou d'étape d'activité ;
    // - saut : petit bond à chaque syllabe quand elle parle.
    const life = { y: 0, rot: 0, s: 1 };
    const pop = { x: 0, y: 0, rot: 0, sx: 1, sy: 1 };
    const hop = { y: 0 };
    const body = { tempo: null, loops: [], moodKey: null, talkAt: 0 };
    const ENERGY = { // tempo du rebond (s), amplitude (unités du visage plat), balancement (degrés)
      excitee: [0.32, 10, 4], joie: [0.4, 8, 3], rire: [0.3, 7, 3], danse: [0.42, 9, 6], jeu: [0.36, 8, 4],
      coeur: [0.55, 5, 3], malice: [0.6, 4, 3], fierte: [0.7, 4, 2], surprise: [0.35, 5, 2], glitch: [0.25, 6, 5],
      colere: [0.22, 3, 2], fache: [0.4, 3, 2], peur: [0.2, 2, 1.5], gene: [0.7, 3, 2], parle: [0.45, 5, 2.5],
      ecoute: [0.6, 4, 2], reflexion: [0.9, 3, 2], neutre: [0.55, 6, 2.5], boude: [1.4, 2, 1], triste: [1.6, 2, 1],
      ennui: [1.8, 2, 1], endormie: [2.6, 1.5, 0.5], baille: [1.6, 2, 1], soupir: [1.8, 2, 1], concentree: [0.9, 2, 1], fredonne: [0.6, 5, 4],
    };
    function animateBody(state) {
      const z = { x: 0, y: 0, rot: 0, sx: 1, sy: 1 };
      if (!Mo) return z;
      const now = performance.now();
      const act = state.activity && state.activity.steps[state.activity.i];
      const mood = now < state.moodUntil ? state.mood : null;
      const key = mood || (act ? act.fx === 'danse' ? 'danse' : act.pose : state.mode === 'speaking' ? 'parle' : state.mode === 'thinking' ? 'reflexion' : state.mode === 'listening' ? 'ecoute' : 'neutre');
      // Changement d'humeur ou d'étape : pop à ressort (écrasé, étiré, puis il revient en rebondissant).
      // Seulement au début d'une humeur ou d'une activité : à chaque étape (chaque ligne lue, chaque coup d'œil), le
      // visage se déformait sans arrêt.
      const stepKey = mood ? 'm' + state.moodStart : state.activity ? 'a' + state.activity.name + state.activity.stepAt0 : key;
      if (stepKey !== body.moodKey) {
        const calm = ['ennui', 'endormie', 'triste', 'boude', 'soupir', 'baille'].includes(key);
        if (body.moodKey !== null && !calm) {
          const k = key === 'excitee' || key === 'surprise' || key === 'colere' ? 1.3 : 1;
          // Écrasement léger puis étirement, à ressort (au plus 5 % : au-delà, le visage avait l'air de buguer).
          Mo.animate(pop, { sy: [pop.sy, 1 - 0.035 * k, 1 + 0.03 * k, 1], sx: [pop.sx, 1 + 0.025 * k, 1 - 0.02 * k, 1], y: [pop.y, 2 * k, -5 * k, 0] }, { duration: 0.55, ease: 'easeInOut' });
          Mo.animate(pop, { rot: [pop.rot, (Math.random() < 0.5 ? -1 : 1) * 2.5 * k, 0] }, { duration: 0.5, ease: 'easeInOut' });
        }
        body.moodKey = stepKey;
      }
      // Tempo de vie : on relance la boucle quand l'énergie change.
      const [tempo, amp, sway] = ENERGY[key] || ENERGY.neutre;
      const tk = tempo + ':' + amp + ':' + sway;
      // Le changement se fait au bas d'un rebond (y ≈ 0) pour ne pas sauter ; le balancement repart de sa position.
      if (tk !== body.tempo && (body.tempo === null || Math.abs(life.y) < 0.8)) {
        body.tempo = tk;
        body.loops.forEach((l) => l.stop());
        body.loops = [
          Mo.animate(life, { y: [0, -amp, 0] }, { duration: tempo, repeat: Infinity, ease: ['easeOut', 'easeIn'] }),
          Mo.animate(life, { s: [1, 1 + amp * 0.0025, 1] }, { duration: tempo, repeat: Infinity, ease: 'easeInOut' }),
          Mo.animate(life, { rot: [life.rot, sway, -sway, life.rot] }, { duration: tempo * 4, repeat: Infinity, ease: 'easeInOut' }),
        ];
      }
      // Parole : un petit bond à chaque syllabe.
      if (state.talkAt !== body.talkAt && state.mode === 'speaking') {
        body.talkAt = state.talkAt;
        Mo.animate(hop, { y: [hop.y, -3 - state.talkTarget * 6, 0] }, { duration: 0.16, ease: 'easeOut' });
      }
      // Bornée en douceur vers le haut (au plus 14) : la visière ne sort jamais de l'écran, sans buter net.
      const y = life.y + pop.y + hop.y;
      return { x: pop.x, y: y < -8 ? -8 - 6 * Math.tanh((-8 - y) / 6) : y, rot: life.rot + pop.rot, sx: life.s * pop.sx, sy: (2 - life.s) * pop.sy };
    }

    function animateEyes(pose, state) {
      if (!Mo) return { open: pose.eyeOpen, smile: pose.smile, brow: pose.brow, blink: state.blinkAmount, gaze: [pose.gaze[0] + state.saccade[0], pose.gaze[1] + state.saccade[1]], iris: pose.irisScale };
      const target = state.target || pose;
      anim.eyes.forEach((e, i) => { toward(e, 'open', clamp(target.eyeOpen[i]), LID); toward(e, 'smile', clamp(target.smile[i]), LID); });
      toward(anim.brow, 'v', target.brow, BROW);
      const sac = state.saccadeTarget || [0, 0];
      toward(anim.look, 'x', target.gaze[0] + sac[0], LOOK);
      toward(anim.look, 'y', target.gaze[1] + sac[1], LOOK);
      toward(anim.look, 'iris', target.irisScale, IRIS);
      if (state.blinkStart > 0 && state.blinkStart !== anim.blinkStart) {
        anim.blinkStart = state.blinkStart;
        Mo.animate(anim.blink, { v: [anim.blink.v, 1, 1, 0] }, { duration: 0.3, times: [0, 0.3, 0.47, 1], ease: ['easeIn', 'linear', 'easeOut'] });
      }
      return { open: anim.eyes.map((e) => e.open), smile: anim.eyes.map((e) => e.smile), brow: anim.brow.v, blink: anim.blink.v, gaze: [anim.look.x, anim.look.y], iris: anim.look.iris };
    }
    Promise.all(['visage.png', 'exemple_de_composition.png', 'bouche1.png', 'bouche2.webp', 'bouche3.png', 'bouche4.png'].map((f) => load(base + f)))
      .then(([visage, composition, zig, wave, shout, open]) => {
        const S = cut(pixels(visage), pixels(composition), pixels(shout));
        // Bouches en blanc pur avec halo ; cri aux couleurs de la palette (tel quel, avec halo).
        const glowImg = (img, glows) => {
          const m = 60;
          const c = canvasOf(img.width + m * 2, img.height + m * 2);
          const g = c.getContext('2d');
          for (const [color, blur] of glows) { g.shadowColor = color; g.shadowBlur = blur; g.drawImage(img, m, m); }
          g.shadowColor = 'transparent';
          g.drawImage(img, m, m);
          return { c, m };
        };
        // Trait blanc pur (les pixels sombres du détourage deviennent blancs, l'opacité est gardée).
        const whiten = (img) => {
          const c = canvasOf(img.width, img.height);
          const g = c.getContext('2d');
          g.drawImage(img, 0, 0);
          g.globalCompositeOperation = 'source-in';
          g.fillStyle = css(PALETTE[3]);
          g.fillRect(0, 0, c.width, c.height);
          return c;
        };
        const WHITE_GLOW = [['rgba(0, 255, 102, 0.6)', 26], ['rgba(255, 255, 255, 0.9)', 12]];
        const mouths = {
          zig: glowImg(whiten(zig), WHITE_GLOW.map(([c, b]) => [c, b / S.flat.k])),
          wave: glowImg(whiten(wave), WHITE_GLOW.map(([c, b]) => [c, b / S.flat.k])),
          shout: glowImg(shout, [['rgba(128, 0, 255, 0.6)', 90], ['rgba(0, 255, 102, 0.7)', 50]]),
          open: glowImg(open, [['rgba(0, 255, 102, 0.6)', 80], ['rgba(255, 255, 255, 0.8)', 40]]),
        };
        const BOX = { x: S.vx0 - 150, y: S.vy0 - 70, w: S.vx1 - S.vx0 + 300, h: S.tri.box[3] + 60 - (S.vy0 - 70) };
        const F = S.flat;

        function lids(e, closed, squint, brow) {
          const { lidBox: [bx, by], lidCanvas: c, top, topS, botS, hole, u } = e;
          const g = c.getContext('2d');
          g.globalCompositeOperation = 'source-over';
          g.clearRect(0, 0, c.width, c.height);
          if (closed < 0.005 && squint < 0.005 && Math.abs(brow) < 0.01) return false;
          const shut = (x) => { const n = x < u.xc ? (u.xc - x) / (u.xc - hole.x0 || 1) : (x - u.xc) / (hole.x1 - u.xc || 1); return u.mid + ((x < u.xc ? u.left : u.right) - u.mid) * n * n; };
          const xs = [];
          for (let x = hole.x0; x <= hole.x1; x += 4) xs.push(x);
          xs.push(hole.x1);
          // Sourcil : une ligne droite inclinée, mesurée sur la hauteur du centre de l'œil. Mesurée colonne par colonne,
          // elle suivait la diagonale raide de l'orbite côté nez et découpait son liseré en escalier.
          // Elle part du sommet des cornes (sourcil à 0 : rien n'est recouvert) et descend vers sa ligne finale avec le
          // sourcil ; partir du centre de l'œil tronquait les cornes et le liseré du bandeau au moindre mouvement.
          const topC = topS.get(u.xc), botC = botS.get(u.xc);
          const browFrom = e.topMin - LID_STRIPE - 2;
          const upper = xs.map((x) => {
            // Ouverte : rangée au-dessus du vrai haut de l'orbite, cornes comprises (sinon son liseré en marquait la pointe).
            const open = Math.min(topS.get(x), top.get(x) ?? Infinity) - LID_EDGE - LID_STRIPE - 30;
            let y = open + (shut(x) - open) * closed;
            if (Math.abs(brow) > 0.01) {
              const nx = clamp((x - (hole.x0 + hole.x1) / 2) / ((hole.x1 - hole.x0) / 2), -1, 1);
              const line = topC + (botC - topC) * (0.27 + 0.2 * Math.sign(brow) * nx * -e.side);
              y = Math.max(y, browFrom + (line - browFrom) * Math.abs(brow));
            }
            return [x - bx, y - by];
          });
          // Paupière du bas (œil rieur) : un arc régulier qui monte au milieu, sur toute la largeur de l'œil jusqu'au bord
          // de la visière (au-delà de l'orbite, la hauteur de son bord le plus proche).
          const midY = (topS.get(u.xc) + botS.get(u.xc)) / 2;
          const eyeH = botS.get(u.xc) - topS.get(u.xc);
          const [lx0, ly0, lx1] = e.lowBox;
          const lowXs = [];
          for (let x = lx0; x <= lx1; x += 4) lowXs.push(x);
          const lower = lowXs.map((x) => {
            const xin = Math.round(clamp(x, hole.x0, hole.x1));
            // Ouverte : rangée sous toute la visière (sous l'orbite seulement, elle marquait les fines bandes de l'aile).
            const open = Math.max(botS.get(xin) + LID_EDGE + LID_STRIPE + 30, e.lowBox[3] + LID_STRIPE + 4);
            const n = clamp((x - (hole.x0 + hole.x1) / 2) / ((hole.x1 - hole.x0) / 2), -1, 1);
            const arc = midY + 0.12 * eyeH - 0.3 * eyeH * (1 - n * n);
            return [x - lx0, open + (arc - open) * squint - ly0];
          });
          // Bande pleine entre le bord de la paupière et le haut (from < 0) ou le bas (from > 0) de son calque.
          const band = (target, edge, from, color) => {
            target.beginPath();
            target.moveTo(edge[0][0] - 40, from);
            target.lineTo(edge[0][0] - 40, edge[0][1]);
            edge.forEach(([x, y]) => target.lineTo(x, y));
            target.lineTo(edge[edge.length - 1][0] + 40, edge[edge.length - 1][1]);
            target.lineTo(edge[edge.length - 1][0] + 40, from);
            target.closePath();
            target.fillStyle = color;
            target.fill();
          };
          // Une paupière : vert jusqu'au bord dans son masque, puis le liseré violet (épaisseur LID_STRIPE au bord),
          // seulement sur le creux de l'œil.
          const lid = (layer, mask, stripeLayer, stripeMask, edge, from) => {
            const lc = layer.getContext('2d');
            const sc = stripeLayer.getContext('2d');
            for (const k of [lc, sc]) { k.globalCompositeOperation = 'source-over'; k.clearRect(0, 0, layer.width, layer.height); }
            band(lc, edge, from, css(PALETTE[0]));
            lc.globalCompositeOperation = 'destination-in';
            lc.drawImage(mask, 0, 0);
            band(sc, edge, from, css(PALETTE[1]));
            sc.globalCompositeOperation = 'destination-out';
            band(sc, edge.map(([x, y]) => [x, y + Math.sign(from) * LID_STRIPE]), from, '#000');
            sc.globalCompositeOperation = 'destination-in';
            sc.drawImage(stripeMask, 0, 0);
            lc.globalCompositeOperation = 'source-over';
            lc.drawImage(stripeLayer, 0, 0);
          };
          // Paupière du haut, dans le masque qui garde les pointes.
          lid(c, e.lidMask, e.stripeCanvas, e.stripeMask, upper, -2000);
          // Paupière du bas : l'inverse, dans son masque à elle (pointes recouvertes).
          e.lowOn = squint > 0.005;
          if (e.lowOn) lid(e.lowCanvas, e.lowMask, e.lowStripeCanvas, e.lowStripeMask, lower, 4000);
          return true;
        }

        face.draw = ({ pose, state, glitching, particles }) => {
          const dpr = window.devicePixelRatio || 1;
          const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
          const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
          if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalAlpha = 1;
          ctx.fillStyle = css(background);
          ctx.fillRect(0, 0, w, h);
          drawBackdrop(ctx, w, h, state);
          // Le visage se dessine sur son propre calque, recopié ensuite tourné (plus bas).
          if (turnCanvas.width !== w || turnCanvas.height !== h) { turnCanvas.width = w; turnCanvas.height = h; }
          turnCtx.setTransform(1, 0, 0, 1, 0, 0);
          turnCtx.clearRect(0, 0, w, h);
          ctx = turnCtx;
          // Marge de 12 % en haut et en bas : rebonds, danse et sauts ne font jamais sortir la visière de l'écran
          // (même quand la bulle de parole réduit la place).
          const s = Math.min(w / BOX.w, h / (BOX.h * 1.24));
          // Visage descendu (Tommy) : la place au-dessus de sa tête est pour les signes (points de réflexion, « ! », « z »…).
          ctx.translate(w / 2, h * 0.6);
          ctx.scale(s, s);
          ctx.translate(-(BOX.x + BOX.w / 2), -(BOX.y + BOX.h / 2));
          // Tête : glisse et penche (mêmes amplitudes que le visage plat, à l'échelle de l'image).
          const hd = state.head;
          const pivot = [F.x(210), F.y(210)];
          ctx.translate(...pivot);
          // Mouvement du visage entier (rebond, tremblement, danse… : EFFECTS de capri.js).
          const fx = state.fx || { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1 };
          const bd = animateBody(state); // vie, pop et sauts (Motion)
          state.body = bd; // diagnostic
          // Inclinaison totale bornée en douceur à ± 4° : la visière est trois fois plus large que haute, pencher plus
          // soulève un coin hors de l'écran.
          const tilt = hd.angleZ * 0.4 + fx.rot + bd.rot;
          ctx.rotate((4 * Math.tanh(tilt / 4) * Math.PI) / 180);
          ctx.scale(fx.sx * bd.sx, fx.sy * bd.sy);
          // Tête tournée à gauche ou à droite (angleX) : faite plus bas, en perspective, sur le calque du visage.
          ctx.translate(-pivot[0] + (fx.dx + (fx.jx || 0) + bd.x) * F.k, -pivot[1] + (hd.angleY * 8 + hd.bob * 0.6 + fx.dy + (fx.jy || 0) + bd.y) * F.k);

          // Iris : suit le regard, vu seulement dans son anneau.
          const eye = animateEyes(pose, state);
          state.eyes = eye; // dernières valeurs des yeux (diagnostic)
          S.eyes.forEach((e, index) => {
            const [x0, y0] = e.box;
            const g = e.work.getContext('2d');
            g.globalCompositeOperation = 'source-over';
            g.clearRect(0, 0, e.work.width, e.work.height);
            const gx = eye.gaze[0] * 2.6 * F.k, gy = eye.gaze[1] * 2.6 * F.k;
            g.save();
            g.translate(e.cx - x0 + gx, e.cy - y0 + gy);
            g.scale(eye.iris, eye.iris);
            g.translate(-(e.cx - x0), -(e.cy - y0));
            g.drawImage(S.irisCanvases[index], 0, 0);
            g.restore();
            g.globalCompositeOperation = 'destination-in';
            g.drawImage(e.insideMask, 0, 0);
            ctx.drawImage(e.work, x0, y0);
            e.side = index ? 1 : -1;
          });
          ctx.drawImage(S.ringCanvas, 0, 0);
          // Paupières (même vert que la visière, bord de l'orbite couvert), calculées une fois et dessinées deux fois
          // (Tommy) : une copie sous la visière, qui comble le creux derrière ses traits, et la même par-dessus.
          const shown = S.eyes.filter((e, index) => {
            const closed = clamp(1 - clamp(eye.open[index]) * (1 - clamp(eye.blink)));
            // Paupière du bas : seulement pour un vrai sourire des yeux ; les petits plissements de repos (jusqu'à 0,18)
            // ne la font plus monter dans l'aile.
            const squint = clamp((clamp(eye.smile[index] + state.squint[index]) - 0.2) / 0.8) * (1 - closed);
            return lids(e, closed, squint, eye.brow);
          });
          const drawLids = () => shown.forEach((e) => {
            ctx.drawImage(e.lidCanvas, e.lidBox[0], e.lidBox[1]);
            if (e.lowOn) ctx.drawImage(e.lowCanvas, e.lowBox[0], e.lowBox[1]);
          });
          drawLids();
          ctx.drawImage(S.visorCanvas, 0, 0);
          drawLids();

          // Bouche : zigzag (repos), vague (petite bouche), ouverte (parole, rire), cri ; le reste en tracé.
          // Toutes descendues de MOUTH_DROP sous la visière (Tommy : « un poil plus bas, c'est trop collé »).
          ctx.save();
          ctx.translate(0, MOUTH_DROP * F.k);
          const m = pose.mouth;
          const openW = smooth((m.open - 0.08) / 0.2) * (1 - clamp(m.round)) * (1 - clamp(m.tri));
          const zigW = clamp(m.zig * 1.8) * (1 - openW); // les petites bouches en vague (zig 0,55 à 0,6) passent entières à l'image
          const triW = clamp(m.tri);
          const restW = clamp(1 - openW - zigW - triW);
          // Une seule bouche à la fois, entière, comme les planches de la série : mélangées, elles se superposaient en
          // fantômes transparents (triangle sur la bouche ouverte pendant la parole, trois bouches dans les transitions).
          const top = Math.max(openW, zigW, triW, restW);
          const open = openW === top ? 1 : 0;
          const zig = !open && zigW === top ? 1 : 0;
          const triA = !open && !zig && triW === top ? 1 : 0;
          const rest = !open && !zig && !triA ? 1 : 0;
          const sprite = ({ c, m: margin }, x, y, scale, alpha, sy = 1) => {
            ctx.globalAlpha = alpha;
            ctx.drawImage(c, x - margin * scale, y - margin * scale * sy, c.width * scale, c.height * scale * sy);
            ctx.globalAlpha = 1;
          };
          if (zig > 0.01) {
            if (m.width < 0.7) sprite(mouths.wave, F.x(0), F.y(0), F.k, zig);
            else sprite(mouths.zig, F.x(124.5), F.y(307.5), F.k, zig);
          }
          if (open > 0.01) {
            const sy = clamp(0.3 + (m.open / 0.75) * 0.7, 0.3, 1.1);
            const sc = S.tri.scale;
            sprite(mouths.open, (S.tri.box[0] + S.tri.box[2]) / 2 - ((mouths.open.c.width - mouths.open.m * 2) * sc) / 2, S.tri.box[1], sc, open, sy);
          }
          if (triA > 0.01) {
            const k = 0.6 + clamp(m.open) * 0.4;
            ctx.save();
            const cx = (S.tri.box[0] + S.tri.box[2]) / 2, cy = S.tri.box[1];
            ctx.translate(cx, cy);
            ctx.scale(k, k);
            ctx.translate(-cx, -cy);
            sprite(mouths.shout, S.tri.x, S.tri.y, S.tri.scale, triA);
            ctx.restore();
          }
          if (rest > 0.01) {
            ctx.save();
            ctx.translate(F.x(211), F.y(317));
            ctx.scale(1.81 * F.k, 1.81 * F.k);
            ctx.translate(-(MOUTH.x1 + MOUTH.x2) / 2, -MOUTH.y);
            ctx.shadowColor = 'rgba(0, 255, 102, 0.7)';
            ctx.shadowBlur = 18;
            drawMouthShape(ctx, { ...m, zig: 0, tri: 0, tooth: 0, open: m.round > 0.3 ? m.open : 0 }, glitching, rest);
            ctx.restore();
          }
          ctx.restore();

          // Tête tournée (Tommy : « qu'on la voie vraiment tourner la tête », puis vers le haut et le bas) : le calque du
          // visage revient déformé en deux passes, comme une rotation autour d'un axe horizontal (haut / bas, par lignes)
          // puis d'un axe vertical (gauche / droite, par colonnes) : le côté qui s'éloigne se resserre et rapetisse, celui
          // qui approche grandit, et tout glisse vers où elle regarde. Jusqu'à ±40° de côté et ±26° en hauteur.
          const yaw = Math.tanh(hd.angleX / 1.3) * 0.7;
          const pitch = Math.tanh(hd.angleY / 0.9) * 0.45;
          const faceT = ctx.getTransform();
          ctx = mainCtx;
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          {
            const cosY = Math.cos(yaw), sinY = Math.sin(yaw), cosP = Math.cos(pitch), sinP = Math.sin(pitch);
            const halfW = (BOX.w * s) / 2, halfH = (BOX.h * s) / 2;
            const X0 = w / 2, Y0 = h * 0.6;
            // Haut / bas : chaque ligne descend ou monte (tassée) et s'élargit ou se resserre (en regardant en bas, le
            // haut s'éloigne).
            let src = turnCanvas;
            if (Math.abs(pitch) > 0.005) {
              if (pitchCanvas.width !== w || pitchCanvas.height !== h) { pitchCanvas.width = w; pitchCanvas.height = h; }
              pitchCtx.clearRect(0, 0, w, h);
              const shiftY = sinP * halfH * 0.55;
              const NY = 90, sh = h / NY;
              for (let j = 0; j < NY; j++) {
                const y0 = j * sh, y1 = y0 + sh;
                const v = Math.max(-2, Math.min(2, ((y0 + y1) / 2 - Y0) / halfH));
                const ky = 1 + v * sinP * 0.3;
                const d0 = Y0 + (y0 - Y0) * cosP + shiftY, d1 = Y0 + (y1 - Y0) * cosP + shiftY;
                pitchCtx.drawImage(turnCanvas, 0, y0, w, sh + 1, X0 - X0 * ky, d0, w * ky, d1 - d0 + 1);
              }
              src = pitchCanvas;
            }
            // Gauche / droite : chaque colonne grandit ou rapetisse, et glisse vers où elle regarde.
            const shiftX = sinY * halfW * 0.32;
            const NX = Math.abs(yaw) > 0.005 ? 64 : 1, sw = w / NX;
            for (let i = 0; i < NX; i++) {
              const x0 = i * sw, x1 = x0 + sw;
              const u = Math.max(-1.4, Math.min(1.4, ((x0 + x1) / 2 - X0) / halfW));
              const kx = 1 - u * sinY * 0.34;
              const d0 = X0 + (x0 - X0) * cosY + shiftX, d1 = X0 + (x1 - X0) * cosY + shiftX;
              ctx.drawImage(src, x0, 0, sw + 1, h, d0, Y0 - Y0 * kx, d1 - d0 + 1, h * kx);
            }
          }
          ctx.setTransform(faceT);

          // Petits signes : étincelles, notes, « z », « ! », veine de colère, goutte.
          for (const p of particles) drawSign(ctx, p, F);
          drawDots(ctx, F, state.mode === 'thinking');
          drawHack(ctx, F, !!state.hacking);
          // Glitch : bandes décalées.
          // Décalage réduit (Tommy), encore plus quand elle parle.
          if (state.glitch > 0.05) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            const reach = state.mode === 'speaking' ? 0.008 : 0.022;
            for (let i = 0; i < 6; i++) {
              const y = Math.random() * h;
              const bh = 6 + Math.random() * h * 0.06;
              ctx.drawImage(canvas, 0, y, w, bh, (Math.random() - 0.5) * w * reach * state.glitch, y, w, bh);
            }
          }
          drawZap(state, w, h);
        };
        face.ready = true;
      })
      .catch((error) => console.error('Visage en images indisponible :', error));
    return face;
  };
})();
