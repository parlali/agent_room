import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
    brandWebAssetCatalog,
    brandWebTargets,
    formatWebManifest,
    marketingAssetCatalog,
    type BrandWebTarget,
} from './web-assets.ts'

type EmittedAsset = {
    type: 'asset'
    fileName: string
    source: string | Uint8Array
}

type BrandAssetPluginContext = {
    emitFile: (asset: EmittedAsset) => void
}

type BrandViteEnvironment = {
    name?: string
    config?: {
        build?: {
            outDir?: string
        }
        consumer?: string
    }
}

type BrandAssetPlugin = {
    name: string
    apply?: 'build'
    applyToEnvironment?: (environment: BrandViteEnvironment) => boolean | BrandAssetPlugin
    generateBundle?: (this: BrandAssetPluginContext) => void
    configureServer?: (server: {
        middlewares: {
            use: (
                path: string,
                handler: (
                    request: { url?: string; method?: string },
                    response: {
                        statusCode: number
                        setHeader: (name: string, value: string) => void
                        end: (body?: Buffer) => void
                    },
                    next: () => void,
                ) => void,
            ) => void
        }
    }) => void
}

export type AgentRoomBrandAssetsOptions = {
    target: BrandWebTarget
}

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

export function agentRoomBrandAssets(options: AgentRoomBrandAssetsOptions): BrandAssetPlugin {
    const emitter = createBrandAssetEmitter(options.target)

    return {
        name: `agent-room-brand-assets:${options.target}`,
        apply: 'build',
        applyToEnvironment(environment) {
            return isClientEnvironment(environment)
                ? createBrandAssetEmitter(options.target)
                : false
        },
        generateBundle: emitter.generateBundle,
    }
}

function createBrandAssetEmitter(target: BrandWebTarget): BrandAssetPlugin {
    const targetConfig = brandWebTargets[target]

    return {
        name: `agent-room-brand-assets:${target}:emit`,
        apply: 'build',
        generateBundle() {
            for (const assetKey of targetConfig.assets) {
                const asset = brandWebAssetCatalog[assetKey]

                this.emitFile({
                    type: 'asset',
                    fileName: asset.fileName,
                    source: readFileSync(join(packageRoot, asset.sourcePath)),
                })
            }

            if (targetConfig.manifest) {
                this.emitFile({
                    type: 'asset',
                    fileName: 'site.webmanifest',
                    source: formatWebManifest(targetConfig.manifest),
                })
            }

            if (targetConfig.robotsTxt) {
                this.emitFile({
                    type: 'asset',
                    fileName: 'robots.txt',
                    source: targetConfig.robotsTxt,
                })
            }

            for (const assetKey of targetConfig.marketingAssets ?? []) {
                const asset = marketingAssetCatalog[assetKey]

                this.emitFile({
                    type: 'asset',
                    fileName: asset.fileName,
                    source: readFileSync(join(packageRoot, asset.sourcePath)),
                })
            }
        },
    }
}

export function agentRoomMarketingAssetsDev(): BrandAssetPlugin {
    return {
        name: 'agent-room-marketing-assets-dev',
        configureServer(server) {
            for (const asset of Object.values(marketingAssetCatalog)) {
                const urlPath = `/${asset.fileName}`
                const filePath = join(packageRoot, asset.sourcePath)

                server.middlewares.use(urlPath, (request, response, next) => {
                    if (!request.url || request.method !== 'GET') {
                        next()
                        return
                    }

                    if (!existsSync(filePath)) {
                        next()
                        return
                    }

                    response.setHeader('content-type', 'image/png')
                    response.end(readFileSync(filePath))
                })
            }
        },
    }
}

function isClientEnvironment(environment: BrandViteEnvironment): boolean {
    const outDir = environment.config?.build?.outDir

    if (environment.name === 'client' || environment.config?.consumer === 'client') {
        return true
    }

    return outDir ? outDir.split(/[\\/]/).includes('client') : false
}
