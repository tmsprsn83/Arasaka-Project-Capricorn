// Panneau des messages (Win + Maj + F) : la conversation avec CAPRI, façon téléphone de V dans Cyberpunk 2077.
// Ouverture en glitch (tranches rouges et cyan, découpe qui se déploie, filets qui se tracent, bulles qui arrivent
// du bas l'une après l'autre), nouveau message qui grésille en entrant, petits sursauts de glitch tant qu'il est
// ouvert, fermeture qui s'écrase en une ligne. Tout est animé par Motion. Le texte n'est jamais interprété comme du
// HTML (textContent). overlay.js lui passe ce que CAPRI est en train de dire tant qu'il est ouvert.
(function () {
  const M = window.Motion;
  const $ = (sel) => document.querySelector(sel);
  const panel = $('#msg');
  const list = $('#msg-list');
  const input = $('#msg-input');
  const thumb = $('.msg-thumb');
  const anim = (el, keyframes, options) => (M && el ? M.animate(el, keyframes, options).finished : Promise.resolve());
  let open = false;
  let history = [];
  let shownCount = 0;
  let live = null; // bulle de ce que CAPRI est en train d'écrire
  let waiting = null; // trois points en attendant sa réponse
  let glitchTimer = null;

  function bubble(from, text) {
    const b = document.createElement('div');
    b.className = `bubble-m ${from === 'moi' ? 'moi' : 'capri'}`;
    b.textContent = text;
    return b;
  }

  const nearBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  const toBottom = (smooth = true) => list.scrollTo({ top: list.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });

  // Barre de défilement rouge du jeu : la partie visible suit le défilement.
  function updateThumb() {
    const ratio = list.clientHeight / Math.max(list.scrollHeight, 1);
    const track = list.clientHeight;
    thumb.style.height = `${Math.max(8, ratio * 100)}%`;
    thumb.style.top = `${(list.scrollTop / Math.max(list.scrollHeight - track, 1)) * (100 - Math.max(8, ratio * 100))}%`;
    thumb.style.opacity = ratio >= 1 ? '0' : '1';
  }
  list.addEventListener('scroll', updateThumb);

  // Entrée d'une bulle : elle arrive de son côté en grésillant. La découpe déborde de la bulle (-1em) pour ne pas
  // couper sa pointe ni sa lueur, qui dépassent de sa boîte.
  const enterBubble = (el, delay = 0) => anim(el, {
    opacity: [0, 1, 0.35, 1],
    x: [el.classList.contains('moi') ? 18 : -18, 0],
    clipPath: ['inset(-1em 100% -1em -1em)', 'inset(-1em -1em -1em -1em)'],
  }, { duration: 0.32, delay, ease: 'easeOut' });

  // Toute la conversation (ouverture).
  function renderAll() {
    list.textContent = '';
    live = null; waiting = null;
    if (!history.length) {
      const e = document.createElement('div'); e.className = 'msg-empty'; e.textContent = 'Aucun message. Dis-lui quelque chose !';
      list.append(e);
    }
    for (const m of history) list.append(bubble(m.from, m.text));
    shownCount = history.length;
    toBottom(false);
    updateThumb();
  }

  // Nouveaux messages pendant qu'il est ouvert : seuls les nouveaux entrent en animation.
  function addNew() {
    const fresh = history.slice(shownCount);
    if (!fresh.length) return;
    const stick = nearBottom();
    list.querySelector('.msg-empty')?.remove();
    for (const m of fresh) {
      if (m.from === 'capri' && live) { live.remove(); live = null; }
      if (m.from === 'capri' && waiting) { waiting.remove(); waiting = null; }
      const b = bubble(m.from, m.text);
      list.append(b);
      enterBubble(b);
    }
    shownCount = history.length;
    if (stick || fresh.some((m) => m.from === 'moi')) toBottom();
    updateThumb();
  }

  function glitch(strength = 1) {
    const g = $('.msg-glitch');
    anim(g, { opacity: [0, 0.9 * strength, 0, 0.6 * strength, 0], x: [0, -6 * strength, 4 * strength, 0] }, { duration: 0.28 });
    // Glitch latéral de la fenêtre de CAPRI (messages.css) : complet au-delà de 1, sans tranches en dessous.
    panel.classList.remove('glitch-fx');
    void panel.offsetWidth; // relance l'animation
    panel.classList.toggle('doux', strength < 1);
    panel.classList.add('glitch-fx');
    clearTimeout(glitch.off);
    glitch.off = setTimeout(() => panel.classList.remove('glitch-fx', 'doux'), 650);
  }
  function glitchLater() {
    clearTimeout(glitchTimer);
    glitchTimer = setTimeout(() => { if (!open) return; glitch(0.6); glitchLater(); }, 4000 + Math.random() * 5000);
  }

  async function show() {
    open = true;
    panel.hidden = false;
    $('#hud').style.visibility = 'hidden'; // la carte d'appel entrant laisse la place
    renderAll();
    const bubbles = [...list.querySelectorAll('.bubble-m')].slice(-8);
    bubbles.forEach((b) => { b.style.opacity = '0'; });
    glitch(1.2);
    anim(panel, { opacity: [0, 1, 0.3, 1, 0.7, 1], clipPath: ['inset(-8em -3em 100% -16em)', 'inset(-8em -3em -3em -16em)'] }, { duration: 0.42, ease: [0.2, 0.8, 0.2, 1] });
    anim($('.msg-code'), { opacity: [0, 1, 0.2, 1] }, { duration: 0.4, delay: 0.1 });
    // Carte du contact, comme l'appel entrant : les cadres fantômes arrivent du fond, puis la carte grésille.
    const ghosts = [...document.querySelectorAll('.msg-contact .hud-ghost')];
    ghosts.forEach((g, i) => anim(g, { opacity: [0, [0.12, 0.2, 0.32, 0.45, 0.6][i]] }, { duration: 0.18, delay: 0.04 * (ghosts.length - i) }));
    anim($('.msg-contact .hud-card'), { opacity: [0, 1, 0.3, 1] }, { duration: 0.3, delay: 0.22 });
    anim($('.msg-contact .hud-side'), { opacity: [0, 1] }, { duration: 0.2, delay: 0.1 });
    anim($('.msg-head'), { clipPath: ['inset(0 100% 0 0)', 'inset(0 0% 0 0)'], opacity: [0.3, 1] }, { duration: 0.35, delay: 0.12, ease: 'easeOut' });
    document.querySelectorAll('.msg-head .u').forEach((c, i) => anim(c, { scaleX: [0, 1] }, { duration: 0.3, delay: 0.2 + i * 0.1, ease: 'easeOut' }));
    anim($('.msg-fill .red'), { scaleX: [0, 1] }, { duration: 0.45, delay: 0.3, ease: 'easeOut' });
    anim($('.msg-track'), { scaleY: [0, 1], opacity: [0, 1] }, { duration: 0.4, delay: 0.25 });
    bubbles.forEach((b, i) => enterBubble(b, 0.3 + i * 0.05).then(() => { b.style.opacity = ''; }));
    anim($('.msg-reply'), { opacity: [0, 1, 0.4, 1], y: [10, 0] }, { duration: 0.3, delay: 0.45 });
    anim($('.msg-foot-rule'), { scaleX: [0, 1] }, { duration: 0.4, delay: 0.5 });
    anim($('.msg-foot'), { opacity: [0, 1, 0.3, 1] }, { duration: 0.3, delay: 0.6 });
    setTimeout(() => input.focus(), 50);
    glitchLater();
  }

  async function hide() {
    open = false;
    clearTimeout(glitchTimer);
    window.capriOverlay.mouse(false);
    // Sortie en glitch, comme l'arrivée de CAPRI : tranches qui sautent, couleurs qui décrochent, bulles qui se
    // décalent, scintillement, puis tout s'écrase en une ligne.
    glitch(1.5);
    [...list.querySelectorAll('.bubble-m')].slice(-10).forEach((b) => {
      const d = 6 + Math.random() * 14;
      anim(b, { x: [0, d, -d * 0.6, d * 0.3, 0], opacity: [1, 0.4, 1, 0.2, 1] }, { duration: 0.3, delay: Math.random() * 0.12 });
    });
    const full = 'inset(-8em -3em -3em -16em)';
    await anim(panel, {
      clipPath: [full, 'inset(12% -3em 52% -16em)', full, 'inset(38% -3em 22% -16em)', 'inset(68% -3em 6% -16em)', full, 'inset(46% -3em 46% -16em)', 'inset(50% -3em 50% -16em)'],
      opacity: [1, 0.35, 1, 0.6, 0.9, 0.25, 0.85, 0],
    }, { duration: 0.6, ease: 'linear' });
    if (!open) { panel.hidden = true; $('#hud').style.visibility = ''; }
  }

  // Envoi : la bulle verte arrive tout de suite (main la garde aussi), puis les trois points de CAPRI.
  function sendNow() {
    const text = input.value.trim();
    if (!text) { anim($('.msg-field'), { x: [0, -6, 6, -3, 0] }, { duration: 0.25 }); return; }
    input.value = '';
    window.capriOverlay.send(text);
    if (!waiting) {
      waiting = document.createElement('div');
      waiting.className = 'bubble-m capri';
      waiting.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
      setTimeout(() => { if (waiting && !waiting.isConnected) { list.append(waiting); enterBubble(waiting); toBottom(); updateThumb(); } }, 450);
    }
  }

  $('#msg-form').addEventListener('submit', (e) => { e.preventDefault(); sendNow(); });
  $('#msg-send').addEventListener('click', sendNow);
  $('#msg-close').addEventListener('click', () => window.capriOverlay.close());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) window.capriOverlay.close(); });
  // Souris : le calque ne prend les clics qu'au-dessus du panneau ; ailleurs ils traversent vers le jeu ou le bureau.
  panel.addEventListener('mouseenter', () => window.capriOverlay.mouse(true));
  panel.addEventListener('mouseleave', () => window.capriOverlay.mouse(false));

  window.capriOverlay.onHistory((h) => {
    history = Array.isArray(h) ? h : [];
    if (open) addNew();
  });
  window.capriOverlay.onPanel((on) => { if (on && !open) show(); else if (!on && open) hide(); });

  // Ce que CAPRI est en train d'écrire (overlay.js) : une bulle qui se remplit, avec son curseur.
  window.CapriMessages = {
    isOpen: () => open,
    live(text, speaking) {
      if (!open || !text) return;
      if (waiting) { waiting.remove(); waiting = null; }
      if (!speaking) return; // le message fini arrive par l'historique
      const stick = nearBottom();
      if (!live) {
        live = document.createElement('div');
        live.className = 'bubble-m capri live';
        list.append(live);
        enterBubble(live);
      }
      live.textContent = text;
      const caret = document.createElement('i'); caret.className = 'caret'; live.append(caret);
      if (stick) toBottom(false);
      updateThumb();
    },
  };
})();
