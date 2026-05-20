import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTestPiRuntimeConfig, ensureTestPiRuntimeDirectories } from './test-runtime-defaults'
import { createOnboardingPersonalityTool } from './onboarding-personality-tool'
import { ensureMemory, readMemory } from './memory'

describe('onboarding personality tool', () => {
    it('writes the canonical personality object without duplicating operator preferences', async () => {
        const root = await mkdtemp(join(tmpdir(), 'agent-room-onboarding-tool-'))
        try {
            const config = createTestPiRuntimeConfig({ root })
            await ensureTestPiRuntimeDirectories(config)
            await ensureMemory(config)
            const events: Array<{ event: string; payload: unknown }> = []
            const tool = createOnboardingPersonalityTool({
                config,
                audit: async (event, payload) => {
                    events.push({ event, payload })
                },
            })

            await tool.execute(
                'call-1',
                {
                    archetype: 'rigorous_researcher',
                    tone: 'direct',
                    directness: 'firm',
                    reportStyle: 'structured',
                    humor: 'none',
                    challengeStyle: 'pushback',
                    notes: 'Use evidence and flag uncertainty.',
                },
                undefined,
                undefined,
                {} as never,
            )

            const memory = (await readMemory(config)).memory
            expect(memory.personality).toMatchObject({
                archetype: 'rigorous_researcher',
                tone: 'direct',
                directness: 'firm',
                reportStyle: 'structured',
                humor: 'none',
                challengeStyle: 'pushback',
            })
            expect(memory.operator.preferences.some((item) => item.source === 'personality')).toBe(
                false,
            )
            expect(events).toEqual([
                expect.objectContaining({
                    event: 'tool.personality_update',
                    payload: expect.objectContaining({
                        archetype: 'rigorous_researcher',
                        hasNotes: true,
                    }),
                }),
            ])
        } finally {
            await rm(root, {
                recursive: true,
                force: true,
            })
        }
    })
})
