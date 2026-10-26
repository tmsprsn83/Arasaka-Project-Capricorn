// Fenêtre de CAPRI : visage animé, bulle de réponse, champ de saisie (VoiceInput y colle la dictée).
const { app, BrowserWindow, ipcMain, screen, Notification, Tray, Menu, nativeImage, powerMonitor } = require('electron');
const fs = require('fs');
const path = require('path');
const { ask, REVEILS } = require('./brain');
const { takeDue } = require('./reveils');
const { stripMoods } = require('./tags');
const { createLumiere } = require('./lumiere');
const { createMusique } = require('./musique');
const { readConfig, createCentrale } = require('./centrale');
const ntfy = require('./ntfy');

const SESSION_FILE = () => path.join(app.getPath('userData'), 'session.json');
// Réglages de Tommy (menu de l'icône) : notifications (sons + Windows) et messages sur l'écran principal.
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'reglages.json');
const settings = { notifications: true, overlay: true, telephone: true };
const loadSettings = () => { try { Object.assign(settings, JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8'))); } catch { /* valeurs par défaut */ } };
const saveSettings = () => { try { fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(settings)); } catch { /* non retenu */ } };
// Un réglage change (menu de l'icône ou boutons de la barre de CAPRI) : retenu, appliqué, et la barre est prévenue.
function setSetting(key, value) {
  if (!(key in settings) || typeof value !== 'boolean') return settings;
  settings[key] = value;
  saveSettings();
  if (key === 'overlay') placeOverlay();
  win?.webContents.send('capri:settings', { ...settings });
  return settings;
}
// Téléphone de Tommy : ses messages lui arrivent en notification ntfy (`telephone.json` : { "ntfy": "https://ntfy.sh/…" }).
// Elle lui écrit quand il n'est pas devant son PC (réveils), ou quand il le lui demande (balise [telephone]).
const PHONE_FILE = () => path.join(app.getPath('userData'), 'telephone.json');
let phone = null;
const loadPhone = () => { try { phone = JSON.parse(fs.readFileSync(PHONE_FILE(), 'utf8')).ntfy || null; } catch { phone = null; } };
const PHONE_TAG = /\[t[ée]l[ée]phone\]/i;
function toPhone(said) {
  const text = stripMoods(said).trim();
  if (!phone || !settings.telephone || !text) return;
  ntfy.push(phone, text).catch(() => { /* téléphone injoignable : le message reste sur l'écran */ });
}
// Pas devant son PC : session verrouillée, ou ni clavier ni souris depuis 3 minutes.
const away = () => powerMonitor.getSystemIdleState(60) === 'locked' || powerMonitor.getSystemIdleTime() >= 180;
const readSession = () => { try { return JSON.parse(fs.readFileSync(SESSION_FILE(), 'utf8')).sessionId || null; } catch { return null; } };
const saveSession = (sessionId) => { try { fs.writeFileSync(SESSION_FILE(), JSON.stringify({ sessionId })); } catch { /* conversation non conservée */ } };

let win;
let sessionId = null;
let cancel = null;
let waking = null;
let lumiere = null;
// Musique en cours sur le PC (panneau « NOW PLAYING » de CAPRI) : dernier état gardé, pochette comprise, pour une
// fenêtre qui se recharge.
let musique = null;
let music = null;
// Centrale sur le VPS (centrale.json) : cerveau, mémoire et réveils là-bas ; sinon tout reste sur le PC.
let centrale = null;

// Écran dédié : le petit écran USB de 7 pouces (SD700F_0716, 1024 × 600). À défaut de le reconnaître par son nom,
// le plus petit écran secondaire d'au plus 1280 px de large. CAPRI s'y ouvre en plein écran.
const DEDICATED = /SD700F/i;
function dedicatedDisplay() {
  const primary = screen.getPrimaryDisplay().id;
  const others = screen.getAllDisplays().filter((d) => d.id !== primary);
  return others.find((d) => DEDICATED.test(d.label || ''))
    || others.filter((d) => d.size.width <= 1280).sort((a, b) => a.size.width * a.size.height - b.size.width * b.size.height)[0]
    || null;
}
function moveToDedicated() {
  const display = dedicatedDisplay();
  if (!win || !display) return;
  if (screen.getDisplayMatching(win.getBounds()).id === display.id && win.isFullScreen()) return;
  win.setFullScreen(false);
  win.setBounds(display.bounds);
  win.setFullScreen(true);
}

const ICON = path.join(__dirname, 'renderer', 'visage', 'icone@2x.png');

// Zone de notification (systray) : CAPRI y reste quand on ferme sa fenêtre. Clic : la montrer au premier plan ;
// clic droit : menu (plein écran, premier plan, calque de l'écran principal, quitter).
let tray = null;
let quitting = false;
function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
function trayMenu() {
  return Menu.buildFromTemplate([
    { label: win?.isVisible() ? 'Cacher CAPRI' : 'Afficher CAPRI', click: () => (win?.isVisible() ? win.hide() : showWindow()) },
    { type: 'separator' },
    { label: 'Plein écran', type: 'checkbox', checked: !!win?.isFullScreen(), click: () => { showWindow(); win.setFullScreen(!win.isFullScreen()); } },
    { label: 'Toujours au premier plan', type: 'checkbox', checked: !!win?.isAlwaysOnTop(), click: () => win?.setAlwaysOnTop(!win.isAlwaysOnTop()) },
    { label: "Messages sur l'écran principal", type: 'checkbox', checked: settings.overlay, click: () => setSetting('overlay', !settings.overlay) },
    ...(centrale ? [{ label: centrale.connected ? 'Centrale : connectée' : 'Centrale : hors ligne (cerveau du PC)', enabled: false }] : []),
    ...(phone ? [{ label: 'Messages sur le téléphone', type: 'checkbox', checked: settings.telephone, click: () => setSetting('telephone', !settings.telephone) }] : []),
    { label: 'Notifications (son et Windows)', type: 'checkbox', checked: settings.notifications, click: () => setSetting('notifications', !settings.notifications) },
    { type: 'separator' },
    { label: 'Quitter CAPRI', click: () => { quitting = true; app.quit(); } },
  ]);
}
function createTray() {
  const image = nativeImage.createFromPath(ICON).resize({ width: 32, height: 32, quality: 'best' });
  tray = new Tray(image);
  tray.setToolTip('CAPRI');
  tray.on('click', showWindow);
  // Menu reconstruit à chaque ouverture : les cases suivent l'état de la fenêtre.
  tray.on('right-click', () => tray.popUpContextMenu(trayMenu()));
}

function createWindow() {
  const display = dedicatedDisplay();
  win = new BrowserWindow({
    width: 780,
    height: 640,
    ...(display ? { ...display.bounds, fullscreen: true } : {}),
    minWidth: 520,
    minHeight: 480,
    frame: false,
    backgroundColor: '#0f050e',
    title: 'CAPRI',
    icon: ICON,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Fermer la fenêtre la range dans la zone de notification ; « Quitter CAPRI » (menu de l'icône) la ferme pour de bon.
  win.on('close', (event) => { if (!quitting) { event.preventDefault(); win.hide(); } });
  // Plein écran : F11 bascule, Échap en sort ; la page est prévenue pour allumer son bouton.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); event.preventDefault(); }
    if (input.key === 'Escape' && win.isFullScreen()) { win.setFullScreen(false); event.preventDefault(); }
  });
  win.on('enter-full-screen', () => win.webContents.send('capri:fullscreen', true));
  win.on('leave-full-screen', () => win.webContents.send('capri:fullscreen', false));
  // Fenêtre ouverte d'emblée en plein écran (petit écran dédié) : la page l'apprend une fois chargée.
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('capri:fullscreen', win.isFullScreen());
    if (music) win.webContents.send('capri:musique', music);
  });
}

// Calque de l'écran principal : page transparente plein écran, au premier plan, que les clics traversent ; CAPRI y
// affiche ce qu'elle dit façon appel entrant de Cyberpunk 2077 (renderer/overlay.html). Seulement quand CAPRI a
// son écran dédié (sinon elle est déjà sur l'écran principal).
let overlay = null;
function placeOverlay() {
  const primary = screen.getPrimaryDisplay();
  if (!dedicatedDisplay() || !settings.overlay) { overlay?.close(); return; }
  if (!overlay || overlay.isDestroyed()) {
    overlay = new BrowserWindow({
      ...primary.bounds,
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      // Sonnerie sans clic préalable : le calque ne reçoit jamais de clic.
      webPreferences: { preload: path.join(__dirname, 'preload-overlay.js'), contextIsolation: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required' },
    });
    overlay.setIgnoreMouseEvents(true);
    overlay.setAlwaysOnTop(true, 'screen-saver');
    overlay.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
    overlay.on('closed', () => { overlay = null; });
  } else overlay.setBounds(primary.bounds);
}
// La fenêtre de CAPRI joue elle-même ses sons quand il n'y a pas de calque (pas d'écran dédié, ou calque coupé).
ipcMain.handle('capri:has-overlay', () => !!overlay && !overlay.isDestroyed());
ipcMain.handle('capri:notifications', () => settings.notifications);
// Touches A / D du panneau musique : volume général de Windows, par pas de 2 %.
ipcMain.on('capri:volume', (_event, delta) => { const d = Number(delta); if (Number.isFinite(d) && Math.abs(d) <= 0.1) musique?.volume(d); });
ipcMain.handle('capri:settings', () => ({ ...settings }));
ipcMain.handle('capri:set', (_event, key, value) => ({ ...setSetting(key, value) }));
ipcMain.on('capri:overlay', (_event, message) => {
  if (!overlay || overlay.isDestroyed() || !message || typeof message.text !== 'string') return;
  overlay.webContents.send('overlay:message', { text: message.text.slice(-4000), speaking: message.speaking === true, sound: settings.notifications && message.quiet !== true });
});

ipcMain.handle('capri:ask', (_event, text) => {
  if (typeof text !== 'string' || !text.trim()) return { ok: false };
  cancel?.();
  waking?.(); // Tommy parle : il passe avant un réveil en cours.
  const reply = {
    text: text.trim(),
    onText: (chunk) => win?.webContents.send('capri:text', chunk),
    onDone: (result) => {
      cancel = null;
      if (result.sessionId) { sessionId = result.sessionId; saveSession(sessionId); }
      if (!result.error && PHONE_TAG.test(result.text || '')) toPhone(result.text); // Tommy lui a demandé de l'envoyer sur son téléphone
      win?.webContents.send('capri:done', { error: result.error });
    },
    onError: (message) => {
      cancel = null;
      win?.webContents.send('capri:done', { error: message });
    },
  };
  // Centrale injoignable (VPS ou Internet coupé) : le cerveau du PC prend le relais pour cette réponse.
  if (centrale) cancel = centrale.ask({ ...reply, onError: (error) => { if (error.offline) cancel = ask({ ...reply, sessionId }); else reply.onError(error.message); } });
  else cancel = ask({ ...reply, sessionId });
  return { ok: true };
});

// Réveils : chaque minute, si CAPRI ne parle pas déjà, les réveils arrivés à l'heure lui sont donnés dans la
// conversation en cours. Elle répond « RIEN » si rien ne mérite de déranger Tommy ; sinon elle lui parle la
// première, et la fenêtre clignote avec une notification s'il n'est pas devant.
const WAKE_PROMPT = (tasks) => [
  '[Réveil automatique : ce message ne vient pas de Tommy, il ne l\'a pas écrit.]',
  'Réveils que tu as programmés et qui arrivent maintenant :',
  ...tasks.map((task) => `- ${task}`),
  'Fais-le maintenant. Si tu as quelque chose à dire à Tommy, parle-lui directement, comme si tu lançais la conversation.',
  'Si rien ne mérite de le déranger, réponds exactement : RIEN',
].join('\n');

// Elle parle la première (réveil local ou de la centrale) : affichage, clignotement et notification s'il n'est pas devant.
function announce(said) {
  win?.webContents.send('capri:wake', said);
  if (away() || PHONE_TAG.test(said)) toPhone(said);
  if (win && !win.isFocused()) {
    win.flashFrame(true);
    if (settings.notifications && Notification.isSupported()) {
      const note = new Notification({ title: 'CAPRI', body: stripMoods(said).slice(0, 180), icon: ICON, silent: true }); // son de CAPRI à la place
      note.on('click', showWindow);
      note.show();
    }
  }
}

function checkReveils() {
  if (centrale || cancel || waking || !win) return; // avec la centrale, ses réveils tournent sur le serveur
  let note;
  try { note = fs.readFileSync(REVEILS, 'utf8'); } catch { return; /* pas encore de réveils */ }
  const { fired, text } = takeDue(note);
  if (!fired.length) return;
  try { fs.writeFileSync(REVEILS, text, 'utf8'); } catch { return; /* sans écriture, il sonnerait en boucle */ }
  waking = ask({
    text: WAKE_PROMPT(fired),
    sessionId,
    onText: () => {},
    onDone: (result) => {
      waking = null;
      if (result.sessionId) { sessionId = result.sessionId; saveSession(sessionId); }
      const said = result.text.trim();
      if (result.error || !said || /^RIEN\.?$/i.test(stripMoods(said))) return;
      announce(said);
    },
    onError: () => { waking = null; },
  });
}

ipcMain.handle('capri:reset', () => { cancel?.(); waking?.(); sessionId = null; saveSession(null); centrale?.reset(); return { ok: true }; });
// Elle parle : les ventilateurs buggent en rouge et vert ; elle se tait : l'éclairage de Tommy revient.
ipcMain.on('capri:lumiere', (_event, on) => { lumiere?.parle(on === true); tray?.setToolTip(on === true ? 'CAPRI — parle' : 'CAPRI'); });
ipcMain.on('capri:window', (_event, action) => {
  if (action === 'close') win?.close();
  if (action === 'minimize') win?.minimize();
  if (action === 'top') win?.setAlwaysOnTop(!win.isAlwaysOnTop());
  if (action === 'fullscreen') win?.setFullScreen(!win.isFullScreen());
});

// Une seule CAPRI : relancée alors qu'elle tourne déjà (dans la zone de notification), elle se montre.
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => showWindow());

app.whenReady().then(() => {
  sessionId = readSession();
  loadPhone();
  loadSettings();
  lumiere = createLumiere();
  musique = createMusique((info) => {
    music = { ...music, ...info, thumb: info.changed ? info.thumb || null : music?.thumb ?? null };
    win?.webContents.send('capri:musique', info.changed ? music : { ...music, thumb: undefined });
  });
  const config = readConfig(app.getPath('userData'));
  if (config) {
    centrale = createCentrale({
      ...config,
      memoryDir: path.dirname(REVEILS),
      onReveil: (said) => { if (said) announce(said); },
      onState: (on) => tray?.setToolTip(on ? 'CAPRI' : 'CAPRI — centrale hors ligne'),
    });
  }
  createWindow();
  createTray();
  placeOverlay();
  win.on('closed', () => overlay?.close());
  win.webContents.once('did-finish-load', () => setTimeout(checkReveils, 5000));
  setInterval(checkReveils, 60 * 1000);
  // Écran branché après coup (ou reconnu tard à l'ouverture de session) : CAPRI y part. Débranché : Windows
  // ramène la fenêtre sur l'écran principal, où elle reprend sa taille normale.
  screen.on('display-added', () => setTimeout(() => { moveToDedicated(); placeOverlay(); }, 1500));
  screen.on('display-metrics-changed', () => placeOverlay());
  screen.on('display-removed', () => {
    placeOverlay();
    if (!win || dedicatedDisplay()) return;
    win.setFullScreen(false);
    win.setSize(780, 640);
    win.center();
  });
});
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { lumiere?.close(); musique?.close(); centrale?.close(); });
