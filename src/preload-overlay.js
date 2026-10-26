// Calque de l'écran principal : il ne fait que recevoir ce que CAPRI affiche.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('capriOverlay', {
  onMessage: (handler) => ipcRenderer.on('overlay:message', (_event, message) => handler(message)),
});
