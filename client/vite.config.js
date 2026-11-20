import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { networkInterfaces } from 'os'

const SERVER_PORT = parseInt(process.env.PORT) || 3001
const SERVER_HOST = process.env.HOST || '0.0.0.0'

// Resolve the proxy target — use localhost since Vite's server runs on the same machine
const proxyTarget = `http://127.0.0.1:${SERVER_PORT}`

export default defineConfig({
  plugins: [react()],
  server: {
    host: SERVER_HOST === '0.0.0.0' ? true : SERVER_HOST,
    port: parseInt(process.env.CLIENT_PORT) || 5173,
    proxy: {
      '/api': proxyTarget,
      '/socket.io': { target: proxyTarget, ws: true }
    }
  }
})
