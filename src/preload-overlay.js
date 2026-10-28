// Calque de l'écran principal : il reçoit ce que CAPRI affiche, et porte le panneau des messages (Win + Maj + F).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('capriOverlay', {
  onMessage: (handler) => ipcRenderer.on('overlay:message', (_event, message) => handler(message)),
  onPanel: (handler) => ipcRenderer.on('overlay:panel', (_event, open) => handler(open === true)),
  onHistory: (handler) => ipcRenderer.on('overlay:history', (_event, history) => handler(history)),
  send: (text) => ipcRenderer.send('overlay:send', String(text)),
  close: () => ipcRenderer.send('overlay:close'),
  mouse: (inside) => ipcRenderer.send('overlay:mouse', inside === true),
});
