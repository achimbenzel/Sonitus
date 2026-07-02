/* ============================================================
   Electron main process for Sonitus Dither Studio.

   The renderer is the unmodified Vite web app: in development it
   loads the Vite dev server (VITE_DEV_SERVER_URL, set by
   electron/dev.mjs), in production it loads the built dist/
   bundle from disk. The renderer gets NO Node access — the app is
   a pure web app and needs none (contextIsolation + sandbox on,
   nodeIntegration off, minimal preload).

   TODO before shipping:
   - app icon: set build.icon in electron-builder.yml
     (icon.icns / icon.ico / 512x512 png in a build/ folder)
   - appId / productName: adjust in electron-builder.yml
   - macOS signing & notarization: see comments in electron-builder.yml
   ============================================================ */

const { app, BrowserWindow, shell } = require('electron')
const path = require('node:path')

const DEV_URL = process.env.VITE_DEV_SERVER_URL

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 620,
    title: 'Sonitus — Dither Studio',
    backgroundColor: '#071318', // matches --paper, avoids white flash
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // Keep the title set by the app, not by document.title changes.
  win.on('page-title-updated', (e) => e.preventDefault())

  // Any external link opens in the system browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (DEV_URL) {
    win.loadURL(DEV_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    // macOS: re-create a window when the dock icon is clicked.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // macOS convention: keep the app alive until Cmd+Q.
  if (process.platform !== 'darwin') app.quit()
})
