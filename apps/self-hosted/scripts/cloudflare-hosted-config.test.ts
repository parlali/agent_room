import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
    applyHostedDeploymentTarget,
    applyHostedDeploymentTargetToConfig,
    extractHostedResourceNames,
    hostedConfigPath,
    selectD1DatabaseId,
} from './cloudflare-hosted-config'

function readHostedConfig(): string {
    return readFileSync(hostedConfigPath, 'utf8')
}

function readRepoFile(path: string): string {
    return readFileSync(join(dirname(hostedConfigPath), '../..', path), 'utf8')
}

describe('hosted Cloudflare deployment target config', () => {
    it('keeps the production resource names canonical by default', () => {
        const configText = readHostedConfig()
        expect(extractHostedResourceNames(configText)).toEqual({
            workerName: 'agent-room-hosted',
            d1DatabaseName: 'agent-room-hosted',
            r2BucketName: 'agent-room-hosted-workspaces',
            queueName: 'agent-room-hosted-runtime-jobs',
        })
        expect(configText).toContain('"crons": ["* * * * *"]')
    })

    it('overrides every preview resource name through one target', () => {
        const configText = applyHostedDeploymentTarget(readHostedConfig(), {
            workerName: 'agent-room-hosted-pr-40',
            d1DatabaseName: 'agent-room-hosted-pr-40',
            r2BucketName: 'agent-room-hosted-pr-40-workspaces',
            queueName: 'agent-room-hosted-pr-40-runtime-jobs',
            routePattern: null,
        })

        expect(extractHostedResourceNames(configText)).toEqual({
            workerName: 'agent-room-hosted-pr-40',
            d1DatabaseName: 'agent-room-hosted-pr-40',
            r2BucketName: 'agent-room-hosted-pr-40-workspaces',
            queueName: 'agent-room-hosted-pr-40-runtime-jobs',
        })
        expect(configText).not.toContain('"routes"')
        expect(configText).not.toContain('app.openagentroom.com')
    })

    it('keeps queue producers and consumers bound to the same queue', () => {
        const configText = applyHostedDeploymentTarget(readHostedConfig(), {
            queueName: 'agent-room-hosted-pr-41-runtime-jobs',
        })

        expect(Array.from(configText.matchAll(/"queue"/g))).toHaveLength(2)
        expect(configText.match(/agent-room-hosted-pr-41-runtime-jobs/g)).toHaveLength(2)
    })

    it('targets built Wrangler config resources and containers', () => {
        const config = applyHostedDeploymentTargetToConfig(
            {
                name: 'agent-room-hosted',
                topLevelName: 'agent-room-hosted',
                routes: [
                    {
                        pattern: 'app.openagentroom.com',
                        custom_domain: true,
                    },
                ],
                workers_dev: true,
                preview_urls: false,
                d1_databases: [
                    {
                        binding: 'AGENT_ROOM_DB',
                        database_name: 'agent-room-hosted',
                    },
                ],
                r2_buckets: [
                    {
                        binding: 'AGENT_ROOM_WORKSPACE_BUCKET',
                        bucket_name: 'agent-room-hosted-workspaces',
                    },
                ],
                queues: {
                    producers: [
                        {
                            binding: 'AGENT_ROOM_RUNTIME_JOBS',
                            queue: 'agent-room-hosted-runtime-jobs',
                        },
                    ],
                    consumers: [
                        {
                            queue: 'agent-room-hosted-runtime-jobs',
                        },
                    ],
                },
                containers: [
                    {
                        class_name: 'AgentRoomRuntimeContainer',
                        name: 'agent-room-hosted-agentroomruntimecontainer',
                    },
                ],
            },
            {
                workerName: 'agent-room-hosted-pr-42',
                d1DatabaseName: 'agent-room-hosted-pr-42',
                r2BucketName: 'agent-room-hosted-pr-42-workspaces',
                queueName: 'agent-room-hosted-pr-42-runtime-jobs',
                routePattern: null,
                workersDev: true,
                previewUrls: true,
            },
        )

        expect(config.routes).toBeUndefined()
        expect(config.containers).toEqual([
            {
                class_name: 'AgentRoomRuntimeContainer',
                name: 'agent-room-hosted-pr-42-agentroomruntimecontainer',
            },
        ])
        expect(extractHostedResourceNames(JSON.stringify(config))).toEqual({
            workerName: 'agent-room-hosted-pr-42',
            d1DatabaseName: 'agent-room-hosted-pr-42',
            r2BucketName: 'agent-room-hosted-pr-42-workspaces',
            queueName: 'agent-room-hosted-pr-42-runtime-jobs',
        })
    })

    it('uses the dedicated lean runtime image for hosted containers', () => {
        const configText = readHostedConfig()
        const image = configText.match(/"image":\s*"([^"]+)"/)?.[1]
        const runtimeDockerfile = readRepoFile('Dockerfile.cloudflare-runtime')

        expect(image).toBe('../../Dockerfile.cloudflare-runtime')
        expect(configText).not.toContain('"image": "../../Dockerfile"')
        expect(runtimeDockerfile).not.toContain('libreoffice')
        expect(runtimeDockerfile).not.toContain('pandoc')
        expect(runtimeDockerfile).not.toContain('ghostscript')
        expect(runtimeDockerfile).not.toContain('poppler-utils')
        expect(runtimeDockerfile).not.toContain('qpdf')
        expect(runtimeDockerfile).toContain(
            'CMD ["bun", "--no-env-file", "run", "src/server/pi-runtime/main.ts"]',
        )
    })

    it('validates explicit D1 database ids against the targeted database name', () => {
        const databases = [
            {
                uuid: 'database-prod',
                name: 'agent-room-hosted',
            },
            {
                uuid: 'database-preview',
                name: 'agent-room-hosted-pr-40',
            },
        ]

        expect(selectD1DatabaseId('agent-room-hosted', databases)).toBe('database-prod')
        expect(selectD1DatabaseId('agent-room-hosted-pr-40', databases, 'database-preview')).toBe(
            'database-preview',
        )
        expect(() =>
            selectD1DatabaseId('agent-room-hosted-pr-40', databases, 'database-prod'),
        ).toThrow(/CLOUDFLARE_D1_DATABASE_ID/)
    })
})
