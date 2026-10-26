// Calque de l'écran principal : nouveau message de CAPRI ; ce qu'elle dit s'y écrit en même temps que dans sa fenêtre, façon appel entrant
// de Cyberpunk 2077. Entrée en glitch quand elle commence à parler, sortie quelques secondes après qu'elle s'est tue.
// Animations par Motion ; on n'anime que l'opacité et les découpes, pour garder la perspective posée en CSS.
(function () {
  const M = window.Motion;
  const $ = (sel) => document.querySelector(sel);
  const hud = $('#hud');
  const said = $('.hud-said-text');
  const MAX = 700; // on ne garde que la fin des longues réponses (la carte défile vers le bas)
  let visible = false;
  let last = '';
  let hideTimer = null;
  // Son de notification de Tommy (dossier audio/) à chaque nouveau message (pas la sonnerie : ce n'est pas un appel).
  const ding = Object.assign(new Audio('sons/notification.ogg'), { volume: 0.8, preload: 'auto' });
  const notify = () => { if (!soundOn) return; ding.currentTime = 0; ding.play().catch(() => {}); };
  const GHOST = [0.12, 0.2, 0.32, 0.45, 0.6]; // opacités des cadres fantômes g5 → g1 (overlay.css)
  const anim = (el, keyframes, options) => (M ? M.animate(el, keyframes, options).finished : Promise.resolve());

  async function enter() {
    visible = true;
    hud.classList.remove('idle');
    notify();
    anim(hud, { opacity: [0, 1, 0.25, 1, 0.7, 1] }, { duration: 0.4 });
    // Les cadres fantômes arrivent du fond, l'un après l'autre, puis le cadre du portrait s'allume.
    const ghosts = [...document.querySelectorAll('.hud-ghost')];
    ghosts.forEach((el, i) => anim(el, { opacity: [0, GHOST[i]] }, { duration: 0.18, delay: 0.04 * (ghosts.length - i) }));
    anim($('.hud-card'), { opacity: [0, 1, 0.3, 1] }, { duration: 0.3, delay: 0.22 });
    anim($('.hud-side'), { opacity: [0, 1] }, { duration: 0.2, delay: 0.1 });
    anim($('.hud-keys'), { opacity: [0, 1, 0.3, 1] }, { duration: 0.3, delay: 0.6 });
    anim($('.hud-id'), { clipPath: ['inset(0 100% 0 0)', 'inset(0 0% 0 0)'] }, { duration: 0.3, delay: 0.15 });
    anim($('.hud-name'), { clipPath: ['inset(0 100% 0 0)', 'inset(0 0% 0 0)'], opacity: [0.4, 1] }, { duration: 0.35, delay: 0.25, ease: 'easeOut' });
    anim($('.hud-state'), { opacity: [0, 1, 0.2, 1] }, { duration: 0.4, delay: 0.4 });
    anim($('.hud-said'), { clipPath: ['inset(0 100% 0 0)', 'inset(0 0% 0 0)'] }, { duration: 0.35, delay: 0.5, ease: 'easeOut' });
  }

  async function leave() {
    visible = false;
    await anim(hud, { opacity: [1, 0.3, 0.9, 0.1, 0] }, { duration: 0.45 });
    if (!visible) { said.textContent = ''; last = ''; }
  }

  let soundOn = true;
  window.capriOverlay.onMessage(({ text, speaking, sound }) => {
    soundOn = sound !== false; // notifications coupées dans le menu de l'icône : pas de son
    if (typeof text !== 'string') return;
    clearTimeout(hideTimer);
    if (text && !visible) enter();
    // Nouveau message (pas la suite du précédent) : petit sursaut de glitch sur la carte.
    if (text && last && !text.startsWith(last)) { anim($('.hud-said'), { opacity: [1, 0.2, 1] }, { duration: 0.2 }); notify(); }
    last = text;
    said.textContent = text.length > MAX ? '…' + text.slice(-MAX) : text;
    hud.classList.toggle('idle', !speaking);
    // Elle s'est tue : la carte reste le temps de lire, puis s'en va.
    if (!speaking && visible) hideTimer = setTimeout(leave, 6000 + Math.min(12000, text.length * 40));
  });
})();
