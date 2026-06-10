import { fileURLToPath, URL } from 'node:url'
import { join } from 'node:path'

import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { agentRoomBrandAssets, agentRoomMarketingAssetsDev } from '@agent-room/brand/vite'

import { marketingWaitlistApi } from './src/vite/waitlist-api'

const defaultAllowedHosts = ['.ts.net']
const packageRoot = fileURLToPath(new URL('.', import.meta.url))
const defaultWaitlistDatabasePath = join(packageRoot, '.data', 'waitlist.sqlite')

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
        plugins: [
            react(),
            tailwindcss(),
            agentRoomBrandAssets({ target: 'marketing' }),
            agentRoomMarketingAssetsDev(),
            marketingWaitlistApi({
                databasePath: env.MARKETING_WAITLIST_DB ?? defaultWaitlistDatabasePath,
                rateLimitPerHour: Number(env.MARKETING_WAITLIST_RATE_LIMIT ?? '8'),
            }),
        ],
        resolve: {
            alias: {
                '~': fileURLToPath(new URL('./src', import.meta.url)),
            },
        },
        server: {
            host: '0.0.0.0',
            port: 3100,
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
