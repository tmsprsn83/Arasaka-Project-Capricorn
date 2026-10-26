// Icône de CAPRI (zone de notification, fenêtre) : sa visière (visage/visage.png) sur un carré sombre arrondi.
// npx electron tools/icone.cjs → src/renderer/visage/icone.png (64 × 64) et icone@2x.png (128 × 128).
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'src', 'renderer', 'visage');
setTimeout(() => app.exit(2), 20000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('about:blank');
  const src = 'data:image/png;base64,' + fs.readFileSync(path.join(dir, 'visage.png')).toString('base64');
  for (const [name, size] of [['icone.png', 64], ['icone@2x.png', 128]]) {
    const data = await win.webContents.executeJavaScript(`new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const s = ${size}, c = document.createElement('canvas');
        c.width = c.height = s;
        const g = c.getContext('2d');
        g.fillStyle = '#1b2b33';
        g.beginPath(); g.roundRect(0, 0, s, s, s * 0.22); g.fill();
        g.strokeStyle = '#8000ff'; g.lineWidth = s * 0.05;
        g.beginPath(); g.roundRect(s * 0.025, s * 0.025, s * 0.95, s * 0.95, s * 0.2); g.stroke();
        const w = s * 0.96, h = w * img.height / img.width;
        g.shadowColor = '#00ff66'; g.shadowBlur = s * 0.06;
        g.drawImage(img, (s - w) / 2, (s - h) / 2, w, h);
        resolve(c.toDataURL('image/png').split(',')[1]);
      };
      img.src = ${JSON.stringify(src)};
    })`);
    fs.writeFileSync(path.join(dir, name), Buffer.from(data, 'base64'));
  }
  app.exit(0);
});
