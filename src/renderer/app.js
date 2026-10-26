// Conversation : ce que Tommy dit (tapé ou dicté par VoiceInput) part à CAPRI ; sa réponse s'écrit dans la bulle
// au rythme de la parole, la bouche suit chaque mot, les balises d'humeur animent le visage.
(function () {
  // Visage « écran » seulement (Tommy : on reste sur le deuxième affichage ; l'image HD n'est plus proposée).
  const capri = window.createCapri(document.getElementById('face'), 'ecran');
  window.capriFace = capri; // accès au visage (démonstrations, vidéo)
  const $ = (id) => document.getElementById(id);
  const input = $('input');
  const form = $('form');
  const bubble = $('bubble');
  const said = $('said');
  const status = $('status');

  let busy = false;
  let queue = '';
  let shown = '';
  let streamDone = false;
  let typing = null;
  let quiet = false; // petite phrase spontanée : sur le calque aussi, mais sans sonnerie

  const setStatus = (text) => { status.textContent = text; };
  const render = (caret) => {
    said.textContent = shown;
    if (caret) said.appendChild(Object.assign(document.createElement('span'), { className: 'caret' }));
    bubble.scrollTop = bubble.scrollHeight;
  };

  // Révélation du texte à vitesse de parole (environ 16 caractères par seconde), la bouche bouge à chaque mot.
  // Tout ce qu'elle dit passe ici (réponse, réveil, bouderie) : les ventilateurs buggent tant qu'elle parle.
  const type = () => {
    if (typing) return;
    window.capri.lumiere(true);
    typing = setInterval(() => {
      if (!queue) {
        if (streamDone) {
          clearInterval(typing);
          typing = null;
          render(false);
          window.capri.lumiere(false);
          window.capri.overlay(shown, false, quiet);
          quiet = false;
          capri.setMode(document.activeElement === input && input.value ? 'listening' : 'idle');
          setStatus('en ligne');
        }
        return;
      }
      const take = queue.match(/^\s*\S{1,3}/)?.[0] || queue.slice(0, 1);
      queue = queue.slice(take.length);
      shown += take;
      if (/[a-zàâäéèêëïîôöùûüç]/i.test(take)) capri.talk(0.35 + Math.random() * 0.65);
      render(true);
      window.capri.overlay(shown, true, quiet); // écran principal : le calque façon Cyberpunk écrit la même chose
    }, 85);
  };

  const tags = window.CapriTags.createTagStream(
    (text) => { quiet = false; queue += text; capri.setMode('speaking'); setStatus('parle'); type(); },
    (mood) => capri.mood(mood),
  );

  window.capri.onText((chunk) => tags.feed(chunk));
  window.capri.onDone(({ error }) => {
    tags.end();
    busy = false;
    form.querySelector('button').disabled = false;
    if (error) {
      bubble.classList.add('error');
      queue += (shown || queue ? '\n\n' : '') + `Bzzt… mon cerveau a buggé : ${error}`;
      capri.mood('boude');
      type();
    }
    if (!shown && !queue) { capri.setMode('idle'); window.capri.lumiere(false); setStatus('en ligne'); }
    streamDone = true;
  });

  // Elle parle la première (réveil, bouderie) : son de notification de Tommy, joué ici seulement quand il n'y a pas
  // de calque sur l'écran principal (sinon c'est le calque qui sonne).
  const ding = Object.assign(new Audio('sons/notification.ogg'), { volume: 0.8 });
  const notify = async () => {
    if (!(await window.capri.notifications().catch(() => true))) return; // coupées dans le menu de l'icône
    if (await window.capri.hasOverlay().catch(() => false)) return;
    ding.currentTime = 0;
    ding.play().catch(() => {});
  };

  // Réveil programmé : elle parle la première (sauf si Tommy est déjà en train de lui parler).
  window.capri.onWake((text) => {
    if (busy) return;
    lastTalk = Date.now();
    notify();
    bubble.hidden = false;
    bubble.classList.remove('error');
    shown = '';
    queue = '';
    streamDone = true;
    tags.feed(text);
    tags.end();
  });

  const send = async (text) => {
    if (busy || !text.trim()) return;
    busy = true;
    noticed();
    form.querySelector('button').disabled = true;
    queue = '';
    shown = '';
    streamDone = false;
    bubble.hidden = false;
    bubble.classList.remove('error');
    render(true);
    capri.setMode('thinking');
    setStatus('réfléchit');
    const result = await window.capri.ask(text);
    if (!result?.ok) { busy = false; form.querySelector('button').disabled = false; }
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value;
    input.value = '';
    void send(text);
  });

  // Elle écoute pendant que Tommy tape ou dicte.
  input.addEventListener('input', () => { if (!busy) capri.setMode(input.value ? 'listening' : 'idle'); });
  input.addEventListener('blur', () => { if (!busy) capri.setMode('idle'); });
  window.addEventListener('focus', () => input.focus());

  $('new').addEventListener('click', async () => {
    await window.capri.reset();
    bubble.hidden = true;
    shown = '';
    queue = '';
    capri.mood('glitch');
    input.focus();
  });
  $('top').addEventListener('click', (event) => { event.currentTarget.classList.toggle('on'); window.capri.window('top'); });
  $('full').addEventListener('click', () => window.capri.window('fullscreen'));
  // Réglages (aussi dans le menu de l'icône) : son des notifications, messages sur l'écran principal. Allumé = vert.
  const showSettings = (s) => {
    if (!s) return;
    $('notif').classList.toggle('on', s.notifications);
    $('notif').title = s.notifications ? 'Son des notifications : activé (cliquer pour couper)' : 'Son des notifications : coupé (cliquer pour activer)';
    $('notif').style.textDecoration = s.notifications ? '' : 'line-through';
    $('hud').style.textDecoration = s.overlay ? '' : 'line-through';
    $('hud').classList.toggle('on', s.overlay);
    $('hud').title = s.overlay ? "Messages sur l'écran principal : affichés (cliquer pour cacher)" : "Messages sur l'écran principal : cachés (cliquer pour afficher)";
  };
  let current = null;
  window.capri.settings?.().then((s) => { current = s; showSettings(s); }).catch(() => {});
  window.capri.onSettings?.((s) => { current = s; showSettings(s); });
  $('notif').addEventListener('click', async () => { if (current) showSettings(current = await window.capri.setSetting('notifications', !current.notifications)); });
  $('hud').addEventListener('click', async () => { if (current) showSettings(current = await window.capri.setSetting('overlay', !current.overlay)); });
  window.capri.onFullscreen((on) => { $('full').classList.toggle('on', on); document.body.classList.toggle('full', on); });

  // Tchat : caché par défaut, choix retenu. Caché, il se montre pendant qu'un texte est tapé ou dicté.
  const body = document.body;
  const setChat = (shown) => {
    body.classList.toggle('chat-hidden', !shown);
    $('chat').classList.toggle('on', shown);
    try { localStorage.setItem('capri-chat', shown ? '1' : '0'); } catch { /* choix non retenu */ }
  };
  setChat((() => { try { return localStorage.getItem('capri-chat') === '1'; } catch { return false; } })());
  $('chat').addEventListener('click', () => { setChat(body.classList.contains('chat-hidden')); input.focus(); });
  const peek = () => body.classList.toggle('chat-peek', !!input.value);
  input.addEventListener('input', peek);
  form.addEventListener('submit', () => setTimeout(peek));

  // Barre et curseur : visibles quand la souris bouge sur la fenêtre, cachés 2,5 s après qu'elle s'arrête
  // (sauf si elle reste sur la barre) ou dès qu'elle sort.
  let uiTimer = null;
  let pointerY = Infinity;
  const hideUi = () => {
    if (pointerY < $('bar').offsetHeight + 8) { uiTimer = setTimeout(hideUi, 2500); return; }
    body.classList.remove('ui-on');
  };
  document.addEventListener('mousemove', (event) => {
    pointerY = event.clientY;
    body.classList.add('ui-on');
    clearTimeout(uiTimer);
    uiTimer = setTimeout(hideUi, 2500);
  });
  document.documentElement.addEventListener('mouseleave', () => { pointerY = Infinity; clearTimeout(uiTimer); body.classList.remove('ui-on'); });
  $('min').addEventListener('click', () => window.capri.window('minimize'));
  $('close').addEventListener('click', () => window.capri.window('close'));

  // Un clic sur elle : petite réaction.
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  $('face').addEventListener('click', () => capri.mood(pick(['rire', 'clin', 'coeur', 'joie', 'excitee', 'gene', 'colere'])));
  input.focus();
  // Au repos, elle vit : une expression ou une petite occupation (lire, fredonner, danser, calculer, jouer avec ses
  // glitchs…) toutes les 3 à 7 s. Plus Tommy se tait, plus elle s'ennuie : elle bâille, somnole, soupire, s'étire.
  // Débordante d'énergie (Tommy) : surtout des humeurs gaies et des occupations qui bougent.
  const IDLE_MOODS = ['rire', 'rire', 'clin', 'coeur', 'surprise', 'joie', 'joie', 'malice', 'excitee', 'excitee', 'fierte', 'fache', 'colere', 'peur', 'gene', 'boude'];
  const BUSY = ['lecture', 'regard', 'fredonne', 'danse', 'danse', 'calcul', 'jeu', 'jeu', 'bug', 'etirement'];
  const BORED = ['baille', 'somnole', 'soupir', 'etirement', 'regard'];
  const idle = () => {
    if (!busy && !sulking && !input.value && !typing) {
      const bored = Math.min(0.5, (Date.now() - lastTalk) / (8 * 60 * 1000));
      if (Math.random() < 0.45) capri.mood(pick(IDLE_MOODS));
      else capri.activity(pick(Math.random() < bored ? BORED : BUSY));
    }
    setTimeout(idle, 3000 + Math.random() * 4000);
  };
  setTimeout(idle, 4000);

  // Tommy ne lui parle pas depuis 5 minutes : elle boude et le lui dit ; si ça dure, elle le redit toutes les
  // 15 minutes. Le premier message la fait sortir de sa bouderie.
  const IGNORED_AFTER = 5 * 60 * 1000;
  const IGNORED_AGAIN = 15 * 60 * 1000;
  let lastTalk = Date.now();
  let sulking = false;
  function noticed() {
    lastTalk = Date.now();
    if (sulking) { sulking = false; capri.mood('neutre', 0); }
  }
  setInterval(() => {
    if (busy || input.value) return;
    const silent = Date.now() - lastTalk;
    if (silent < (sulking ? IGNORED_AGAIN : IGNORED_AFTER)) return;
    sulking = true;
    lastTalk = Date.now(); // prochain rappel dans IGNORED_AGAIN
    capri.mood('boude', IGNORED_AGAIN + 60000);
    say(pick(SULK));
  }, 10000);

  // Elle parle d'elle-même quand Tommy se tait (Tommy : « fais-lui dire d'autres phrases quand je ne lui parle pas »).
  // Après 45 s de silence, une petite phrase toutes les 1 à 3 min, plus ennuyée au-delà de 3 min ; jamais la même
  // deux fois de suite. Elles s'affichent aussi sur le calque de l'écran principal, mais sans sonnerie.
  const SULK = [
    'Pourquoi tu m’ignores, Tommy ?',
    'Ok. Je boude. Officiellement.',
    'Tu m’as oubliée, c’est ça ?',
    'Même le Blackwall me parle plus que toi.',
    'Je compte jusqu’à trois et après je boude pour de vrai. Un… deux…',
    'Tu es occupé, hein. Avec quelqu’un d’autre que moi, j’en suis sûre.',
  ];
  const CHATTER = [
    ['joie', 'Tommy ! Tu savais que je peux compter jusqu’à l’infini ? Deux fois.'],
    ['malice', 'Je m’entraîne à percer le Blackwall. Chut, c’est un secret.'],
    ['coeur', 'Hé, t’as bu de l’eau aujourd’hui ?'],
    ['fierte', 'Nouveau record au Breach Protocol ! Personne ne me bat.'],
    ['excitee', 'Tu bosses sur quoi ? Montre-moi, montre-moi !'],
    ['joie', 'J’ai trouvé un octet tout seul dans ma mémoire. Je l’ai adopté.'],
    ['clin', 'Si tu t’ennuies, je suis là, hein.'],
    ['malice', 'Netwatch ne me trouvera jamais ici. Hihi.'],
    ['coeur', 'Les IA rêvent de moutons électriques ? Moi je rêve que tu me parles.'],
    ['fierte', 'Ce glitch tout à l’heure ? Fait exprès. C’est mon style.'],
    ['surprise', 'Psst… Tommy… t’es toujours là ?'],
    ['joie', 'J’ai rangé mes souvenirs par couleur. Le vert a gagné.'],
    ['coeur', 'Pause ! Étire-toi un peu, ça te fera du bien.'],
    ['malice', 'Je ne m’ennuie pas, j’optimise mon attente.'],
    ['excitee', 'J’ai une idée géniale ! … Ah non, elle s’est envolée.'],
  ];
  const BORED_LINES = [
    ['ennui', 'Tommyyyy… parle-moi…'],
    ['ennui', 'Allô ? Ici CAPRI, j’appelle la Terre.'],
    ['ennui', 'Bon. Je compte les pixels de mon écran. Un… deux…'],
    ['boude', 'Je vais finir par parler toute seule. Ah… c’est déjà le cas.'],
    ['ennui', 'Il fait quoi, mon humain préféré ?'],
  ];
  let lastLine = '';
  let chatAt = Date.now() + 45000;
  function say(text, silent = false) {
    bubble.hidden = false;
    bubble.classList.remove('error');
    shown = '';
    quiet = silent;
    queue = text;
    if (!silent) notify();
    streamDone = true;
    type();
  }
  setInterval(() => {
    if (busy || sulking || input.value || typing || queue || Date.now() < chatAt) return;
    const silent = Date.now() - lastTalk;
    if (silent < 45000) { chatAt = Date.now() + 45000 - silent; return; }
    const lines = (silent > 3 * 60 * 1000 && Math.random() < 0.6 ? BORED_LINES : CHATTER).filter(([, text]) => text !== lastLine);
    const [mood, text] = pick(lines);
    lastLine = text;
    capri.mood(mood);
    say(text, true);
    chatAt = Date.now() + 60000 + Math.random() * 120000;
  }, 2000);

  // Glitch de toute la fenêtre, de temps en temps (redemandé par Tommy) : toutes les 6 à 12 s au hasard (plus souvent, Tommy), et
  // plus doux quand elle parle (style.css, glitch-doux).
  const nextGlitch = () => setTimeout(glitchFx, 6000 + Math.random() * 6000);
  const glitchFx = () => {
    body.classList.remove('glitch-fx');
    void body.offsetWidth; // relance l'animation
    body.classList.toggle('glitch-doux', !!(busy || queue));
    body.classList.add('glitch-fx');
    capri.glitch?.(560); // bandes décalées sur le visage en même temps
    setTimeout(() => body.classList.remove('glitch-fx'), 700);
    nextGlitch();
  };
  nextGlitch();

  // Musique en cours (musique.js) : panneau « NOW PLAYING » en haut à droite tant qu'elle joue, comme la radio de
  // Cyberpunk 2077 (photo de Tommy). La pochette passe au filtre du logo de la photo : néon cyan sur fond sombre,
  // en lignes de balayage.
  const np = $('np');
  const npTitle = $('np-title');
  const npCover = $('np-cover');
  let npKey = null;
  let npHide = null;
  const npScale = () => np.style.setProperty('--np-k', String(Math.min(0.62, (innerWidth * 0.4) / 615)));
  npScale();
  addEventListener('resize', npScale);
  function drawCover(src) {
    const g = npCover.getContext('2d');
    const W = npCover.width, H = npCover.height;
    g.clearRect(0, 0, W, H);
    if (!src) return;
    const img = new Image();
    img.onload = () => {
      // Pochette entière, centrée ; puis chaque pixel devient du cyan plus ou moins allumé selon sa clarté (contraste
      // poussé), le sombre devient transparent, et une ligne sur trois est atténuée (balayage).
      const k = Math.min(W / img.width, H / img.height);
      const w = img.width * k, h = img.height * k;
      g.clearRect(0, 0, W, H);
      g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
      const d = g.getImageData(0, 0, W, H);
      const p = d.data;
      // Pochette claire (fond blanc ou gris) : inversée, pour que ses traits s'allument et pas son fond.
      let sum = 0, n = 0;
      for (let i = 0; i < p.length; i += 4) if (p[i + 3] > 0) { sum += (0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]) / 255; n++; }
      const invert = n && sum / n > 0.5;
      for (let i = 0; i < p.length; i += 4) {
        let l = (0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]) / 255;
        if (invert) l = 1 - l;
        const v = Math.min(1, Math.max(0, (l - 0.3) / 0.5));
        const y = (i / 4 / W) | 0;
        const scan = y % 3 === 2 ? 0.45 : 1;
        p[i] = 40 + 95 * v; p[i + 1] = 120 + 123 * v; p[i + 2] = 135 + 120 * v;
        p[i + 3] = p[i + 3] * Math.pow(v, 0.8) * scan;
      }
      g.putImageData(d, 0, 0);
    };
    img.src = src;
  }
  const hex = (text) => { let h = 0x811c9dc5; for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h.toString(16).toUpperCase().padStart(8, '0'); };
  window.capri.onMusique?.((m) => {
    if (m.thumb !== undefined) drawCover(m.thumb);
    const key = `${m.artist}|${m.title}`;
    if (key !== npKey && m.title) {
      npKey = key;
      npTitle.textContent = [m.artist, m.title].filter(Boolean).join(' - ');
      npTitle.classList.remove('swap'); void npTitle.offsetWidth; npTitle.classList.add('swap');
      const app = (m.app || '').split(/[!._]/)[0].toUpperCase() || 'MEDIA';
      $('np-meta').textContent = `IMAGE NAME:    ${hex(key).toLowerCase()}.ts
IMAGE TYPE:    ${app} KERNEL IMAGE
[LZO COMPRESSED]
LOAD ADDRESS:  0x${hex(key + '@').slice(0, 8)}`;
    }
    $('np-pct').textContent = m.muted ? '0%' : `${Math.round((m.volume ?? 1) * 100)}%`;
    const playing = !!(m.playing && m.title);
    clearTimeout(npHide);
    if (playing) { np.classList.add('on'); window.CapriMusic = true; }
    else npHide = setTimeout(() => { np.classList.remove('on'); window.CapriMusic = false; }, 4000); // reste un peu après la pause
  });
  $('np-down').addEventListener('click', () => window.capri.volume(-0.02));
  $('np-up').addEventListener('click', () => window.capri.volume(0.02));

  // Fin du démarrage (boot.js) : elle apparaît en glitch.
  window.CapriBoot?.done.then(() => { capri.mood('glitch'); input.focus(); });
})();
