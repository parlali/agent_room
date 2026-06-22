import { describe, expect, it } from 'vitest'
import { buildPreviewDeleteSteps } from './cloudflare-delete-hosted-preview'

describe('hosted Cloudflare preview deletion', () => {
    it('removes the queue consumer before deleting the worker', () => {
        const steps = buildPreviewDeleteSteps({
            workerName: 'agent-room-hosted-pr-123',
            d1DatabaseName: 'agent-room-hosted-pr-123',
            r2BucketName: 'agent-room-hosted-pr-123-workspaces',
            queueName: 'agent-room-hosted-pr-123-runtime-jobs',
        })

        expect(steps).toMatchObject([
            {
                type: 'wrangler',
                args: [
                    'queues',
                    'consumer',
                    'remove',
                    'agent-room-hosted-pr-123-runtime-jobs',
                    'agent-room-hosted-pr-123',
                ],
            },
            {
                type: 'worker-script',
                scriptName: 'agent-room-hosted-pr-123',
            },
            {
                type: 'wrangler',
                args: ['d1', 'delete', 'agent-room-hosted-pr-123', '--skip-confirmation'],
            },
            {
                type: 'wrangler',
                args: ['queues', 'delete', 'agent-room-hosted-pr-123-runtime-jobs'],
            },
            {
                type: 'wrangler',
                args: ['r2', 'bucket', 'delete', 'agent-room-hosted-pr-123-workspaces'],
            },
        ])
    })
})
