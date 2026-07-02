/* ============================================================
   Electron preload — runs isolated between main and renderer.

   The web app needs no Node/Electron APIs, so only a tiny,
   read-only info object is exposed. Extend this bridge (via
   contextBridge + ipcRenderer.invoke) if native features like
   "save file without dialog" are added later.
   ============================================================ */

const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('sonitusDesktop', {
  isDesktop: true,
  platform: process.platform,
  electron: process.versions.electron,
})
