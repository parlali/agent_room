import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
    plugins: [react(), tailwindcss()],
    server: {
        port: 4321,
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        sourcemap: false,
    },
})
