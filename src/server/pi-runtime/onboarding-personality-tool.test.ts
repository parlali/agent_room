import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTestPiRuntimeConfig, ensureTestPiRuntimeDirectories } from './test-runtime-defaults'
import { createOnboardingPersonalityTool } from './onboarding-personality-tool'
import { ensureMemory, readMemory } from './memory'

describe('onboarding personality tool', () => {
    it('writes personality and visible room profile memory from natural setup input', async () => {
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
                    archetype: 'Analyst',
                    tone: 'direct',
                    directness: 'firm',
                    reportStyle: 'structured',
                    humor: 'none',
                    challengeStyle: 'pushback',
                    notes: 'Use evidence and flag uncertainty.',
                    operatorFacts: ['The operator is the founder and CTO.'],
                    roomPurpose: 'Build a research copilot.',
                    currentGoals: ['Keep work practical and evidence-based.'],
                    knownUrls: ['https://example.com'],
                    openQuestions: ['Which workflows matter first?'],
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
            expect(memory.operator.facts.map((item) => item.text)).toContain(
                'The operator is the founder and CTO.',
            )
            expect(memory.currentWork.projects.map((item) => item.text)).toContain(
                'Room purpose: Build a research copilot.',
            )
            expect(memory.currentWork.goals.map((item) => item.text)).toContain(
                'Keep work practical and evidence-based.',
            )
            expect(memory.currentWork.context.map((item) => item.text)).toEqual(
                expect.arrayContaining([
                    'Reference URL: https://example.com/',
                    'Open question: Which workflows matter first?',
                ]),
            )
            expect(events).toEqual([
                expect.objectContaining({
                    event: 'tool.room_profile_update',
                    payload: expect.objectContaining({
                        archetype: 'rigorous_researcher',
                        hasNotes: true,
                        urlCount: 1,
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
