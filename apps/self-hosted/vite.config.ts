import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import { agentRoomBrandAssets } from '@agent-room/brand/vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig({
    resolve: { tsconfigPaths: true },
    plugins: [
        devtools(),
        tailwindcss(),
        agentRoomBrandAssets({ target: 'self-hosted' }),
        tanstackStart(),
        viteReact(),
    ],
})

export default config
