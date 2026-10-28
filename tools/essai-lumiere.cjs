// Essai des effets de la carte mère, pour choisir l'ambiance en jeu : `npx electron tools/essai-lumiere.cjs`, CAPRI
// fermée (le service d'éclairage n'accepte qu'un client). Une petite fenêtre en haut à gauche de l'écran principal
// affiche le numéro et le nom de l'effet que jouent les ventilateurs, 8 s chacun, puis tout se ferme.
const { app, BrowserWindow, screen } = require('electron');
const net = require('net');

const CYAN = '0 240 255', JAUNE = '252 238 10', ROUGE = '255 0 60';
const ESSAIS = [
  ['Steady', 0, CYAN, 'Fixe cyan (référence)'],
  ['Breath', 1, CYAN, 'Breath cyan, vitesse 1'],
  ['Breath', 3, CYAN, 'Breath cyan, vitesse 3'],
  ['Meteor', 1, CYAN, 'Meteor cyan, vitesse 1'],
  ['Meteor', 3, CYAN, 'Meteor cyan, vitesse 3'],
  ['Wave', 1, CYAN, 'Wave cyan, vitesse 1'],
  ['Wave', 3, CYAN, 'Wave cyan, vitesse 3'],
  ['ColorRing', 1, CYAN, 'ColorRing cyan, vitesse 1'],
  ['ColorRing', 3, CYAN, 'ColorRing cyan, vitesse 3'],
  ['Flame', 3, ROUGE, 'Flame rouge, vitesse 3'],
  ['Lightning', 1, JAUNE, 'Lightning jaune, vitesse 1'],
  ['Lightning', 3, JAUNE, 'Lightning jaune, vitesse 3'],
];
const DUREE = 8000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => app.exit(2), ESSAIS.length * DUREE + 30000);

app.whenReady().then(async () => {
  const { x, y } = screen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({ x: x + 24, y: y + 24, width: 560, height: 120, frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, focusable: false, backgroundColor: '#0d1017' });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true);
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<body style="margin:0;font:600 30px Bahnschrift,sans-serif;color:#4ff3ff;background:#0d1017;border:2px solid #f80030;height:116px;box-sizing:border-box;padding:14px 20px">
    <div id="n" style="font-size:16px;color:#f80030;letter-spacing:.15em">ESSAI LUMIÈRE</div><div id="t">Connexion…</div></body>`));
  const show = (n, t) => win.webContents.executeJavaScript(`n.textContent=${JSON.stringify(n)};t.textContent=${JSON.stringify(t)};0`);

  const pipe = net.connect('\\\\.\\pipe\\capri-lumiere');
  pipe.on('error', async () => { await show('ERREUR', 'Service introuvable ou CAPRI ouverte'); await sleep(5000); app.exit(1); });
  await new Promise((r) => pipe.once('connect', r));
  for (let i = 0; i < ESSAIS.length; i++) {
    const [style, vitesse, couleur, nom] = ESSAIS[i];
    pipe.write(`essai ${style} ${vitesse} ${couleur}\n`);
    await show(`ESSAI ${i + 1} / ${ESSAIS.length}`, nom);
    await sleep(DUREE);
  }
  await show('FIN', 'Tu peux me dire les numéros que tu préfères');
  await sleep(4000);
  pipe.end();
  app.exit(0);
});
