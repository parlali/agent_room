import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { agentRoomBrandAssets } from '@agent-room/brand/vite'

const defaultAllowedHosts = ['.ts.net']

function allowedHostsFromEnv(rawHosts: string | undefined): string[] {
    const configuredHosts =
        rawHosts
            ?.split(',')
            .map((host) => host.trim())
            .filter(Boolean) ?? []

    return Array.from(new Set([...defaultAllowedHosts, ...configuredHosts]))
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '')

    return {
        plugins: [react(), tailwindcss(), agentRoomBrandAssets({ target: 'marketing' })],
        server: {
            host: '0.0.0.0',
            port: 3000,
            strictPort: true,
            allowedHosts: allowedHostsFromEnv(env.VITE_ALLOWED_HOSTS),
        },
        build: {
            outDir: 'dist',
            emptyOutDir: true,
            sourcemap: false,
        },
    }
})
