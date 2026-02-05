import { defineConfig, mergeConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createShizuhaConfig } from '/packages/shizuha-ui/vite.shared.js'

export default mergeConfig(
  createShizuhaConfig({ port: 5180, serviceName: 'home' }),
  defineConfig({
    plugins: [react()],
  })
)
