import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

const headers = { 'Cross-Origin-Opener-Policy': 'same-origin-allow-popups' }

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, headers },
  preview: { headers },
  build: {
    // The PDF chunk (jsPDF) is large but lazy-loaded only when a bill PDF is built.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('firebase')) return 'firebase'
          if (/jspdf|html2canvas|canvg|dompurify|qrcode|fflate/.test(id)) return 'pdf'
          if (/react|scheduler/.test(id)) return 'react'
        },
      },
    },
  },
})
