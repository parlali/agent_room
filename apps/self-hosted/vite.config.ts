import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { agentRoomBrandAssets } from '@agent-room/brand/vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const cloudflareTarget = process.env.AGENT_ROOM_DEPLOY_TARGET === 'cloudflare'

const config = defineConfig(async () => {
    const cloudflarePlugins = cloudflareTarget
        ? (await import('@cloudflare/vite-plugin')).cloudflare({
              configPath: 'wrangler.hosted.jsonc',
              viteEnvironment: { name: 'ssr' },
          })
        : []

    return {
        resolve: { tsconfigPaths: true },
        plugins: [
            ...cloudflarePlugins,
            devtools(),
            tailwindcss(),
            agentRoomBrandAssets({ target: 'self-hosted' }),
            tanstackStart(),
            viteReact(),
        ],
    }
})

export default config
