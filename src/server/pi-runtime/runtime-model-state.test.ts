import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
    createTestPiRuntimeConfig,
    ensureTestPiRuntimeDirectories,
    type TestPiRuntimeConfigOptions,
} from './test-runtime-defaults'
import { createRuntimeModelState } from './runtime-model-state'
import { normalizeThreadRecord } from './thread-records'
import type { ActiveThread } from './runtime-runner'
import type { RoomExecutionModelState } from '../rooms/execution-types'

async function withModelState<T>(
    provider: TestPiRuntimeConfigOptions['provider'],
    speedMode: 'normal' | 'fast' | null,
    fn: (state: RoomExecutionModelState | null) => T,
): Promise<T> {
    const root = await mkdtemp(join(tmpdir(), 'agent-room-model-state-'))
    const config = createTestPiRuntimeConfig({
        root,
        provider,
    })
    await ensureTestPiRuntimeDirectories(config)
    const record = normalizeThreadRecord({
        key: 'thread',
        sessionFile: join(root, 'missing-session.jsonl'),
        sessionId: 'thread',
        title: 'Thread',
        status: 'idle',
        createdAt: 1,
        updatedAt: 1,
        modelProvider: config.provider.piProvider,
        model: config.provider.piModel,
        thinkingLevel: 'medium',
        speedMode,
    })

    try {
        return fn(
            createRuntimeModelState({
                config,
                activeThreads: new Map<string, ActiveThread>(),
            }).selectedThreadModelState(record),
        )
    } finally {
        await rm(root, {
            recursive: true,
            force: true,
        })
    }
}

describe('runtime model state', () => {
    it('exposes fast and normal speed modes for OpenAI Codex response models', async () => {
        await withModelState(
            {
                sourceProvider: 'openai-codex',
                sourceModel: 'openai-codex/gpt-5.5',
                piProvider: 'openai-codex',
                piModel: 'gpt-5.5',
                api: 'openai-codex-responses',
                authMode: 'oauth',
                baseUrl: null,
                envKey: null,
                kind: 'builtin',
                fallbackModels: [],
            },
            'fast',
            (state) => {
                expect(state?.speedMode).toBe('fast')
                expect(state?.availableSpeedModes).toEqual(['normal', 'fast'])
                expect(
                    state?.options.find((option) => option.value === 'openai-codex/gpt-5.5')
                        ?.availableSpeedModes,
                ).toEqual(['normal', 'fast'])
            },
        )
    })

    it('hides speed modes when the selected provider does not support them', async () => {
        await withModelState(undefined, 'fast', (state) => {
            expect(state?.speedMode).toBeNull()
            expect(state?.availableSpeedModes).toEqual([])
        })
    })
})
