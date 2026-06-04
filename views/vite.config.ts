import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import fs from 'fs'

const workbenchTarget = process.env.WORKBENCH_PROXY_TARGET || 'http://127.0.0.1:4180'

function generateVersion() {
  return {
    name: 'generate-version',
    closeBundle() {
      const version = new Date().getTime().toString()
      const dir = path.resolve(__dirname, 'dist')
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(path.resolve(dir, 'version.json'), JSON.stringify({ version }))
      console.log(`\n✅ Generated version.json with version: ${version}`)
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), generateVersion()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: ['remotion', '@remotion/player', 'react', 'react-dom'],
  },
  server: {
    proxy: {
      '/api': {
        target: workbenchTarget,
        changeOrigin: true,
        timeout: 300000, // 5 分钟超时，防止大模型分镜生成被前端代理掐断
      },
      '/temp': {
        target: workbenchTarget,
        changeOrigin: true,
      },
      '/output': {
        target: workbenchTarget,
        changeOrigin: true,
      },
      '/uploads': {
        target: workbenchTarget,
        changeOrigin: true,
      },
    },
  },
})