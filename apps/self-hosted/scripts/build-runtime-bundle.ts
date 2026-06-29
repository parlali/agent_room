declare const Bun: {
    build: (options: {
        entrypoints: string[]
        target?: string
        format?: string
        minify?: boolean
        splitting?: boolean
        external?: string[]
        outdir?: string
        naming?: { entry?: string; chunk?: string; asset?: string }
    }) => Promise<{ success: boolean; logs: unknown[]; outputs: unknown[] }>
}

const result = await Bun.build({
    entrypoints: ['src/server/pi-runtime/main.ts'],
    target: 'bun',
    format: 'esm',
    minify: true,
    splitting: true,
    external: [
        '@silvia-odwyer/photon-node',
        '@modelcontextprotocol/sdk',
        '@anthropic-ai/sdk',
        '@aws-sdk/client-bedrock-runtime',
        '@google/genai',
        '@mistralai/mistralai',
    ],
    outdir: 'dist/runtime',
    naming: {
        entry: '[name].[ext]',
        chunk: '[name]-[hash].[ext]',
        asset: '[name]-[hash].[ext]',
    },
})

if (!result.success) {
    for (const log of result.logs) {
        console.error(log)
    }
    throw new Error('Runtime bundle build failed')
}

console.log(`Runtime bundle built: ${result.outputs.length} files in dist/runtime`)
