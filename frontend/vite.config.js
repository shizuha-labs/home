import { defineConfig, mergeConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync } from 'node:fs'

const ABS_UI_SHARED_CONFIG = '/packages/shizuha-ui/vite.shared.js'
const ABS_UI_SRC = '/packages/shizuha-ui/src'

function createPackageBackedShizuhaConfig({ port, serviceName }) {
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
  // Use the monorepo shared config only when the shared source tree is really
  // present. Without /packages, Vite should resolve @shizuha/ui/@shizuha/chat
  // from installed packages instead of aliasing them to missing source paths.
  if (existsSync(ABS_UI_SHARED_CONFIG) && existsSync(ABS_UI_SRC)) {
    return (await import(ABS_UI_SHARED_CONFIG)).createShizuhaConfig
  }
  return createPackageBackedShizuhaConfig
}

export default defineConfig(async () => {
  const createShizuhaConfig = await loadCreateShizuhaConfig()

  return mergeConfig(
    createShizuhaConfig({ port: 80, serviceName: 'home' }),
    defineConfig({
      plugins: [react()],
    })
  )
})
