import { describe, expect, it } from 'vitest'
import {
    assertHostedResourceNamesDeletable,
    buildPreviewDeleteSteps,
} from './cloudflare-delete-hosted-preview'

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

    it('refuses production resource deletion without the explicit reset guard', () => {
        const previous = process.env.AGENT_ROOM_CLOUDFLARE_ALLOW_HOSTED_PRODUCTION_RESET
        delete process.env.AGENT_ROOM_CLOUDFLARE_ALLOW_HOSTED_PRODUCTION_RESET
        try {
            expect(() =>
                assertHostedResourceNamesDeletable({
                    workerName: 'agent-room-hosted',
                    d1DatabaseName: 'agent-room-hosted',
                    r2BucketName: 'agent-room-hosted-workspaces',
                    queueName: 'agent-room-hosted-runtime-jobs',
                }),
            ).toThrow(/reset guard/)
        } finally {
            if (previous === undefined) {
                delete process.env.AGENT_ROOM_CLOUDFLARE_ALLOW_HOSTED_PRODUCTION_RESET
            } else {
                process.env.AGENT_ROOM_CLOUDFLARE_ALLOW_HOSTED_PRODUCTION_RESET = previous
            }
        }
    })

    it('allows canonical production reset only with the explicit reset guard', () => {
        const previous = process.env.AGENT_ROOM_CLOUDFLARE_ALLOW_HOSTED_PRODUCTION_RESET
        process.env.AGENT_ROOM_CLOUDFLARE_ALLOW_HOSTED_PRODUCTION_RESET = 'true'
        try {
            expect(() =>
                assertHostedResourceNamesDeletable({
                    workerName: 'agent-room-hosted',
                    d1DatabaseName: 'agent-room-hosted',
                    r2BucketName: 'agent-room-hosted-workspaces',
                    queueName: 'agent-room-hosted-runtime-jobs',
                }),
            ).not.toThrow()
            expect(() =>
                assertHostedResourceNamesDeletable({
                    workerName: 'agent-room-hosted-other',
                    d1DatabaseName: 'agent-room-hosted',
                    r2BucketName: 'agent-room-hosted-workspaces',
                    queueName: 'agent-room-hosted-runtime-jobs',
                }),
            ).toThrow(/reset guard/)
        } finally {
            if (previous === undefined) {
                delete process.env.AGENT_ROOM_CLOUDFLARE_ALLOW_HOSTED_PRODUCTION_RESET
            } else {
                process.env.AGENT_ROOM_CLOUDFLARE_ALLOW_HOSTED_PRODUCTION_RESET = previous
            }
        }
    })
})
