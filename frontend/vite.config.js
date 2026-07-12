import { defineConfig, mergeConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SHARED_VITE_CONFIG = '/packages/shizuha-ui/vite.shared.js'
const serviceName = 'home'

function findSharedPackageRoot() {
  return [
    process.env.SHIZUHA_PACKAGES_DIR,
    '/packages',
    resolve(__dirname, '../../packages'),
  ]
    .filter(Boolean)
    .find((root) =>
      existsSync(resolve(root, 'shizuha-ui', 'src')) &&
      existsSync(resolve(root, 'shizuha-chat', 'src'))
    )
}

function createSharedPackageAliases() {
  const packageRoot = findSharedPackageRoot()

  if (!packageRoot) {
    return {}
  }

  return {
    '@shizuha/ui': resolve(packageRoot, 'shizuha-ui/src'),
    '@shizuha/chat': resolve(packageRoot, 'shizuha-chat/src'),
  }
}

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
    resolve: {
      alias: createSharedPackageAliases(),
      // HIVE-694: pin react resolution to this app's copy (see overlay below).
      dedupe: ['react', 'react-dom'],
    },
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
      resolve: {
        // Keep local monorepo checkouts working when /packages is absent.
        // In prod/Origin CI the shared /packages vite config supplies the same aliases.
        alias: createSharedPackageAliases(),
        // HIVE-694 (2026-07-12): the @shizuha/ui|chat aliases point at package
        // SOURCE under /packages, whose npm install (peer auto-install) plants
        // a NESTED react/react-dom there. Under vite 6 (PLAT-4316-4330 bump)
        // imports of 'react' from inside those packages resolved to the nested
        // copy → TWO reacts in the prod bundle → hooks dispatcher null →
        // "Cannot read properties of null (reading 'useState')" crash on
        // shizuha.com. dedupe forces a single react from this app's root.
        dedupe: ['react', 'react-dom'],
      },
    })
  )
})
