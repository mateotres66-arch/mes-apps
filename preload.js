const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  lire: (cle) => ipcRenderer.invoke('lire', cle),
  ecrire: (cle, valeur) => ipcRenderer.invoke('ecrire', cle, valeur),
  ouvrir: (cible) => ipcRenderer.invoke('ouvrir', cible),
});
