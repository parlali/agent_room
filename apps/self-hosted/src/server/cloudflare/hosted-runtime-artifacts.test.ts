import type { R2Bucket } from '@cloudflare/workers-types'
import { describe, expect, it } from 'vitest'
import type { AgentRoomHostedEnv } from './bindings'
import { readHostedRuntimeArtifactText } from './hosted-runtime-artifacts'

describe('hosted runtime artifacts', () => {
    it('fails closed on legacy plaintext R2 artifacts', async () => {
        const env = {
            AGENT_ROOM_WORKSPACE_BUCKET: {
                get: async () => ({
                    text: async () => 'plaintext-token',
                }),
            } as unknown as R2Bucket,
        } as AgentRoomHostedEnv

        await expect(
            readHostedRuntimeArtifactText({
                env,
                key: 'workspaces/workspace_1/rooms/room_1/runtime/token-v1.txt',
            }),
        ).rejects.toThrow(/not encrypted/)
    })
})
