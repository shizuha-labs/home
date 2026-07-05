import { defineConfig, mergeConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const SHARED_VITE_CONFIG = '/packages/shizuha-ui/vite.shared.js'
const serviceName = 'home'

function createFallbackShizuhaConfig({ port, serviceName }) {
  const basePath = process.env.VITE_BASE_PATH || '/'
  const allowedHosts = [
    'localhost',
    `shizuha-${serviceName}-frontend`,
    'nginx',
    'shizuha-nginx',
    'shizuha-nginx-dev',
    '.shizuha.com',
    `shizuha-shizuha-${serviceName}-frontend`,
    '.svc.cluster.local',
  ]

  return {
    base: basePath,
    optimizeDeps: {
      include: ['lucide-react'],
    },
    server: {
      host: '0.0.0.0',
      port,
      allowedHosts,
      hmr: process.env.VITE_HMR_DISABLE === 'true' ? false : true,
      watch: { usePolling: true },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
  }
}

async function loadCreateShizuhaConfig() {
  if (!existsSync(SHARED_VITE_CONFIG)) {
    return createFallbackShizuhaConfig
  }

  const shared = await import(pathToFileURL(SHARED_VITE_CONFIG).href)
  return shared.createShizuhaConfig
}

export default defineConfig(async () => {
  const createShizuhaConfig = await loadCreateShizuhaConfig()

  return mergeConfig(
    createShizuhaConfig({ port: 80, serviceName }),
    defineConfig({
      plugins: [react()],
    })
  )
})
