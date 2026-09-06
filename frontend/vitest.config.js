import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const __dirname = dirname(fileURLToPath(import.meta.url))

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

const packageRoot = findSharedPackageRoot()

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.js'],
    exclude: ['**/node_modules/**', '**/tests/**', '**/scripts/**'],
  },
  resolve: {
    alias: packageRoot
      ? {
          '@shizuha/ui': resolve(packageRoot, 'shizuha-ui/src'),
          '@shizuha/chat': resolve(packageRoot, 'shizuha-chat/src'),
        }
      : {
          '@shizuha/ui': '/packages/shizuha-ui/src',
          '@shizuha/chat': '/packages/shizuha-chat/src',
        },
    dedupe: ['react', 'react-dom'],
  },
})
