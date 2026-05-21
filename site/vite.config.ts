import { fileURLToPath, URL } from 'node:url'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
    root: fileURLToPath(new URL('.', import.meta.url)),
    publicDir: fileURLToPath(new URL('../public', import.meta.url)),
    resolve: {
        alias: {
            '#': fileURLToPath(new URL('../src', import.meta.url)),
        },
    },
    plugins: [tailwindcss(), viteReact()],
    build: {
        outDir: 'dist',
        emptyOutDir: true,
    },
})
