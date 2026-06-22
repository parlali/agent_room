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

        expect(steps.map((step) => step.args)).toEqual([
            [
                'queues',
                'consumer',
                'remove',
                'agent-room-hosted-pr-123-runtime-jobs',
                'agent-room-hosted-pr-123',
            ],
            ['delete', 'agent-room-hosted-pr-123', '--force'],
            ['d1', 'delete', 'agent-room-hosted-pr-123', '--skip-confirmation'],
            ['queues', 'delete', 'agent-room-hosted-pr-123-runtime-jobs'],
            ['r2', 'bucket', 'delete', 'agent-room-hosted-pr-123-workspaces'],
        ])
    })
})
