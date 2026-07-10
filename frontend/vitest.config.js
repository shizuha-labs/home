import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.js'],
    exclude: ['**/node_modules/**', '**/tests/**', '**/scripts/**'],
  },
  resolve: {
    alias: {
      '@shizuha/ui': '/packages/shizuha-ui/src',
      '@shizuha/chat': '/packages/shizuha-chat/src',
    },
  },
})
