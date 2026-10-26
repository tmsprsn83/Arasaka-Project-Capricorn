// Démarrage Arasaka façon Cyberpunk 2077, avant de laisser la place à CAPRI (environ 8 s, un clic ou une touche
// abrège). Tous les mouvements sont faits par Motion (motion.js) :
//   1. allumage de tube : un trait blanc qui s'ouvre, l'écran qui papillote, le cadre qui se pose ;
//   2. l'emblème Arasaka qui se trace (anneau, tronc, branches, puis les trois cercles en ressort), « ARASAKA »
//      lettre par lettre, la ligne de la corporation ;
//   3. l'emblème remonte, « PROJET CAPRICORN » arrive en glitch, étiquettes, barre de chargement, journal ;
//   4. déchirure façon Blackwall (bandes rouges, décalages), puis CAPRI apparaît (app.js la fait glitcher).
// Bruit, balayage et bandes de glitch sont dessinés sur un canevas.
(function () {
  const root = document.getElementById('boot');
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  window.CapriBoot = { done };
  if (!root) { resolveDone(); return; }
  const M = window.Motion;
  if (!M || !M.animate) { resolveDone(); root.remove(); return; }

  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => [...root.querySelectorAll(sel)];
  const rand = (n) => Math.floor(Math.random() * n);
  let skipped = false;
  const speed = () => (skipped ? 0.12 : 1);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms * speed()));
  const stagger = (d) => (M.stagger ? M.stagger(d * speed()) : (i) => i * d * speed());
  // Animation Motion dont la durée suit l'abrègement ; renvoie une promesse de fin.
  const play = (el, keyframes, options = {}) => M.animate(el, keyframes, {
    ...options,
    ...(options.type === 'spring' ? {} : { duration: (options.duration ?? 0.4) * speed() }),
    delay: typeof options.delay === 'number' ? options.delay * speed() : options.delay,
  }).finished;

  // Canevas : grain, balayage rouge qui descend, bandes de glitch dont l'intensité suit `glitch`.
  const canvas = $('.boot-noise');
  const ctx = canvas.getContext('2d');
  let glitch = 0;
  const resize = () => { canvas.width = Math.ceil(innerWidth / 2); canvas.height = Math.ceil(innerHeight / 2); };
  resize();
  addEventListener('resize', resize);
  let running = true;
  const frame = (now) => {
    if (!running) return;
    const { width: w, height: h } = canvas;
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < 220; i++) {
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.06})`;
      ctx.fillRect(rand(w), rand(h), 1, 1);
    }
    const sweep = ((now / 3200) % 1) * (h + 80) - 40;
    const g = ctx.createLinearGradient(0, sweep - 40, 0, sweep + 40);
    g.addColorStop(0, 'rgba(248,0,48,0)');
    g.addColorStop(0.5, 'rgba(248,0,48,0.06)');
    g.addColorStop(1, 'rgba(248,0,48,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, sweep - 40, w, 80);
    const bands = Math.round(glitch * 12 + (Math.random() < 0.03 ? 2 : 0));
    for (let i = 0; i < bands; i++) {
      ctx.fillStyle = Math.random() < 0.75 ? `rgba(248,0,48,${0.25 + Math.random() * 0.45})` : 'rgba(94,246,255,0.3)';
      ctx.fillRect(rand(w) - w / 4, rand(h), w * (0.2 + Math.random() * 0.8), 1 + rand(5 + glitch * 10));
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  const spike = async (level, ms) => { glitch = level; await wait(ms); glitch = 0.04; };

  // Vidage hexadécimal du pied de page.
  const hex = $('.boot-hex');
  let address = 0x7f3a0000;
  const hexTimer = setInterval(() => {
    hex.textContent = `0x${address.toString(16).toUpperCase()} ${Array.from({ length: 6 }, () => rand(256).toString(16).toUpperCase().padStart(2, '0')).join(' ')}`;
    address += 16;
  }, 60);

  // Journal technique (bas gauche) : vraies valeurs de la machine quand la page les connaît.
  const log = $('.boot-log');
  const LINES = [
    ['AUTHENTIFICATION ARASAKA', 'OK'],
    [`PROCESSEUR ${navigator.hardwareConcurrency || 8} FILS`, 'OK'],
    [`AFFICHAGE ${screen.width || innerWidth}×${screen.height || innerHeight}`, 'OK'],
    ['MONTAGE /memoire [OBSIDIAN]', 'OK'],
    ['LIAISON NOYAU CLAUDE', 'ÉTABLIE'],
    ['MATRICE C.A.P.R.I.', 'PRÊTE'],
  ];
  const addLine = ([text, state]) => {
    const line = document.createElement('div');
    line.innerHTML = `${text} <b>[${state}]</b>`;
    log.appendChild(line);
    while (log.childElementCount > 4) log.firstChild.remove();
    M.animate(line, { opacity: [0, 1], x: [-8, 0] }, { duration: 0.2 * speed() });
  };

  const skip = () => { skipped = true; };
  addEventListener('keydown', skip, { once: true });
  root.addEventListener('pointerdown', skip, { once: true });

  async function run() {
    // Emblème masqué (traits non tracés) avant que l'écran s'allume : sinon il apparaît entier une image si la page
    // est occupée au moment de le masquer.
    const ring = $('.boot-emblem .ring');
    const C = 2 * Math.PI * 295.5;
    ring.style.strokeDasharray = `${C}`;
    ring.style.strokeDashoffset = `${C}`;
    $$('.boot-emblem .branch').forEach((b) => { b.style.strokeDasharray = '230'; b.style.strokeDashoffset = '230'; });

    // 1. Allumage.
    const power = $('.boot-power');
    await play(power, { transform: ['scaleY(0.003) scaleX(0)', 'scaleY(0.003) scaleX(1)'] }, { duration: 0.22, ease: [0.2, 0.8, 0.2, 1] });
    await play(power, { transform: ['scaleY(0.003) scaleX(1)', 'scaleY(1) scaleX(1)'], opacity: [1, 0] }, { duration: 0.32, ease: 'easeOut' });
    await play($('.boot-screen'), { opacity: [0, 1, 0.25, 1, 0.6, 1] }, { duration: 0.35 });
    play($$('.boot-corner'), { opacity: [0, 1], scale: [1.5, 1] }, { duration: 0.35, delay: stagger(0.05) });
    play($('.boot-top'), { clipPath: ['inset(0 100% 0 0)', 'inset(0 0% 0 0)'] }, { duration: 0.5, ease: 'easeOut' });
    play($('.boot-foot'), { opacity: [0, 1] }, { duration: 0.4, delay: 0.3 });

    // 2. Emblème Arasaka.
    play($('.boot-emblem'), { rotate: [-90, 0] }, { duration: 1.1, ease: [0.16, 1, 0.3, 1] });
    await play(ring, { strokeDashoffset: [C, 0] }, { duration: 0.9, ease: [0.65, 0, 0.35, 1] });
    await play($('.boot-emblem .trunk'), { transform: ['scaleY(0)', 'scaleY(1)'] }, { duration: 0.3, ease: 'easeOut' });
    await play($$('.boot-emblem .branch'), { strokeDashoffset: [230, 0] }, { duration: 0.25, ease: 'easeOut' });
    spike(0.5, 90);
    await play($$('.boot-emblem .seed'), { transform: ['scale(0)', 'scale(1)'] }, { type: 'spring', stiffness: 420, damping: 16, delay: stagger(0.08) });
    play($('.boot-emblem'), { filter: ['drop-shadow(0 0 1.6vmin rgba(248,0,48,0.55))', 'drop-shadow(0 0 4vmin rgba(248,0,48,0.9))', 'drop-shadow(0 0 1.6vmin rgba(248,0,48,0.55))'] }, { duration: 0.6 });
    await play($$('.boot-word span'), { opacity: [0, 1, 0.3, 1], y: [10, 0], filter: ['blur(6px)', 'blur(0px)'] }, { duration: 0.35, delay: stagger(0.05) });
    await play($('.boot-corp'), { clipPath: ['inset(0 100% 0 0)', 'inset(0 0% 0 0)'] }, { duration: 0.45, ease: 'easeOut' });
    await wait(650);

    // 3. Projet CAPRICORN.
    const brand = $('.boot-brand');
    spike(0.6, 120);
    play(brand, { y: [0, -innerHeight * 0.27], scale: [1, 0.48] }, { duration: 0.6, ease: [0.7, 0, 0.2, 1] });
    await wait(250);
    const project = $('.boot-project');
    await play(project, {
      opacity: [0, 1, 0.2, 1, 0.5, 1],
      clipPath: ['inset(45% 0 45% 0)', 'inset(10% 0 60% 0)', 'inset(50% 0 5% 0)', 'inset(0 0 0 0)'],
      x: [0, 14, -14, 0],
    }, { duration: 0.55 });
    play($('.boot-kicker'), { letterSpacing: ['0.2em', '0.9em'] }, { duration: 0.8, ease: 'easeOut' });
    await play($$('.boot-tags span'), { opacity: [0, 1], x: [-12, 0] }, { duration: 0.3, delay: stagger(0.08) });
    play($('.boot-progress'), { opacity: [0, 1] }, { duration: 0.25 });

    const STEPS = ['DÉCHIFFREMENT DU NOYAU', 'SYNCHRONISATION NEURALE', 'CALIBRAGE OPTIQUE', 'ÉVEIL DE LA PERSONNALITÉ'];
    const pct = $('.boot-pct'), step = $('.boot-step');
    let shown = -1;
    const loading = M.animate(0, 100, {
      duration: 2.4 * speed(),
      ease: [0.6, 0.05, 0.3, 1],
      onUpdate: (v) => {
        pct.textContent = String(Math.round(v)).padStart(3, '0') + '%';
        step.textContent = STEPS[Math.min(STEPS.length - 1, Math.floor((v / 100) * STEPS.length))];
        const n = Math.min(LINES.length - 1, Math.floor((v / 100) * LINES.length));
        while (shown < n) addLine(LINES[++shown]);
        if (Math.random() < 0.03) spike(0.4, 60);
      },
    });
    play($('.boot-fill'), { transform: ['scaleX(0)', 'scaleX(1)'] }, { duration: 2.4, ease: [0.6, 0.05, 0.3, 1] });
    await loading.finished;
    step.textContent = 'CAPRI EN LIGNE';
    step.style.color = 'var(--ar)';
    await wait(500);

    // 4. Déchirure façon Blackwall, puis la place à CAPRI.
    clearInterval(hexTimer);
    glitch = 1;
    const screenEl = $('.boot-screen');
    await play(screenEl, {
      x: [0, -30, 42, -14, 24, 0],
      clipPath: ['inset(0 0 0 0)', 'inset(10% 0 55% 0)', 'inset(48% 0 12% 0)', 'inset(0 0 70% 0)', 'inset(30% 0 30% 0)', 'inset(49.5% 0 49.5% 0)'],
      filter: ['none', 'hue-rotate(0deg) saturate(3)', 'invert(1)', 'none', 'saturate(4)', 'none'],
    }, { duration: 0.45, ease: 'linear' });
    resolveDone();
    await play(root, { opacity: [1, 0.85, 0.4, 0], clipPath: ['inset(0 0 0 0)', 'inset(0 0 20% 0)', 'inset(40% 0 40% 0)', 'inset(50% 0 50% 0)'] }, { duration: 0.45 });
    running = false;
    root.remove();
  }
  run().catch((error) => { console.error('Démarrage :', error); resolveDone(); running = false; root.remove(); });
})();
