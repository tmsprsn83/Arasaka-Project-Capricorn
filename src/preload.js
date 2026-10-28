const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('capri', {
  ask: (text) => ipcRenderer.invoke('capri:ask', text),
  reset: () => ipcRenderer.invoke('capri:reset'),
  window: (action) => ipcRenderer.send('capri:window', action),
  lumiere: (on) => ipcRenderer.send('capri:lumiere', !!on),
  hasOverlay: () => ipcRenderer.invoke('capri:has-overlay'),
  notifications: () => ipcRenderer.invoke('capri:notifications'),
  settings: () => ipcRenderer.invoke('capri:settings'),
  setSetting: (key, value) => ipcRenderer.invoke('capri:set', key, value),
  onSettings: (handler) => ipcRenderer.on('capri:settings', (_event, value) => handler(value)),
  overlay: (text, speaking, quiet) => ipcRenderer.send('capri:overlay', { text: String(text), speaking: !!speaking, quiet: !!quiet }),
  onText: (handler) => ipcRenderer.on('capri:text', (_event, chunk) => handler(chunk)),
  onDone: (handler) => ipcRenderer.on('capri:done', (_event, value) => handler(value)),
  onWake: (handler) => ipcRenderer.on('capri:wake', (_event, text) => handler(text)),
  onMusique: (handler) => ipcRenderer.on('capri:musique', (_event, info) => handler(info)),
  volume: (delta) => ipcRenderer.send('capri:volume', Number(delta)),
  onJeu: (handler) => ipcRenderer.on('capri:jeu', (_event, state) => handler(state)),
  onSend: (handler) => ipcRenderer.on('capri:send', (_event, text) => handler(text)), // tapé dans le panneau des messages
  messages: () => ipcRenderer.send('capri:messages'), // ouvre ou ferme le panneau des messages
  onFullscreen: (handler) => ipcRenderer.on('capri:fullscreen', (_event, on) => handler(on)),
});
