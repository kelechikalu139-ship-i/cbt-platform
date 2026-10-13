import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5174,
    strictPort: false,
    proxy: {
      // The API is one origin away during development, so the browser only ever
      // talks to the Vite dev server. Point this at the machine running the
      // backend; `VITE_SERVER_ORIGIN` keeps the target configurable without
      // hardcoding it here.
      '/api': {
        target: process.env.VITE_SERVER_ORIGIN ?? 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
})
