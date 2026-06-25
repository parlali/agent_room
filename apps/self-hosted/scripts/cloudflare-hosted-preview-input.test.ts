import { describe, expect, it } from 'vitest'
import {
    buildHostedPreviewNames,
    resolveHostedPreviewTarget,
} from './cloudflare-hosted-preview-input'

const repository = 'example/agent-room'

function pullRequest(overrides: Record<string, unknown> = {}): unknown {
    return {
        state: 'open',
        head: {
            repo: {
                full_name: repository,
            },
            sha: 'a'.repeat(40),
        },
        ...overrides,
    }
}

describe('hosted Cloudflare preview input', () => {
    it('builds canonical preview names from a pull request number', () => {
        expect(buildHostedPreviewNames('42', 'agent-room')).toEqual({
            prNumber: '42',
            workerName: 'agent-room-hosted-pr-42',
            d1DatabaseName: 'agent-room-hosted-pr-42',
            r2BucketName: 'agent-room-hosted-pr-42-workspaces',
            queueName: 'agent-room-hosted-pr-42-runtime-jobs',
            url: 'https://agent-room-hosted-pr-42.agent-room.workers.dev',
        })
    })

    it('resolves only open same-repository pull request heads', () => {
        expect(
            resolveHostedPreviewTarget({
                prNumber: '42',
                workersSubdomain: 'agent-room',
                repository,
                pullRequest: pullRequest(),
            }),
        ).toMatchObject({
            prNumber: '42',
            headSha: 'a'.repeat(40),
            workerName: 'agent-room-hosted-pr-42',
        })
    })

    it('rejects fork pull requests before exposing a checkout ref', () => {
        expect(() =>
            resolveHostedPreviewTarget({
                prNumber: '42',
                workersSubdomain: 'agent-room',
                repository,
                pullRequest: pullRequest({
                    head: {
                        repo: {
                            full_name: 'contributor/agent_room',
                        },
                        sha: 'a'.repeat(40),
                    },
                }),
            }),
        ).toThrow(/forks/)
    })

    it('rejects closed pull requests', () => {
        expect(() =>
            resolveHostedPreviewTarget({
                prNumber: '42',
                workersSubdomain: 'agent-room',
                repository,
                pullRequest: pullRequest({
                    state: 'closed',
                }),
            }),
        ).toThrow(/open pull request/)
    })

    it('rejects unsafe dispatch inputs', () => {
        expect(() => buildHostedPreviewNames('42; env', 'agent-room')).toThrow(/positive integer/)
        expect(() => buildHostedPreviewNames('42', 'agent_room')).toThrow(/workers.dev/)
    })

    it('rejects malformed pull request head SHAs', () => {
        expect(() =>
            resolveHostedPreviewTarget({
                prNumber: '42',
                workersSubdomain: 'agent-room',
                repository,
                pullRequest: pullRequest({
                    head: {
                        repo: {
                            full_name: repository,
                        },
                        sha: 'refs/pull/42/head',
                    },
                }),
            }),
        ).toThrow(/head SHA/)
    })
})
