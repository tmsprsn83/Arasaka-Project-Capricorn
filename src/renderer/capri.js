// Visage de CAPRI : rig 2D façon Live2D sur l'image de référence HD (capri.png, CAPRI en 3D facettée).
// Au chargement, la zone du visage est séparée en pièces, au pixel près :
//   - plaque : l'image sans les yeux ni la bouche (orbites rebouchées avec le vert du masque) ;
//   - orbite de chaque œil (noir, anneaux, pointes) et iris (bleu + losange blanc), séparés ;
//   - mèches rouges qui passent devant le visage.
// Chaque pièce est un maillage déformé sur la carte graphique (WebGL) à partir de paramètres : angle de la tête
// (gauche-droite, haut-bas, inclinaison), paupières, sourire des yeux, regard, bouche, respiration. Les paramètres
// suivent leurs cibles par des ressorts, et la chevelure a sa physique (pendules qui réagissent aux mouvements
// de la tête). La bouche est paramétrique, d'après les planches d'expressions.
(function () {
  // Repères relevés sur l'image (1725 × 912).
  const SRC = { w: 1725, h: 912 };
  const FACE = { x: 690, y: 500, w: 360, h: 250 };
  const EYES = [{ cx: 775.5, cy: 584.5, side: -1 }, { cx: 949.5, cy: 584, side: 1 }];
  const EYE_R = 68; // rayon de découpe d'un œil (pointes comprises)
  const RING_R = 47; // rayon extérieur de l'anneau vert autour de l'iris
  const GAZE = 2.2; // amplitude du regard : dans la série, l'iris va jusqu'au bord de l'orbite
  const MOUTH = { x1: 812, x2: 907, y: 684, depth: 19, box: { x: 800, y: 670, w: 120, h: 45 } };
  const MOUTH_BOX = { x: 770, y: 630, w: 180, h: 150 }; // zone où la bouche est dessinée
  const HEAD = { x: 860, y: 600 }; // centre du visage
  const NECK = { x: 860, y: 1010 }; // pivot de l'inclinaison, sous l'image
  const FRINGE_ROOT = { x: 860, y: 470 };
  const COLORS = { face: '#111111', white: '#f6f6f6', bg: [15, 5, 14] };

  // Poses : valeurs cibles du rig, d'après la planche d'expressions de Tommy. angleX / angleY (tête tournée,
  // -1 à 1), angleZ (inclinaison, degrés), eyeOpen et smile (par œil, smile = œil rieur « ^ »), brow (paupière
  // inclinée : + fâchée, - triste), eyeScale, eyeTilt (degrés), irisScale, gaze (décalage des iris),
  // mouth : open, width, curve (+ sourire, - moue), zig (vague / zigzag), tooth (dent cassée), round (« o »),
  // tri (triangle ▼), pixel (bouche en marches).
  const M0 = { open: 0, width: 1, curve: 0, zig: 0, tooth: 0, round: 0, tri: 0, pixel: 0 };
  const pose = (p) => ({ angleX: 0, angleY: 0, angleZ: 0, eyeOpen: [1, 1], smile: [0, 0], brow: 0, eyeScale: 1, eyeTilt: 0, irisScale: 1, gaze: [0, 0], ...p, mouth: { ...M0, ...p.mouth } });
  const POSES = {
    // Repos : la bouche en zigzag (demandée par Tommy, d'après le visage plat).
    neutre: pose({ mouth: { zig: 1 } }),
    ecoute: pose({ angleY: 0.35, angleZ: 4, eyeOpen: [1.04, 1.04], eyeScale: 1.06, irisScale: 1.08, gaze: [0, 2], mouth: { width: 0.9, curve: 0.8 } }),
    // « Inquiet » : petite bouche en vague, yeux un peu plissés, regard en l'air.
    reflexion: pose({ angleX: 0.6, angleY: -0.5, angleZ: -3, eyeOpen: [0.82, 0.82], brow: -0.3, gaze: [7, -6], mouth: { width: 0.55, zig: 0.55 } }),
    // Parole : bouche ouverte à la dent (« ouvert »), qui passe par le triangle aux petites ouvertures.
    parle: pose({ angleY: 0.1, eyeScale: 1.02, eyeTilt: -2, mouth: { width: 0.95, curve: 0.7, tooth: 1 } }),
    // Rire : yeux fermés en « U », comme quand elle cligne dans la série.
    rire: pose({ angleY: 0.45, eyeOpen: [0, 0], mouth: { open: 0.75, width: 1.15, curve: 1, tooth: 1 } }),
    coeur: pose({ angleX: -0.2, angleY: 0.2, angleZ: 6, smile: [0.4, 0.4], mouth: { width: 1.05, curve: 1.1 } }),
    // « Clin d'œil G » : l'œil gauche de CAPRI fermé, petite bouche en accent circonflexe.
    clin: pose({ angleX: -0.3, angleY: 0.1, angleZ: -5, eyeOpen: [1, 0], smile: [0.25, 0], eyeScale: 1.02, gaze: [-3, 0], mouth: { width: 0.55, curve: -0.8 } }),
    // « Surpris » : petit « o » blanc plein, yeux grands ouverts.
    surprise: pose({ angleY: 0.3, eyeOpen: [1.12, 1.12], eyeScale: 1.14, eyeTilt: -6, irisScale: 0.72, mouth: { open: 0.42, width: 0.3, round: 1 } }),
    // Glitch : la bouche en marches de pixels.
    glitch: pose({ eyeScale: 1.05, irisScale: 1.1, mouth: { width: 0.9, pixel: 1 } }),
    // Bouderie : bouche « platé », tête détournée.
    boude: pose({ angleX: -0.55, angleY: -0.35, angleZ: -5, eyeOpen: [0.72, 0.72], brow: 0.35, eyeScale: 0.97, gaze: [-6, 3], mouth: { width: 0.75 } }),
    triste: pose({ angleY: -0.45, angleZ: 3, eyeOpen: [0.9, 0.9], brow: -1, irisScale: 0.95, gaze: [0, 6], mouth: { width: 0.7, curve: -0.9 } }),
    // « Fâché » : paupières tombantes vers l'intérieur, bouche en vague.
    fache: pose({ angleY: -0.25, angleZ: -2, brow: 1, irisScale: 0.9, mouth: { width: 0.6, zig: 0.6 } }),
    // Humeurs demandées par Tommy (« la colère, la joie, etc. »), avec leurs mouvements dans EFFECTS.
    joie: pose({ angleY: 0.25, angleZ: 5, smile: [0.85, 0.85], eyeScale: 1.04, mouth: { open: 0.55, width: 1.1, curve: 1, tooth: 1 } }),
    colere: pose({ angleY: -0.3, brow: 1.1, eyeOpen: [0.9, 0.9], irisScale: 0.66, eyeScale: 1.05, mouth: { open: 0.65, tri: 1 } }),
    excitee: pose({ angleY: -0.1, eyeOpen: [1.1, 1.1], eyeScale: 1.14, irisScale: 1.22, mouth: { open: 0.6, width: 1.15, curve: 1, tooth: 1 } }),
    malice: pose({ angleX: 0.25, angleZ: -4, eyeOpen: [0.78, 0.78], brow: 0.45, smile: [0.2, 0.2], gaze: [6, 1], mouth: { width: 0.95, curve: 1.1 } }),
    fierte: pose({ angleY: -0.6, angleZ: 3, eyeOpen: [0, 0], mouth: { width: 1.05, curve: 1.1 } }),
    peur: pose({ angleY: 0.3, eyeOpen: [1.15, 1.15], eyeScale: 1.12, brow: -0.9, irisScale: 0.6, mouth: { width: 0.55, zig: 0.6 } }),
    gene: pose({ angleX: -0.35, angleY: 0.4, angleZ: 8, smile: [0.5, 0.5], gaze: [-7, 6], mouth: { width: 0.55, zig: 0.55 } }),
    ennui: pose({ angleX: -0.4, angleY: 0.35, angleZ: -7, eyeOpen: [0.5, 0.5], brow: -0.2, gaze: [-7, 4], mouth: { width: 0.75, curve: -0.25 } }),
    // Poses des activités de repos (ACTIVITIES).
    concentree: pose({ angleY: 0.2, eyeOpen: [0.8, 0.8], brow: 0.3, irisScale: 0.92, gaze: [0, 5], mouth: { width: 0.5, curve: -0.3 } }),
    endormie: pose({ angleY: 0.7, angleZ: 11, eyeOpen: [0.02, 0.02], mouth: { width: 0.45, curve: 0.2 } }),
    baille: pose({ angleY: -0.5, angleZ: -4, eyeOpen: [0, 0], brow: -0.3, mouth: { open: 0.9, width: 0.55, round: 1 } }),
    fredonne: pose({ angleZ: 4, eyeOpen: [0.6, 0.6], smile: [0.7, 0.7], mouth: { width: 0.55, zig: 0.6 } }),
  };

  // Mouvements propres à certaines poses : décalage (dx, dy, en unités du visage plat), rotation (degrés) et
  // étirement du visage entier. `age` : ms depuis le début de l'humeur ou de l'étape.
  const EFFECTS = {
    joie: (f, t) => { f.dy = -Math.abs(Math.sin(t * 9)) * 14; f.sy = 1 + Math.abs(Math.sin(t * 9)) * 0.03; f.rot = Math.sin(t * 4.5) * 4; },
    excitee: (f, t) => { f.dy = -Math.abs(Math.sin(t * 13)) * 11; f.dx = Math.sin(t * 6.5) * 6; f.rot = Math.sin(t * 6.5) * 5; },
    // Tremblements (jx, jy) : oscillations rapides et régulières, ajoutées par-dessus le reste du mouvement, qui lui
    // reste lissé (passer d'une danse à la colère ne fait plus sauter le visage).
    colere: (f, t, age) => { const k = age < 700 ? 1 : 0.3; f.jx = Math.sin(t * 52) * 4 * k; f.jy = Math.sin(t * 37) * 1.5 * k; },
    fache: (f, t, age) => { if (age < 450) f.jx = Math.sin(t * 45) * 2.5 * (1 - age / 450); },
    peur: (f, t) => { f.jx = Math.sin(t * 61) * 1.2; f.jy = Math.sin(t * 43) * 0.7; },
    fierte: (f, t, age) => { f.dy = -6 * smooth(age / 400); f.sy = 1 + 0.02 * smooth(age / 400); },
    endormie: (f, t) => { f.dy = Math.sin(t * 1.3) * 4 + 6; f.rot = Math.sin(t * 0.7) * 2; },
    baille: (f, t, age) => { const k = Math.sin(clamp(age / 1600) * Math.PI); f.dy = -7 * k; f.sy = 1 + 0.05 * k; f.sx = 1 - 0.02 * k; },
    fredonne: (f, t) => { f.rot = Math.sin(t * 2.6) * 5; f.dx = Math.sin(t * 2.6) * 4; },
    danse: (f, t) => { f.rot = Math.sin(t * 7) * 7; f.dx = Math.sin(t * 3.5) * 12; f.dy = -Math.abs(Math.sin(t * 7)) * 9; },
    sursaut: (f, t, age) => { const k = Math.exp(-age / 160); f.dy = -12 * k; f.sy = 1 + 0.04 * k; f.jx = Math.sin(t * 50) * 3 * k; },
    soupir: (f, t, age) => { const p = clamp(age / 1800); f.dy = p < 0.4 ? -6 * smooth(p / 0.4) : -6 + 14 * smooth((p - 0.4) / 0.6); },
    etire: (f, t, age) => { const k = Math.sin(clamp(age / 1400) * Math.PI); f.dy = -10 * k; f.sy = 1 + 0.07 * k; f.sx = 1 - 0.03 * k; },
  };

  // Activités de repos : ce qu'elle fait quand elle s'ennuie, pour avoir l'air occupée. Chaque étape : pose, durée,
  // et au choix regard imposé (fixe ou fonction de l'avancement 0 → 1), mouvement (EFFECTS), petits signes qui
  // sortent d'elle (notes, « z », « ! », veine de colère, goutte), glitch, clignement.
  const lineRead = (row) => [
    { pose: 'concentree', ms: 1100, gaze: (p) => [-10 + 20 * p, 2 + row * 1.6] },
    { pose: 'concentree', ms: 160, gaze: [-10, 3 + row * 1.6] },
  ];
  const ACTIVITIES = {
    lecture: () => [...lineRead(0), ...lineRead(1), ...lineRead(2), ...lineRead(3),
      Math.random() < 0.5 ? { pose: 'malice', ms: 1500 } : { pose: 'surprise', ms: 900, spawn: 'idee' }, { pose: 'neutre', ms: 300 }],
    regard: () => [
      { pose: 'neutre', ms: 900, gaze: [-15, 0] }, { pose: 'neutre', ms: 600, gaze: [-14, -7] },
      { pose: 'neutre', ms: 1000, gaze: [15, -2] }, { pose: 'neutre', ms: 700, gaze: [14, 7] },
      { pose: 'malice', ms: 900, gaze: [0, 0] }],
    baille: () => [{ pose: 'ennui', ms: 700 }, { pose: 'baille', ms: 1700, fx: 'baille' }, { pose: 'ennui', ms: 600, blink: true }, { pose: 'neutre', ms: 300 }],
    somnole: () => [
      { pose: 'ennui', ms: 1500 }, { pose: 'endormie', ms: 2600, fx: 'endormie', spawn: 'z', every: 800 },
      { pose: 'endormie', ms: 2600, fx: 'endormie', spawn: 'z', every: 800 },
      { pose: 'surprise', ms: 600, fx: 'sursaut', spawn: 'goutte' }, { pose: 'gene', ms: 1700 }, { pose: 'neutre', ms: 300 }],
    fredonne: () => [{ pose: 'fredonne', ms: 5200, fx: 'fredonne', spawn: 'note', every: 450 }, { pose: 'joie', ms: 900 }],
    danse: () => [{ pose: 'joie', ms: 4200, fx: 'danse', spawn: 'note', every: 300 }, { pose: 'excitee', ms: 700, spawn: 'etoile' }, { pose: 'rire', ms: 1300 }],
    calcul: () => [
      { pose: 'reflexion', ms: 2400, gaze: () => [(Math.random() - 0.5) * 16, -7 + Math.random() * 4] },
      { pose: 'surprise', ms: 500, spawn: 'idee' }, { pose: 'joie', ms: 1500 }],
    jeu: () => [
      { pose: 'concentree', ms: 700 }, { pose: 'surprise', ms: 450 },
      { pose: 'excitee', ms: 1600, gaze: () => [(Math.random() - 0.5) * 22, (Math.random() - 0.5) * 12] },
      { pose: 'rire', ms: 1400 }],
    soupir: () => [{ pose: 'ennui', ms: 1900, fx: 'soupir' }, { pose: 'ennui', ms: 1400, gaze: [9, 5] }, { pose: 'neutre', ms: 300 }],
    etirement: () => [{ pose: 'fierte', ms: 1500, fx: 'etire' }, { pose: 'joie', ms: 900 }],
    bug: () => [
      ...lineRead(0), ...lineRead(1),
      { pose: 'colere', ms: 1500, spawn: 'veine' }, { pose: 'boude', ms: 1300 }, { pose: 'neutre', ms: 300 }],
  };

  const clone = (pose) => JSON.parse(JSON.stringify(pose));
  const zeroed = (pose) => JSON.parse(JSON.stringify(pose), (k, v) => (typeof v === 'number' ? 0 : v));
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const smooth = (v) => { const t = clamp(v); return t * t * (3 - 2 * t); };
  const canvasOf = (w, h) => Object.assign(document.createElement('canvas'), { width: Math.ceil(w), height: Math.ceil(h) });
  // Bruit doux (somme de sinus) pour les mouvements de repos.
  const noise = (t, seed) => Math.sin(t * 0.31 + seed) * 0.6 + Math.sin(t * 0.73 + seed * 2.1) * 0.3 + Math.sin(t * 1.37 + seed * 3.7) * 0.1;

  // Ressort amorti : chaque nombre de `value` rejoint celui de `target` avec un peu d'inertie.
  function spring(value, velocity, target, stiffness, dt) {
    const damping = 2 * 0.78 * Math.sqrt(stiffness);
    for (const key of Object.keys(target)) {
      if (typeof target[key] === 'object') { spring(value[key], velocity[key], target[key], stiffness, dt); continue; }
      const a = stiffness * (target[key] - value[key]) - damping * velocity[key];
      velocity[key] += a * dt;
      value[key] += velocity[key] * dt;
    }
  }

  // Découpe du visage en pièces à partir des pixels de l'image.
  function buildRig(image) {
    const work = canvasOf(SRC.w, SRC.h).getContext('2d', { willReadFrequently: true });
    work.drawImage(image, 0, 0);
    const src = work.getImageData(FACE.x, FACE.y, FACE.w, FACE.h);
    const W = FACE.w;
    const H = FACE.h;
    const d = src.data;
    const kind = new Uint8Array(W * H); // 0 sombre, 1 vert, 2 rouge, 3 bleu, 4 blanc
    let gr = 0, gg = 0, gb = 0, gn = 0;
    for (let i = 0; i < W * H; i++) {
      const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
      if (g > 140 && g > r + 60 && g > b + 40) { kind[i] = 1; if (g > 200) { gr += r; gg += g; gb += b; gn++; } }
      else if (r > 120 && r > g + 70 && r > b + 40) kind[i] = 2;
      else if (b > 140 && b > r + 60 && b > g + 15) kind[i] = 3;
      else if (r > 185 && g > 185 && b > 185) kind[i] = 4;
    }
    const greenRGB = [Math.round(gr / gn), Math.round(gg / gn), Math.round(gb / gn)];

    // Masque vert : étendue de chaque ligne (les trous laissés par les orbites sont dedans).
    const span = [];
    for (let y = 0; y < H; y++) {
      let min = W, max = -1, count = 0;
      for (let x = 0; x < W; x++) if (kind[y * W + x] === 1) { count++; if (x < min) min = x; if (x > max) max = x; }
      span.push(count > 12 ? [min, max] : null);
    }
    const inMask = (x, y) => span[y] && x > span[y][0] + 1 && x < span[y][1] - 1;

    // Pièces : orbites (sans iris), iris, plaque, mèches de devant.
    const size = EYE_R * 2;
    const sockets = EYES.map(() => canvasOf(size, size));
    const irises = EYES.map(() => canvasOf(size, size));
    const socketData = sockets.map((c) => c.getContext('2d').createImageData(size, size));
    const irisData = irises.map((c) => c.getContext('2d').createImageData(size, size));
    const plate = new ImageData(new Uint8ClampedArray(d), W, H);
    const front = new ImageData(W, H);
    const put = (target, index, r, g, b, a = 255) => { target[index] = r; target[index + 1] = g; target[index + 2] = b; target[index + 3] = a; };

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const k = kind[i];
        const sx = FACE.x + x;
        const sy = FACE.y + y;
        const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
        if (k === 2) put(front.data, i * 4, r, g, b);
        // Bouche d'origine : effacée de la plaque (peau noire).
        const m = MOUTH.box;
        if (sx >= m.x && sx < m.x + m.w && sy >= m.y && sy < m.y + m.h && k !== 2 && (r + g + b) / 3 > 30) put(plate.data, i * 4, 17, 17, 17);
        if (k === 2 || !inMask(x, y)) continue;
        const eye = sx < (EYES[0].cx + EYES[1].cx) / 2 ? 0 : 1;
        const ex = sx - EYES[eye].cx + EYE_R;
        const ey = sy - EYES[eye].cy + EYE_R;
        const dist = Math.hypot(ex - EYE_R, ey - EYE_R);
        if (ex < 0 || ey < 0 || ex >= size || ey >= size || dist > EYE_R) continue;
        const o = (Math.floor(ey) * size + Math.floor(ex)) * 4;
        // Disque du regard (anneau vert, iris, pupille) : une seule pièce qui bouge, comme dans la série ;
        // dessous, le fond noir de l'orbite.
        if (dist <= RING_R) {
          put(irisData[eye].data, o, r, g, b);
          put(socketData[eye].data, o, 8, 10, 12);
          put(plate.data, i * 4, ...greenRGB);
          continue;
        }
        if (k === 1 && g > 205) continue; // vert franc du masque : reste sur la plaque
        put(socketData[eye].data, o, r, g, b);
        put(plate.data, i * 4, ...greenRGB); // orbite rebouchée avec le vert du masque
      }
    }
    irisData.forEach((data, eye) => {
      sockets[eye].getContext('2d').putImageData(socketData[eye], 0, 0);
      irises[eye].getContext('2d').putImageData(data, 0, 0);
    });
    const plateCanvas = canvasOf(W, H);
    plateCanvas.getContext('2d').putImageData(plate, 0, 0);
    const frontCanvas = canvasOf(W, H);
    frontCanvas.getContext('2d').putImageData(front, 0, 0);
    return { plate: plateCanvas, front: frontCanvas, sockets, irises };
  }

  // Bouche paramétrique (repère de l'image HD) : ligne de sourire (fermée) ou forme blanche pleine (ouverte), bord
  // du haut avec dent cassée, zigzag, courbure positive (sourire) ou négative (moue), « o », triangle, marches.
  function drawMouthShape(ctx, m, glitching, alpha = 1) {
    const mid = (MOUTH.x1 + MOUTH.x2) / 2;
    const half = ((MOUTH.x2 - MOUTH.x1) / 2) * m.width;
    const open = Math.max(0, m.open);
    const steps = 24;
    const top = [];
    const bottom = [];
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const arc = 4 * u * (1 - u);
      const x = mid - half + u * half * 2;
      // Ouverte, le bord du haut s'aplatit (forme en « D » de la planche).
      let y = MOUTH.y + MOUTH.depth * m.curve * arc * (1 - Math.min(1, open * 2.2) * 0.75);
      if (m.zig > 0.01) y += (i % 4 < 2 ? -1 : 1) * 7 * m.zig * Math.min(1, arc * 3) + (glitching ? (Math.random() - 0.5) * 6 * m.zig : 0);
      const drop = open * 58 * Math.sqrt(arc);
      top.push([x, y - drop * 0.5 * m.round]);
      bottom.push([x, y + drop * (1 - 0.5 * m.round)]);
    }
    // Triangle ▼ et bouche en marches : formes à part de la planche, en fondu avec la bouche dessinée.
    const tri = clamp(m.tri);
    const pixel = clamp(m.pixel);
    ctx.fillStyle = COLORS.white;
    if (tri > 0.01) {
      const s = 0.6 + tri * 0.4 + open * 0.6;
      ctx.globalAlpha = tri * alpha;
      ctx.beginPath();
      ctx.moveTo(mid - 13 * s, MOUTH.y - 8);
      ctx.lineTo(mid + 13 * s, MOUTH.y - 8);
      ctx.lineTo(mid, MOUTH.y + 16 * s);
      ctx.closePath();
      ctx.fill();
    }
    if (pixel > 0.01) {
      const jump = glitching ? Math.round((Math.random() - 0.5) * 3) * 3 : 0;
      ctx.globalAlpha = pixel * alpha;
      for (const [x, y, w, h] of [[-15, -9, 22, 8], [-28, -2, 30, 8], [6, -2, 24, 8]]) ctx.fillRect(mid + (x + jump) * m.width, MOUTH.y + y, w * m.width, h);
    }
    ctx.globalAlpha = (1 - Math.max(tri, pixel)) * alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = COLORS.white;
    ctx.lineWidth = 4.2;
    ctx.beginPath();
    top.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (open > 0.06) {
      for (let i = bottom.length - 1; i >= 0; i--) ctx.lineTo(bottom[i][0], bottom[i][1]);
      ctx.closePath();
      ctx.fill();
    }
    ctx.stroke();
    // Dent cassée : encoche noire dans le bord du haut, côté gauche.
    if (m.tooth > 0.01 && open > 0.12) {
      const k = Math.min(1, (open - 0.12) * 4) * m.tooth;
      const at = (u) => top[Math.round(u * steps)];
      const [ax, ay] = at(0.34);
      const [bx] = at(0.46);
      ctx.fillStyle = COLORS.face;
      ctx.beginPath();
      ctx.moveTo(ax, ay - 3);
      ctx.lineTo(ax + (bx - ax) * 0.35, ay + 13 * k);
      ctx.lineTo(ax + (bx - ax) * 0.55, ay + 6 * k);
      ctx.lineTo(bx, ay + 15 * k);
      ctx.lineTo(bx + 4, ay - 3);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Rendu WebGL : maillages texturés dont les sommets sont recalculés à chaque image.
  function createRenderer(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: true, alpha: false });
    const shader = (type, source) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const program = gl.createProgram();
    // Glitch : par bandes horizontales, les sommets sautent de côté.
    gl.attachShader(program, shader(gl.VERTEX_SHADER, `#version 300 es
      in vec2 aPos; in vec2 aUV;
      uniform vec4 uView; uniform float uGlitch; uniform float uSeed;
      out vec2 vUV;
      float hash(float n) { return fract(sin(n) * 43758.5453); }
      void main() {
        vec2 p = aPos;
        float band = floor(p.y / 22.0);
        p.x += step(0.72, hash(band + uSeed)) * (hash(band * 1.7 + uSeed) - 0.5) * 70.0 * uGlitch;
        vUV = aUV;
        gl_Position = vec4(p.x * uView.x + uView.y, p.y * uView.z + uView.w, 0.0, 1.0);
      }`));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      in vec2 vUV; uniform sampler2D uTex; uniform float uAlpha; uniform float uGlitch;
      out vec4 color;
      void main() {
        vec4 c = texture(uTex, vUV);
        c.rgb += vec3(0.06, -0.03, 0.09) * uGlitch * c.a;
        color = c * uAlpha;
      }`));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    const loc = {
      pos: gl.getAttribLocation(program, 'aPos'),
      uv: gl.getAttribLocation(program, 'aUV'),
      view: gl.getUniformLocation(program, 'uView'),
      glitch: gl.getUniformLocation(program, 'uGlitch'),
      seed: gl.getUniformLocation(program, 'uSeed'),
      alpha: gl.getUniformLocation(program, 'uAlpha'),
    };
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

    function upload(tex, source, mip) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      if (mip) gl.generateMipmap(gl.TEXTURE_2D);
    }
    function texture(source, mip = false) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      upload(tex, source, mip);
      return tex;
    }

    // Grille de (nx + 1) × (ny + 1) sommets sur un rectangle w × h ; `local` garde la position de repos.
    function mesh(nx, ny, w, h) {
      const n = (nx + 1) * (ny + 1);
      const local = new Float32Array(n * 2);
      const uv = new Float32Array(n * 2);
      const pos = new Float32Array(n * 2);
      const index = new Uint16Array(nx * ny * 6);
      for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
        const k = (j * (nx + 1) + i) * 2;
        local[k] = (i / nx) * w; local[k + 1] = (j / ny) * h;
        uv[k] = i / nx; uv[k + 1] = j / ny;
      }
      let t = 0;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i;
        index.set([a, a + 1, a + nx + 1, a + 1, a + nx + 2, a + nx + 1], t);
        t += 6;
      }
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const posBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(loc.pos);
      gl.vertexAttribPointer(loc.pos, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc.uv);
      gl.vertexAttribPointer(loc.uv, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      return {
        n, local, pos,
        // Place chaque sommet : f(x, y) reçoit la position de repos et renvoie [x, y] dans l'image.
        set(f) { for (let k = 0; k < n * 2; k += 2) { const p = f(local[k], local[k + 1]); pos[k] = p[0]; pos[k + 1] = p[1]; } },
        draw(tex, alpha = 1) {
          gl.bindVertexArray(vao);
          gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.uniform1f(loc.alpha, alpha);
          gl.drawElements(gl.TRIANGLES, index.length, gl.UNSIGNED_SHORT, 0);
        },
      };
    }

    function begin(glitch, seed) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(COLORS.bg[0] / 255, COLORS.bg[1] / 255, COLORS.bg[2] / 255, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniform4f(loc.view, 2 / SRC.w, -1, -2 / SRC.h, 1);
      gl.uniform1f(loc.glitch, glitch);
      gl.uniform1f(loc.seed, seed);
    }
    return { texture, upload, mesh, begin };
  }

  // --- Visage « écran » : visière plate, yeux et bouche en vectoriel (visage-plat.js), animés comme dans la vidéo ---

  const FLAT = window.CAPRI_FLAT;
  // Visière découpée à liseré violet (visage-visiere.js, d'après HVFvnXxXcAE2SVD.webp) : ses yeux et ses couleurs
  // remplacent ceux du visage plat ; les bouches restent celles de visage-plat.js (même repère).
  const VISOR = window.CAPRI_VISOR || null;
  const rgb = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  const FLAT_MOUTH = { x: 211, y: 317, scale: 1.81 }; // centre du zigzag ; bouche HD ramenée à sa largeur
  // Ce qui doit tenir à l'écran (repère 420 × 420) : la visière découpée est plus large que la bande.
  const FLAT_BOX = VISOR ? { x: -25, y: 62, w: 470, h: 350 } : { x: -20, y: 88, w: 460, h: 320 };

  // Orbite prête à déformer : contour rééchantillonné tous les 2 px, poids des pointes (elles ne se replient pas),
  // bords haut et bas par colonne.
  function prepareFlatEye(eye, index) {
    const s = eye.socket;
    const pts = [];
    for (let i = 0; i < s.length; i++) {
      const [x1, y1] = s[i];
      const [x2, y2] = s[(i + 1) % s.length];
      const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 2));
      for (let k = 0; k < n; k++) pts.push([x1 + ((x2 - x1) * k) / n, y1 + ((y2 - y1) * k) / n]);
    }
    // Pointe : sommet loin du centre dont l'angle est aigu (voisins pris à 15 px au moins).
    const neighbour = (i, step) => {
      for (let j = 1; j < s.length; j++) {
        const q = s[(i + step * j + s.length * j) % s.length];
        if (Math.hypot(q[0] - s[i][0], q[1] - s[i][1]) >= 15) return q;
      }
      return s[i];
    };
    const tips = s.filter((p, i) => {
      const a = neighbour(i, -1), b = neighbour(i, 1);
      const u = [a[0] - p[0], a[1] - p[1]], v = [b[0] - p[0], b[1] - p[1]];
      return Math.hypot(...p) > 80 && (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v)) > 0.5;
    });
    const spike = pts.map((p) => smooth(Math.max(0, ...tips.map((t) => 1 - Math.hypot(p[0] - t[0], p[1] - t[1]) / 38)) * 1.3));
    const top = new Map(), bottom = new Map();
    pts.forEach((p) => {
      const k = Math.round(p[0] / 2);
      top.set(k, Math.min(top.get(k) ?? 1e9, p[1]));
      bottom.set(k, Math.max(bottom.get(k) ?? -1e9, p[1]));
    });
    const edge = (map, x) => {
      const k = Math.round(x / 2);
      for (let d = 0; d < 40; d++) { if (map.has(k - d)) return map.get(k - d); if (map.has(k + d)) return map.get(k + d); }
      return 0;
    };
    const xs = pts.map((p) => p[0]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    // Œil fermé : un seul « U » d'un coin à l'autre, au plus bas au milieu (épaisseur 28 px), qui remonte aux coins.
    const u = { mid: edge(bottom, 0) - 28, left: edge(bottom, minX + 12) - 10, right: edge(bottom, maxX - 12) - 10 };
    const shut = (x) => { const n = x < 0 ? x / minX : x / maxX; return u.mid + ((x < 0 ? u.left : u.right) - u.mid) * n * n; };
    // Pointes en pièces séparées (suites de points de poids fort), redessinées par-dessus les paupières de la visière.
    const spikes = [];
    let run = [];
    const startAt = spike.findIndex((w) => w < 0.5);
    for (let k = 0; k <= pts.length; k++) {
      const i = (startAt + k) % pts.length;
      if (k < pts.length && spike[i] >= 0.5) run.push(pts[i]);
      else if (run.length) { if (run.length > 2) spikes.push(run); run = []; }
    }
    return { ...eye, pts, spike, spikes, top: (x) => edge(top, x), bottom: (x) => edge(bottom, x), shut, minX, maxX, side: index ? 1 : -1 };
  }

  function createScreenFace(canvas) {
    const ctx = canvas.getContext('2d');
    const eyes = (VISOR || FLAT).eyes.map(prepareFlatEye);
    const C = VISOR ? VISOR.colors : FLAT.colors;
    const [vy0, vy1] = FLAT.visor;

    // Un point de l'orbite : paupière penchée, paupière du haut (fermée : seul reste l'arc du bas, en « U »),
    // paupière du bas (plissement), puis inclinaison, taille et étirement.
    function eyePoint(e, i, pose, index, closed, squint, stretch) {
      let [x, y] = e.pts[i];
      const free = 1 - e.spike[i];
      const nx = clamp((x - (e.minX + e.maxX) / 2) / ((e.maxX - e.minX) / 2), -1, 1);
      const top = e.top(x), bot = e.bottom(x);
      if (Math.abs(pose.brow) > 0.01) {
        const inner = nx * -e.side;
        const line = top + (bot - top) * Math.abs(pose.brow) * (0.35 + 0.3 * Math.sign(pose.brow) * inner);
        if (y < line) y += (line - y) * free;
      }
      const lid = top - 2 + (e.shut(x) - top + 2) * closed;
      if (y < lid) y += (lid - y) * free;
      const low = bot + 2 + ((top + bot) / 2 - bot - 2) * squint * (1 - closed); // fermé : plus de plissement
      if (y > low) y += (Math.max(low, lid + 3) - y) * free;
      const a = (pose.eyeTilt * -e.side * Math.PI) / 180;
      const c = Math.cos(a), s = Math.sin(a);
      return [(x * c - y * s) * pose.eyeScale / (1 + stretch), (x * s + y * c) * pose.eyeScale * (1 + stretch)];
    }

    function drawEye(e, index, snap) {
      const { pose, state } = snap;
      const closed = 1 - clamp(pose.eyeOpen[index]) * (1 - state.blinkAmount);
      const squint = clamp(pose.smile[index] + state.squint[index]);
      ctx.save();
      ctx.translate(e.cx, e.cy);
      // Visière découpée : l'orbite garde sa forme et les paupières sont des pièces de visière qui descendent dessus
      // (ses orbites tourmentées se croiseraient si on les repliait) ; visage plat : l'orbite se replie.
      const lids = !!e.shift;
      const outline = e.pts.map((_, i) => eyePoint(e, i, lids ? { ...pose, brow: 0 } : pose, index, lids ? 0 : closed, lids ? 0 : squint, state.stretch[index]));
      const socketPath = () => { ctx.beginPath(); outline.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
      // Liseré violet : la même pièce, décalée, dessinée dessous (flanc en relief de l'image).
      if (e.shift) {
        ctx.save();
        ctx.translate(...e.shift.socket);
        socketPath();
        ctx.fillStyle = rgb(C.purple);
        ctx.fill();
        ctx.restore();
      }
      socketPath();
      ctx.fillStyle = rgb(C.black);
      ctx.fill();
      // Le regard (anneau, iris, pupille) se promène dans l'orbite, qui le cache quand il dépasse.
      ctx.save();
      ctx.clip();
      ctx.translate((pose.gaze[0] + state.saccade[0]) * 2.6, (pose.gaze[1] + state.saccade[1]) * 2.6);
      ctx.scale(pose.irisScale, pose.irisScale);
      const ring = (color, [dx, dy] = [0, 0]) => {
        ctx.beginPath();
        ctx.arc(dx, dy, (e.ring[0] + e.ring[1]) / 2, 0, Math.PI * 2);
        ctx.lineWidth = e.ring[1] - e.ring[0];
        ctx.strokeStyle = rgb(color);
        ctx.stroke();
      };
      const disc = (r, color, [dx, dy] = [0, 0]) => {
        ctx.beginPath();
        ctx.arc(dx, dy, r, 0, Math.PI * 2);
        ctx.fillStyle = rgb(color);
        ctx.fill();
      };
      if (e.shift) ring(C.purple, e.shift.ring);
      ring(C.green);
      if (e.shift) disc(e.iris, C.purple, e.shift.iris);
      disc(e.iris, C.blue);
      disc(e.pupil, C.white, e.pupilAt);
      ctx.restore();
      if (lids) {
        ctx.save();
        socketPath();
        ctx.clip();
        drawLids(e, pose, closed, squint * (1 - closed), state.stretch[index]);
        ctx.restore();
        // Pointes par-dessus les paupières (elles restent, comme dans la vidéo).
        ctx.fillStyle = rgb(C.black);
        for (const sp of e.spikes) {
          ctx.beginPath();
          sp.forEach(([x, y], i) => { const [u, v] = eyeTransform(x, y, pose, e, state.stretch[index]); if (i) ctx.lineTo(u, v); else ctx.moveTo(u, v); });
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.restore();
    }

    // Inclinaison, taille et étirement d'un point de l'orbite (comme eyePoint, sans les paupières).
    function eyeTransform(x, y, pose, e, stretch) {
      const a = (pose.eyeTilt * -e.side * Math.PI) / 180;
      const c = Math.cos(a), s = Math.sin(a);
      return [(x * c - y * s) * pose.eyeScale / (1 + stretch), (x * s + y * c) * pose.eyeScale * (1 + stretch)];
    }

    // Paupières de la visière découpée : celle du haut descend du bord de l'orbite jusqu'au « U » (fermée), ou se
    // penche (fâchée, triste) ; celle du bas remonte (plissement). Pièces vertes à liseré violet, dans l'orbite.
    function drawLids(e, pose, closed, squint, stretch) {
      const xs = [];
      for (let x = e.minX - 6; x <= e.maxX + 6; x += 3) xs.push(x);
      const tf = ([x, y]) => eyeTransform(x, y, pose, e, stretch);
      // Bords de l'orbite lissés (± 24 px) : la paupière descend en ligne douce, sans épouser l'arc de l'anneau.
      const smoothEdge = (edgeAt) => (x) => { let sum = 0, n = 0; for (let d = -24; d <= 24; d += 4) { sum += edgeAt(x + d); n++; } return sum / n; };
      const topAt = smoothEdge(e.top), botAt = smoothEdge(e.bottom);
      const upper = xs.map((x) => {
        const top = Math.min(e.top(x), topAt(x)), bot = botAt(x);
        let y = top - 3 + (e.shut(x) - top + 3) * closed;
        if (Math.abs(pose.brow) > 0.01) {
          const nx = clamp((x - (e.minX + e.maxX) / 2) / ((e.maxX - e.minX) / 2), -1, 1);
          y = Math.max(y, top + (bot - top) * Math.abs(pose.brow) * (0.35 + 0.3 * Math.sign(pose.brow) * nx * -e.side));
        }
        return [x, y];
      });
      const lower = xs.map((x) => { const top = topAt(x), bot = Math.max(e.bottom(x), botAt(x)); return [x, bot + 3 + ((top + bot) / 2 - bot - 3) * squint]; });
      const piece = (edge, far) => {
        ctx.beginPath();
        const [x0] = edge[0], [x1] = edge[edge.length - 1];
        [[x0, far], ...edge, [x1, far]].map(tf).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
      };
      const [dx, dy] = e.shift.socket;
      for (const [edge, far] of [[upper, -400], [lower, 400]]) {
        // Liseré : la pièce décalée comme le flanc de l'orbite, en violet, puis la pièce verte.
        ctx.save();
        ctx.translate(-dx, -dy);
        piece(edge, far);
        ctx.fillStyle = rgb(C.purple);
        ctx.fill();
        ctx.restore();
        piece(edge, far);
        ctx.fillStyle = rgb(C.green);
        ctx.fill();
      }
    }

    const path = (pts) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };

    // Bouche : formes relevées sur les images (zigzag, ouverte à la dent, cri) et, pour le reste (sourire, moue,
    // trait, « o », marches), la bouche paramétrique ramenée à la taille du zigzag.
    function drawMouth(m, glitching) {
      const open = smooth((m.open - 0.08) / 0.2) * (1 - clamp(m.round)) * (1 - clamp(m.tri));
      const zig = clamp(m.zig * 1.5) * (1 - open);
      const tri = clamp(m.tri);
      const rest = clamp(1 - open - zig - tri);
      if (rest > 0.01) {
        ctx.save();
        ctx.translate(FLAT_MOUTH.x, FLAT_MOUTH.y);
        ctx.scale(FLAT_MOUTH.scale, FLAT_MOUTH.scale);
        ctx.translate(-(MOUTH.x1 + MOUTH.x2) / 2, -MOUTH.y);
        drawMouthShape(ctx, { ...m, zig: 0, tri: 0, tooth: 0, open: m.round > 0.3 ? m.open : 0 }, glitching, rest);
        ctx.restore();
      }
      ctx.save();
      ctx.fillStyle = rgb(FLAT.colors.white);
      if (open > 0.01) {
        // S'ouvre vers le bas depuis son bord du haut, selon la parole.
        const k = clamp(0.3 + (m.open / 0.75) * 0.7, 0.3, 1.1);
        ctx.globalAlpha = open;
        ctx.translate(0, 300);
        ctx.scale(1, k);
        ctx.translate(0, -300);
        path(FLAT.open);
        ctx.fill();
      }
      ctx.restore();
      if (zig > 0.01) {
        ctx.save();
        ctx.globalAlpha = zig;
        ctx.beginPath();
        FLAT.zigzag.points.forEach(([x, y], i) => {
          const j = glitching ? (Math.random() - 0.5) * 6 : 0;
          if (i) ctx.lineTo(x, y + j); else ctx.moveTo(x, y + j);
        });
        ctx.lineWidth = FLAT.zigzag.width;
        ctx.lineJoin = 'miter';
        ctx.strokeStyle = rgb(FLAT.colors.white);
        ctx.stroke();
        ctx.restore();
      }
      if (tri > 0.01) {
        const k = 0.5 + clamp(m.open) * 0.5;
        ctx.save();
        ctx.globalAlpha = tri;
        ctx.translate(210, 296);
        ctx.scale(k, k);
        ctx.translate(-210, -296);
        path(FLAT.shout.outer);
        ctx.fillStyle = rgb(FLAT.colors.green);
        ctx.fill();
        path(FLAT.shout.inner);
        ctx.fillStyle = rgb(FLAT.colors.white);
        ctx.fill();
        ctx.restore();
      }
    }

    function heart(x, y, size, alpha) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(size, size);
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.moveTo(0, 4);
      ctx.bezierCurveTo(-8, -4, -14, 6, 0, 14);
      ctx.bezierCurveTo(14, 6, 8, -4, 0, 4);
      ctx.strokeStyle = '#ffb3e0';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    return {
      draw(snap) {
        const { pose, state, glitching, particles } = snap;
        // Canevas à la taille de sa place, en pixels réels.
        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
        const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.fillStyle = rgb(VISOR ? C.background : FLAT.colors.black);
        ctx.fillRect(0, 0, w, h);
        const s = Math.min(w / FLAT_BOX.w, h / FLAT_BOX.h);
        ctx.translate(w / 2, h / 2);
        ctx.scale(s, s);
        ctx.translate(-(FLAT_BOX.x + FLAT_BOX.w / 2), -(FLAT_BOX.y + FLAT_BOX.h / 2));
        // Tête : glisse et penche ; yeux et bouche avancent un peu plus (profondeur).
        const hd = state.head;
        ctx.translate(210, 210);
        ctx.rotate((hd.angleZ * 0.4 * Math.PI) / 180);
        ctx.translate(-210 + hd.angleX * 10, -210 + hd.angleY * 8 + hd.bob * 0.6);
        if (VISOR) {
          // Visière découpée : copie violette décalée (liseré), puis le vert.
          const shape = (dx, dy) => { ctx.beginPath(); VISOR.visor.shape.forEach(([x, y], i) => (i ? ctx.lineTo(x + dx, y + dy) : ctx.moveTo(x + dx, y + dy))); ctx.closePath(); };
          shape(...VISOR.visor.shift);
          ctx.fillStyle = rgb(C.purple);
          ctx.fill();
          shape(0, 0);
          ctx.fillStyle = rgb(C.green);
          ctx.fill();
        } else {
          ctx.fillStyle = rgb(FLAT.colors.green);
          ctx.fillRect(-4000, vy0, 8420, vy1 - vy0);
        }
        ctx.save();
        ctx.translate(hd.angleX * 7, hd.angleY * 5);
        eyes.forEach((e, i) => drawEye(e, i, snap));
        ctx.restore();
        ctx.save();
        ctx.translate(hd.angleX * 6, hd.angleY * 4);
        drawMouth(pose.mouth, glitching);
        ctx.restore();
        // Cœurs (positions de l'image HD ramenées autour du visage).
        for (const p of particles) heart(210 + (p.x - HEAD.x) * 0.4, 200 + (p.y - HEAD.y) * 0.4, p.s * 0.8, Math.sin(Math.min(1, p.life / p.max) * Math.PI));
        // Glitch : bandes décalées.
        if (state.glitch > 0.05) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          for (let i = 0; i < 6; i++) {
            const y = Math.random() * h;
            const bh = 6 + Math.random() * h * 0.06;
            ctx.drawImage(canvas, 0, y, w, bh, (Math.random() - 0.5) * w * 0.06 * state.glitch, y, w, bh);
          }
        }
      },
    };
  }

  // Deux visages pour un même moteur : « hd » (l'image HD en rig WebGL) et « ecran » (visière plate vectorielle).
  function createCapri(host, style = 'ecran') {
    const canvas = canvasOf(SRC.w, SRC.h);
    canvas.className = 'capri-canvas';
    canvas.setAttribute('aria-label', 'CAPRI');
    host.appendChild(canvas);
    const r = createRenderer(canvas);
    const screenCanvas = document.createElement('canvas');
    screenCanvas.className = 'capri-screen';
    screenCanvas.setAttribute('aria-label', 'CAPRI');
    host.appendChild(screenCanvas);
    const screen = createScreenFace(screenCanvas);
    // Visage fait des images de Tommy (visage-sprites.js) ; le visage vectoriel sert le temps du chargement.
    const sprites = window.createCapriSpriteFace
      ? window.createCapriSpriteFace(screenCanvas, { drawMouthShape, MOUTH, HEAD, background: VISOR ? VISOR.colors.background : [27, 46, 54] })
      : null;
    const showStyle = () => { canvas.hidden = style !== 'hd'; screenCanvas.hidden = style === 'hd'; };
    showStyle();

    // Le cœur dessiné une fois, pour les particules.
    const heart = canvasOf(64, 64);
    {
      const h = heart.getContext('2d');
      h.translate(32, 18);
      h.scale(2.6, 2.6);
      h.beginPath();
      h.moveTo(0, 4);
      h.bezierCurveTo(-8, -4, -14, 6, 0, 14);
      h.bezierCurveTo(14, 6, 8, -4, 0, 4);
      h.strokeStyle = '#ffb3e0';
      h.lineWidth = 2;
      h.stroke();
    }

    // Pièces et maillages (créés une fois l'image chargée).
    let rig = null;
    const base = new Image();
    base.onload = () => {
      const parts = buildRig(base);
      const eyeCanvases = EYES.map(() => canvasOf(EYE_R * 2, EYE_R * 2));
      const mouthCanvas = canvasOf(MOUTH_BOX.w, MOUTH_BOX.h);
      rig = {
        parts, eyeCanvases, mouthCanvas,
        tex: {
          base: r.texture(base, true),
          plate: r.texture(parts.plate, true),
          front: r.texture(parts.front, true),
          eyes: eyeCanvases.map((c) => r.texture(c)),
          mouth: r.texture(mouthCanvas),
          heart: r.texture(heart),
        },
        mesh: {
          base: r.mesh(72, 38, SRC.w, SRC.h),
          plate: r.mesh(24, 16, FACE.w, FACE.h),
          front: r.mesh(24, 16, FACE.w, FACE.h),
          eyes: EYES.map(() => r.mesh(16, 16, EYE_R * 2, EYE_R * 2)),
          mouth: r.mesh(12, 10, MOUTH_BOX.w, MOUTH_BOX.h),
          quad: r.mesh(1, 1, 1, 1),
        },
      };
    };
    base.src = 'capri.png';

    const now0 = performance.now();
    const state = {
      mode: 'idle', mood: null, moodUntil: 0, moodStart: 0, talk: 0, talkTarget: 0, talkAt: 0,
      activity: null, fx: { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, jx: 0, jy: 0 },
      blinkStart: -1, blinkAt: now0 + 2500, glitchUntil: 0, glitch: 0,
      saccade: [0, 0], saccadeAt: 0, squint: [0, 0], stretch: [0, 0],
      turn: 0, turnAt: now0 + 3000, // tête tournée à gauche (-) ou à droite (+), de temps en temps
      pose: clone(POSES.neutre), vel: zeroed(POSES.neutre),
      // Physique de la chevelure : angle (degrés) et vitesse de chaque pendule.
      hair: { left: [0, 0], right: [0, 0], top: [0, 0], fringe: [0, 0] },
      prev: { angleX: 0, angleZ: 0, angleY: 0 },
      head: { angleX: 0, angleY: 0, angleZ: 0, bob: 0, zoom: 1 },
      last: now0,
    };
    const particles = [];
    // Petits signes qui sortent d'elle (coordonnées de l'image HD) : étincelle, note, « z », « ! »,
    // veine de colère, goutte.
    const spawn = (kind, n = 1) => {
      for (let i = 0; i < n; i++) {
        const r = Math.random();
        const p = { kind, x: HEAD.x, y: HEAD.y, vx: 0, vy: 0, life: 0, max: 120, s: 1.6 + r * 1.2 };
        if (kind === 'note') Object.assign(p, { x: HEAD.x + 380 + r * 90, y: HEAD.y + 250, vx: 0.8 + r * 0.8, vy: -1.6 - r, max: 90 });
        if (kind === 'z') Object.assign(p, { x: HEAD.x + 420, y: HEAD.y - 250, vx: 1.1, vy: -1.2, max: 110, s: 1.6 });
        if (kind === 'idee') Object.assign(p, { x: HEAD.x + 420, y: HEAD.y - 330, vy: -0.25, max: 70, s: 2.4 });
        if (kind === 'veine') Object.assign(p, { x: HEAD.x + 380, y: HEAD.y - 310, max: 90, s: 2.4 });
        // Étincelles : au-dessus de la visière ou de part et d'autre de la bouche, jamais sur les yeux.
        if (kind === 'etoile') Object.assign(p, { x: HEAD.x + (r < 0.5 ? -1 : 1) * (320 + Math.random() * 330), y: Math.random() < 0.5 ? HEAD.y - 330 - Math.random() * 60 : HEAD.y + 300 + Math.random() * 150, vx: (Math.random() - 0.5) * 0.6, vy: -0.4 - Math.random() * 0.6, max: 45 + Math.random() * 30, s: 1.2 + Math.random() * 1.2 });
        if (kind === 'goutte') Object.assign(p, { x: HEAD.x + 470, y: HEAD.y - 160, vy: 0.9, max: 60, s: 2.2 });
        particles.push(p);
      }
    };

    const api = {
      setMode(mode) {
        state.mode = mode;
        if (mode !== 'speaking') state.talkTarget = 0;
        if (mode !== 'idle') state.activity = null; // Tommy lui parle : elle lâche ce qu'elle faisait
      },
      // Activité de repos (ACTIVITIES) ; sans nom, une au hasard. Rend le nom joué, ou null si elle est occupée.
      activity(name) {
        if (state.mode !== 'idle' || state.activity) return null;
        const names = Object.keys(ACTIVITIES);
        const key = ACTIVITIES[name] ? name : names[Math.floor(Math.random() * names.length)];
        const t = performance.now();
        state.activity = { name: key, steps: ACTIVITIES[key](), i: -1, stepAt: t, stepAt0: t, spawnAt: 0, glitchAt: 0 };
        state.moodUntil = 0;
        return key;
      },
      get activities() { return Object.keys(ACTIVITIES); },
      get state() { return state; }, // diagnostic (outils d'analyse de l'animation)
      get moods() { return Object.keys(POSES); },
      talk(level = 0.6) { state.talkAt = performance.now(); state.talkTarget = Math.min(1, Math.max(0.2, level)); },
      // Humeur passagère ; `duration` (ms) la prolonge (bouderie) ou, à 0, la termine.
      mood(name, duration) {
        if (!POSES[name]) return;
        const t = performance.now();
        // Les signes de l'humeur précédente (étincelles, veine…) s'effacent vite au lieu de traîner sur la nouvelle.
        for (const p of particles) p.max = Math.min(p.max, p.life + 12);
        state.mood = name;
        state.moodStart = t;
        state.moodUntil = t + (duration ?? (name === 'glitch' ? 900 : 2600));
        if (name === 'glitch') state.glitchUntil = t + 420;
        // Pas de cœurs (retirés à la demande de Tommy) : des étincelles à la place.
        spawn('etoile', name === 'excitee' ? 10 : name === 'joie' || name === 'rire' || name === 'fierte' || name === 'coeur' ? 6 : name === 'surprise' ? 4 : 0);
        if (name === 'colere' || name === 'fache') spawn('veine');
        if (name === 'peur' || name === 'gene') spawn('goutte');
        if (name === 'excitee' || name === 'surprise') spawn('idee');
      },
      blink() { state.blinkStart = performance.now(); },
      setStyle(name) { style = name === 'hd' ? 'hd' : 'ecran'; showStyle(); },
      get style() { return style; },
      glitch(ms = 300) { state.glitchUntil = performance.now() + ms; },
    };

    // --- Déformations (toutes en coordonnées de l'image) ---

    // Chevelure : chaque sommet tourne autour du centre du visage selon les pendules gauche, droite et haut,
    // d'autant plus qu'il est loin (le visage ne bouge pas, les pointes beaucoup).
    function hairSway(x, y) {
      const dx = x - HEAD.x;
      const dy = y - HEAD.y;
      const dist = Math.hypot(dx, dy * 1.2) || 1;
      const w = smooth((dist - 190) / 520);
      if (!w) return [x, y];
      const h = state.hair;
      const angle = (h.left[0] * Math.max(0, -dx / dist) + h.right[0] * Math.max(0, dx / dist) + h.top[0] * Math.max(0, -dy / dist)) * w * (Math.PI / 180);
      const c = Math.cos(angle), s = Math.sin(angle);
      return [HEAD.x + dx * c - dy * s, HEAD.y + dx * s + dy * c];
    }

    // Tête : rotation 2,5D (le centre du visage avance plus que les bords, chaque pièce selon sa profondeur),
    // puis inclinaison autour du cou, balancement et zoom.
    function headPose(x, y, depth) {
      const hd = state.head;
      const bx = (x - HEAD.x) / 270;
      const by = (y - HEAD.y) / 230;
      const bulge = smooth(1 - bx * bx - by * by);
      x += hd.angleX * (depth + 16 * bulge);
      y += hd.angleY * (depth * 0.7 + 11 * bulge);
      const a = (hd.angleZ * Math.PI) / 180;
      const c = Math.cos(a), s = Math.sin(a);
      const rx = x - NECK.x, ry = y - NECK.y;
      x = NECK.x + (rx * c - ry * s) * hd.zoom;
      y = NECK.y + (rx * s + ry * c) * hd.zoom + hd.bob;
      return [x, y];
    }

    // Ouverture d'un œil (paupière du haut) : 1 ouvert, 0 fermé.
    const eyeOpenness = (pose, index) => clamp(pose.eyeOpen[index]) * (1 - state.blinkAmount);

    // Œil, d'après la vidéo de la série : la paupière du haut descend en courbe et, fermée, ne laisse que l'arc
    // noir du bas en « U » ; les pointes restent dehors. La paupière du bas remonte en dôme (œil plissé, rieur),
    // et une paupière peut pencher (fâchée, triste). Puis taille, étirement et inclinaison autour du centre.
    function eyeShape(lx, ly, index, pose) {
      const eye = EYES[index];
      const R = EYE_R;
      const nx = clamp((lx - R) / R, -1, 1);
      const spikes = 1 - smooth((Math.abs(nx) - 0.72) / 0.28); // les coins (pointes) ne sont pas repliés
      const closed = 1 - eyeOpenness(pose, index);
      // Paupière penchée (fâchée : plus bas côté intérieur ; triste : côté extérieur).
      const brow = pose.brow;
      if (Math.abs(brow) > 0.01) {
        const inner = nx * -eye.side;
        const browLine = R * Math.abs(brow) * (0.45 + 0.35 * Math.sign(brow) * inner);
        if (ly < browLine) ly += (browLine - ly) * spikes;
      }
      // Paupière du haut.
      const shut = R + R * (0.04 + 0.3 * (1 - nx * nx));
      const top = -0.05 * R + (shut + 0.05 * R) * closed;
      if (ly < top) ly += (top - ly) * spikes;
      // Paupière du bas (plissement).
      const squint = clamp(pose.smile[index] + state.squint[index]);
      const bottom = 2.05 * R + (R * (1.15 - 0.3 * (1 - nx * nx)) - 2.05 * R) * squint;
      if (ly > bottom) ly += (Math.max(bottom, top + 2) - ly) * spikes;
      let x = lx - R;
      let y = ly - R;
      const tilt = (pose.eyeTilt * -eye.side * Math.PI) / 180;
      const c = Math.cos(tilt), s = Math.sin(tilt);
      const stretch = 1 + state.stretch[index];
      [x, y] = [(x * c - y * s) * pose.eyeScale / stretch, (x * s + y * c) * pose.eyeScale * stretch];
      return [eye.cx + x, eye.cy + y];
    }

    // Œil recomposé : orbite, disque du regard (anneau + iris) qui se promène dedans, lueur.
    function paintEye(index, pose, t) {
      const e = rig.eyeCanvases[index].getContext('2d');
      const open = eyeOpenness(pose, index);
      const gx = (pose.gaze[0] + state.saccade[0]) * GAZE;
      const gy = (pose.gaze[1] + state.saccade[1]) * GAZE;
      e.globalCompositeOperation = 'source-over';
      e.globalAlpha = 1;
      e.clearRect(0, 0, EYE_R * 2, EYE_R * 2);
      e.drawImage(rig.parts.sockets[index], 0, 0);
      e.globalCompositeOperation = 'source-atop';
      e.globalAlpha = smooth((open - 0.05) / 0.2);
      e.save();
      e.translate(EYE_R + gx, EYE_R + gy);
      e.scale(pose.irisScale, pose.irisScale);
      e.drawImage(rig.parts.irises[index], -EYE_R, -EYE_R);
      e.restore();
      const glow = state.mode === 'thinking' ? 0.3 + Math.sin(t * 8) * 0.18 : state.mode === 'speaking' ? 0.2 : 0.06 + Math.sin(t * 2) * 0.04;
      const gradient = e.createRadialGradient(EYE_R + gx, EYE_R + gy, 0, EYE_R + gx, EYE_R + gy, 34);
      gradient.addColorStop(0, `rgba(90, 160, 255, ${glow})`);
      gradient.addColorStop(1, 'rgba(90, 160, 255, 0)');
      e.globalCompositeOperation = 'lighter';
      e.fillStyle = gradient;
      e.fillRect(0, 0, EYE_R * 2, EYE_R * 2);
      r.upload(rig.tex.eyes[index], rig.eyeCanvases[index], false);
    }

    // Bouche de l'image HD, dessinée dans sa texture.
    function paintMouth(m, glitching) {
      const ctx = rig.mouthCanvas.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, MOUTH_BOX.w, MOUTH_BOX.h);
      ctx.translate(-MOUTH_BOX.x, -MOUTH_BOX.y);
      drawMouthShape(ctx, m, glitching);
      r.upload(rig.tex.mouth, rig.mouthCanvas, false);
    }

    const frame = (now) => {
      requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - state.last) / 1000);
      state.last = now;
      const t = now / 1000;
      const mood = now < state.moodUntil ? state.mood : null;
      const thinking = state.mode === 'thinking';
      const listening = state.mode === 'listening';
      const speaking = state.mode === 'speaking';

      // Activité de repos : on passe d'une étape à l'autre ; à chaque étape, ses signes, glitchs et clignement.
      const act = state.activity;
      let step = null;
      if (act) {
        while (act.i < 0 || (act.steps[act.i] && now - act.stepAt > act.steps[act.i].ms)) {
          if (act.i >= 0) act.stepAt += act.steps[act.i].ms;
          act.i += 1;
          const s = act.steps[act.i];
          if (!s) break;
          if (s.glitch) state.glitchUntil = now + s.glitch;
          if (s.blink) state.blinkStart = now;
          if (s.spawn && !s.every) spawn(s.spawn);
        }
        step = act.steps[act.i] || null;
        if (!step) state.activity = null;
        else {
          if (step.every && now - act.spawnAt > step.every) { act.spawnAt = now; spawn(step.spawn); }
          if (step.glitchEvery && now - act.glitchAt > step.glitchEvery) { act.glitchAt = now; state.glitchUntil = now + 90; }
        }
      }

      // Pose visée (humeur, sinon activité, sinon état), avec la parole qui ouvre la bouche, puis les ressorts.
      const busyStep = !mood && step;
      const name = mood || (busyStep ? step.pose : thinking ? 'reflexion' : listening ? 'ecoute' : speaking ? 'parle' : 'neutre');
      const target = clone(POSES[name]);
      if (busyStep && step.gaze) target.gaze = typeof step.gaze === 'function' ? step.gaze((now - act.stepAt) / step.ms) : step.gaze;
      // Mouvement du visage entier (rebond, tremblement, danse…).
      const fx = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, jx: 0, jy: 0 };
      const effect = EFFECTS[busyStep ? step.fx || step.pose : name];
      if (effect) effect(fx, t, busyStep ? now - act.stepAt : now - state.moodStart);
      for (const k of ['dx', 'dy', 'rot', 'sx', 'sy']) state.fx[k] += (fx[k] - state.fx[k]) * (step?.fx === 'sursaut' ? 0.6 : 0.25);
      state.fx.jx = fx.jx; // tremblement : direct
      state.fx.jy = fx.jy;
      if (speaking && now - state.talkAt > 110) state.talkTarget *= 0.55;
      state.talk += (state.talkTarget - state.talk) * 0.4;
      if (speaking || state.talk > 0.02) {
        // Petites syllabes : le triangle ; grandes : la bouche ouverte à la dent.
        target.mouth.open = Math.max(target.mouth.open, state.talk * 0.9);
        // Forme tenue au moins 90 ms : sinon elle change à chaque image (triangle / ouverte) et la bouche clignote.
        if (name === 'parle') {
          const tri = state.talk > 0.15 && state.talk < 0.5 ? 1 : 0;
          if (tri !== state.triShape && now - (state.triAt || 0) > 90) { state.triShape = tri; state.triAt = now; }
          target.mouth.tri = state.triShape || 0;
        }
      }
      if (name === 'rire') { target.mouth.open = 0.45 + Math.abs(Math.sin(t * 15)) * 0.45; target.angleZ += Math.sin(t * 18) * 2.5; }
      // Elle tourne la tête à gauche ou à droite de temps en temps (Tommy), le regard en avance sur la tête ; moins
      // quand elle parle (elle reste tournée vers Tommy), pas pendant les activités qui ont leur propre regard.
      if (now > state.turnAt) {
        state.turn = Math.random() < 0.4 ? 0 : (Math.random() < 0.5 ? -1 : 1) * (0.55 + Math.random() * 0.45);
        state.turnAt = now + (state.turn ? 1400 + Math.random() * 2600 : 2500 + Math.random() * 4500);
      }
      const turn = busyStep && step.gaze ? 0 : state.turn * (speaking ? 0.45 : 1);
      target.angleX += turn * 1.4;
      target.gaze = [target.gaze[0] + turn * 9, target.gaze[1]];
      // Mouvements de repos : la tête n'est jamais figée.
      target.angleX += noise(t * 1.6, 1) * 0.35;
      target.angleY += noise(t * 1.6, 2) * 0.2 + state.talk * 0.2;
      target.angleZ += noise(t * 1.6, 3) * 2.4;
      const { mouth, ...rest } = target;
      state.target = target; // le visage en images anime ses yeux lui-même vers cette pose (Motion)
      spring(state.pose, state.vel, rest, 70, dt);
      spring(state.pose.mouth, state.vel.mouth, mouth, speaking || name === 'rire' ? 600 : 160, dt);
      const pose = state.pose;

      // Clignement : fermeture vive, réouverture plus lente ; regard qui saute d'un point à l'autre.
      if (now > state.blinkAt) { state.blinkStart = now; state.blinkAt = now + 2200 + Math.random() * 4000; }
      const b = (now - state.blinkStart) / 1000;
      state.blinkAmount = b < 0 ? 0 : b < 0.09 ? smooth(b / 0.09) : b < 0.14 ? 1 : b < 0.3 ? 1 - smooth((b - 0.14) / 0.16) : 0;
      // Les deux yeux ne sont jamais tout à fait pareils : plissement et étirement qui varient chacun de leur côté.
      state.squint = [Math.max(0, noise(t * 0.8, 11)) * 0.18, Math.max(0, noise(t * 0.8, 12)) * 0.18];
      state.stretch = [noise(t * 0.9, 13) * 0.05, noise(t * 0.9, 14) * 0.05];
      if (now > state.saccadeAt) {
        state.saccadeTarget = (name === 'neutre' || name === 'ecoute') && !(busyStep && step.gaze) ? [(Math.random() - 0.5) * 24, (Math.random() - 0.5) * 13] : [0, 0];
        state.saccadeAt = now + 350 + Math.random() * 1100; // regard vif : elle ne tient pas en place
      }
      if (state.saccadeTarget) state.saccade = state.saccade.map((v, i) => v + (state.saccadeTarget[i] - v) * 0.35);

      // Tête : angles du rig, respiration, zoom quand elle écoute.
      const hd = state.head;
      hd.angleX = pose.angleX;
      hd.angleY = pose.angleY;
      hd.angleZ = pose.angleZ;
      hd.bob = Math.sin(t * 1.7) * 4 - pose.angleY * 6;
      hd.zoom = 1 + Math.sin(t * 1.7) * 0.004 + (listening ? 0.015 : 0);

      // Physique des cheveux : les pendules reçoivent les accélérations de la tête, plus un souffle d'air.
      const vX = (pose.angleX - state.prev.angleX) / dt;
      const vZ = (pose.angleZ - state.prev.angleZ) / dt;
      const vY = (pose.angleY - state.prev.angleY) / dt;
      state.prev = { angleX: pose.angleX, angleY: pose.angleY, angleZ: pose.angleZ };
      const energy = thinking ? 1.8 : mood ? 1.4 : 1;
      const pendulum = (p, push, stiff, wind) => {
        const a = -stiff * p[0] - 2 * 0.35 * Math.sqrt(stiff) * p[1] - push + wind;
        p[1] += a * dt;
        p[0] += p[1] * dt;
      };
      const h = state.hair;
      pendulum(h.left, vZ * 6 + vX * 30, 26, noise(t * 1.6 * energy, 5) * 30 * energy);
      pendulum(h.right, vZ * 6 + vX * 30, 22, noise(t * 1.5 * energy, 6) * 30 * energy);
      pendulum(h.top, vZ * 5 - vY * 20, 30, noise(t * 1.3 * energy, 7) * 22 * energy);
      pendulum(h.fringe, vZ * 9 + vX * 45, 40, noise(t * 2 * energy, 8) * 35 * energy);

      // Plus de glitch au hasard (réflexion, repos, colère) : à l'écran il passait pour un bug d'affichage (Tommy).
      // Il ne vient que de la balise [glitch] et du démarrage.
      const glitching = now < state.glitchUntil || name === 'glitch';
      state.glitch += ((now < state.glitchUntil ? 1 : 0) - state.glitch) * 0.5;

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life += 1; p.x += p.vx; p.y += p.vy;
        if (p.life >= p.max) particles.splice(i, 1);
      }

      if (style === 'ecran') { (sprites && sprites.ready ? sprites : screen).draw({ pose, state, glitching, particles }); return; }
      if (!rig) return;
      // Maillages : image entière (chevelure + visage), plaque, yeux, bouche, mèches de devant.
      const M = rig.mesh;
      M.base.set((x, y) => { const p = hairSway(x, y); return headPose(p[0], p[1], 0); });
      M.plate.set((x, y) => { const p = hairSway(FACE.x + x, FACE.y + y); return headPose(p[0], p[1], 0); });
      M.front.set((x, y) => {
        // Mèches : en plus de la chevelure, elles se balancent depuis le haut du crâne et avancent plus.
        let [px, py] = hairSway(FACE.x + x, FACE.y + y);
        const w = smooth((py - FRINGE_ROOT.y) / 220);
        const a = (h.fringe[0] * w * Math.PI) / 180;
        const dx = px - FRINGE_ROOT.x, dy = py - FRINGE_ROOT.y;
        px = FRINGE_ROOT.x + dx * Math.cos(a) - dy * Math.sin(a);
        py = FRINGE_ROOT.y + dx * Math.sin(a) + dy * Math.cos(a);
        return headPose(px, py, 14);
      });
      EYES.forEach((_, i) => M.eyes[i].set((x, y) => { const p = eyeShape(x, y, i, pose); return headPose(p[0], p[1], 10); }));
      M.mouth.set((x, y) => headPose(MOUTH_BOX.x + x, MOUTH_BOX.y + y, 8));

      EYES.forEach((_, i) => paintEye(i, pose, t));
      paintMouth(pose.mouth, glitching);

      r.begin(state.glitch, Math.floor(t * 30));
      M.base.draw(rig.tex.base);
      M.plate.draw(rig.tex.plate);
      EYES.forEach((_, i) => M.eyes[i].draw(rig.tex.eyes[i]));
      M.mouth.draw(rig.tex.mouth);
      M.front.draw(rig.tex.front);

      // Cœurs.
      for (const p of particles) {
        const size = 26 * p.s;
        M.quad.set((x, y) => [p.x + (x - 0.5) * size, p.y + (y - 0.5) * size]);
        M.quad.draw(rig.tex.heart, Math.sin(Math.min(1, p.life / p.max) * Math.PI));
      }
    };
    requestAnimationFrame(frame);
    return api;
  }

  window.createCapri = createCapri;
  // Pour tools/build-psd.cjs (PSD de départ pour Live2D Cubism) : mêmes découpes et mêmes bouches.
  window.CAPRI_PIECES = { SRC, FACE, EYES, EYE_R, RING_R, MOUTH, POSES, buildRig, drawMouthShape };
})();
