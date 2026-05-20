import { defineTool, type ToolDefinition } from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import {
    personalityArchetypeIds,
    personalityArchetypeLabels,
} from '../rooms/personality/archetypes'
import {
    maxPersonalityNotesLength,
    personalityChallengeStyleValues,
    personalityDirectnessValues,
    personalityFormSchema,
    personalityHumorValues,
    personalityReportStyleValues,
    personalityToneValues,
} from '../rooms/personality/form'
import { readMemory, replaceMemory } from './memory'
import { audit, textResult, type RoomToolContext } from './room-tools/shared'

export const onboardingPersonalityToolName = 'set_personality'
export const onboardingPersonalityToolEvent = 'tool.personality_update'

function literalUnion(values: readonly string[]) {
    return Type.Union(values.map((value) => Type.Literal(value)))
}

export function createOnboardingPersonalityTool(ctx: RoomToolContext): ToolDefinition {
    return defineTool({
        name: onboardingPersonalityToolName,
        label: 'Set Personality',
        description:
            'Save the room working style from the operator intro as structured personality settings.',
        promptSnippet:
            'set_personality saves the structured room working style. Use it once after the operator answers the intro question.',
        parameters: Type.Object({
            archetype: literalUnion(personalityArchetypeIds),
            tone: literalUnion(personalityToneValues),
            directness: literalUnion(personalityDirectnessValues),
            reportStyle: literalUnion(personalityReportStyleValues),
            humor: literalUnion(personalityHumorValues),
            challengeStyle: literalUnion(personalityChallengeStyleValues),
            notes: Type.Optional(Type.String()),
        }),
        execute: async (_toolCallId, input) => {
            const parsed = personalityFormSchema.parse({
                archetype: input.archetype,
                tone: input.tone,
                directness: input.directness,
                reportStyle: input.reportStyle,
                humor: input.humor,
                challengeStyle: input.challengeStyle,
                notes: String(input.notes ?? '')
                    .trim()
                    .slice(0, maxPersonalityNotesLength),
            })
            const snapshot = await readMemory(ctx.config)
            await replaceMemory({
                config: ctx.config,
                expectedHash: snapshot.hash,
                memory: {
                    ...snapshot.memory,
                    personality: parsed,
                },
            })
            await audit(ctx, 'personality_update', {
                archetype: parsed.archetype,
                tone: parsed.tone,
                directness: parsed.directness,
                reportStyle: parsed.reportStyle,
                humor: parsed.humor,
                challengeStyle: parsed.challengeStyle,
                hasNotes: parsed.notes.length > 0,
            })
            return textResult(
                `Saved working style: ${personalityArchetypeLabels[parsed.archetype]}`,
                {
                    status: 'saved',
                },
            )
        },
    })
}

export function onboardingSystemPrompt(basePrompt: string): string {
    return [
        'You are running the room intro chat.',
        'Your only job is to understand how the operator wants this room to work with them.',
        'Ask one concise open question if the operator has not answered yet.',
        `When the operator answers, call ${onboardingPersonalityToolName} exactly once with structured working-style settings.`,
        'Summarize any notes as bounded working-style preferences; do not copy private prompts, project names, credentials, account names, or raw transcript text into notes.',
        'After the tool succeeds, send a short acknowledgment naming the chosen working style in user-friendly terms and invite the operator to give the first task.',
        'Do not perform unrelated work, use other tools, or mention internal setup.',
        '',
        basePrompt,
    ].join('\n')
}
