import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
    applyHostedDeploymentTarget,
    extractHostedResourceNames,
    hostedConfigPath,
} from './cloudflare-hosted-config'

function readHostedConfig(): string {
    return readFileSync(hostedConfigPath, 'utf8')
}

describe('hosted Cloudflare deployment target config', () => {
    it('keeps the production resource names canonical by default', () => {
        expect(extractHostedResourceNames(readHostedConfig())).toEqual({
            workerName: 'agent-room-hosted',
            d1DatabaseName: 'agent-room-hosted',
            r2BucketName: 'agent-room-hosted-workspaces',
            queueName: 'agent-room-hosted-runtime-jobs',
        })
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
})
