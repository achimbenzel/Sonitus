/* ============================================================
   Electron dev launcher (`npm run electron:dev`).

   Starts the Vite dev server, waits until it responds, then
   launches Electron pointed at it. Both processes shut down
   together. No extra dependencies (no concurrently/wait-on).
   ============================================================ */

import { spawn } from 'node:child_process'
import http from 'node:http'

const PORT = 5173
const URL = `http://localhost:${PORT}`

const vite = spawn('npm', ['exec', 'vite', '--', '--port', String(PORT), '--strictPort'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

function waitForServer(retries = 100) {
  return new Promise((resolve, reject) => {
    const attempt = (left) => {
      const req = http.get(URL, (res) => {
        res.resume()
        resolve()
      })
      req.on('error', () => {
        if (left <= 0) reject(new Error(`Vite dev server did not start on ${URL}`))
        else setTimeout(() => attempt(left - 1), 200)
      })
    }
    attempt(retries)
  })
}

try {
  await waitForServer()
} catch (err) {
  console.error(String(err))
  vite.kill()
  process.exit(1)
}

const electron = spawn('npm', ['exec', 'electron', '--', '.'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, VITE_DEV_SERVER_URL: URL },
})

const shutdown = () => {
  electron.kill()
  vite.kill()
}
electron.on('exit', () => {
  vite.kill()
  process.exit(0)
})
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
