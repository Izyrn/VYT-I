const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('vytdb', {
  load: () => ipcRenderer.invoke('db:load'),
  save: (s, note) => ipcRenderer.invoke('db:save', s, note),
  recent: (n) => ipcRenderer.invoke('db:recent', n),
  reset: () => ipcRenderer.invoke('db:reset'),
  path: () => ipcRenderer.invoke('db:path'),
});
