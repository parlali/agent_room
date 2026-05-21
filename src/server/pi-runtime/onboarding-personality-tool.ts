import { randomUUID } from 'node:crypto'
import { defineTool, type ToolDefinition } from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import {
    personalityArchetypeIds,
    personalityArchetypeLabels,
    personalityArchetypeProfiles,
    type PersonalityArchetypeId,
} from '../rooms/personality/archetypes'
import {
    maxPersonalityNotesLength,
    personalityChallengeStyleProfiles,
    personalityChallengeStyleValues,
    personalityDirectnessProfiles,
    personalityDirectnessValues,
    personalityFormForArchetype,
    personalityFormSchema,
    personalityHumorProfiles,
    personalityHumorValues,
    personalityReportStyleProfiles,
    personalityReportStyleValues,
    personalityToneProfiles,
    personalityToneValues,
    type PersonalityForm,
} from '../rooms/personality/form'
import { readMemory, replaceMemory, type MemoryItem, type RoomMemory } from './memory'
import { nowIso } from './memory-model'
import { audit, textResult, type RoomToolContext } from './room-tools/shared'

export const onboardingPersonalityToolName = 'set_room_profile'
export const onboardingPersonalityToolEvent = 'tool.room_profile_update'

const onboardingMemorySource = 'onboarding'
const maxProfileItems = 8
const maxProfileTextLength = 280

type PersonalityChoiceProfile<T extends string> = Record<T, { label: string }>

interface RoomProfileInput {
    form: PersonalityForm
    operatorFacts: string[]
    roomPurpose: string | null
    activeProjects: string[]
    currentGoals: string[]
    knownUrls: string[]
    preferences: string[]
    openQuestions: string[]
}

function normalizeKey(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[_-]+/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

function normalizeText(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const trimmed = value.replace(/\s+/g, ' ').trim()
    if (!trimmed) return null
    return trimmed.slice(0, maxProfileTextLength)
}

function normalizeTextArray(value: unknown): string[] {
    if (!Array.isArray(value)) return []
    const out: string[] = []
    const seen = new Set<string>()
    for (const item of value) {
        const text = normalizeText(item)
        if (!text) continue
        const key = normalizeKey(text)
        if (seen.has(key)) continue
        seen.add(key)
        out.push(text)
        if (out.length >= maxProfileItems) break
    }
    return out
}

function normalizeUrlArray(value: unknown): string[] {
    return normalizeTextArray(value).map((item) => {
        const candidate = item.includes('://') ? item : `https://${item}`
        const parsed = new URL(candidate)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error('knownUrls must contain public http or https URLs')
        }
        return parsed.toString()
    })
}

function normalizeChoice<T extends string>(input: {
    field: string
    value: unknown
    values: readonly T[]
    profiles: PersonalityChoiceProfile<T>
    aliases: Record<string, T>
    fallback: T
}): T {
    const text = normalizeText(input.value)
    if (!text) return input.fallback
    const key = normalizeKey(text)
    for (const value of input.values) {
        if (key === normalizeKey(value) || key === normalizeKey(input.profiles[value].label)) {
            return value
        }
    }
    const alias = input.aliases[key]
    if (alias) return alias
    throw new Error(
        `${input.field} must be one of: ${input.values.map((value) => `${value} (${input.profiles[value].label})`).join(', ')}`,
    )
}

function normalizeArchetype(
    value: unknown,
    fallback: PersonalityArchetypeId,
): PersonalityArchetypeId {
    return normalizeChoice({
        field: 'archetype',
        value,
        values: personalityArchetypeIds,
        profiles: personalityArchetypeProfiles,
        fallback,
        aliases: {
            analyst: 'rigorous_researcher',
            researcher: 'rigorous_researcher',
            evidence: 'rigorous_researcher',
            diligence: 'rigorous_researcher',
            builder: 'pragmatic_builder',
            coworker: 'pragmatic_builder',
            collaborator: 'pragmatic_builder',
            copilot: 'pragmatic_builder',
            partner: 'pragmatic_builder',
            advisor: 'strategic_challenger',
            strategist: 'strategic_challenger',
            strategy: 'strategic_challenger',
            challenger: 'strategic_challenger',
            operator: 'concise_operator',
            executor: 'concise_operator',
            concise: 'concise_operator',
            'pragmatic technical product partner': 'pragmatic_builder',
            'technical product partner': 'pragmatic_builder',
            'the builder': 'pragmatic_builder',
        },
    })
}

function normalizeRoomProfileInput(input: Record<string, unknown>): RoomProfileInput {
    const requestedArchetype = normalizeArchetype(input.archetype, 'pragmatic_builder')
    const archetypeDefaults = personalityFormForArchetype(requestedArchetype)
    const notes = normalizeText(input.notes)?.slice(0, maxPersonalityNotesLength) ?? ''
    const form = personalityFormSchema.parse({
        archetype: requestedArchetype,
        tone: normalizeChoice({
            field: 'tone',
            value: input.tone,
            values: personalityToneValues,
            profiles: personalityToneProfiles,
            fallback: archetypeDefaults.tone,
            aliases: {
                plain: 'neutral',
                professional: 'neutral',
                personable: 'warm',
                friendly: 'warm',
                blunt: 'direct',
                reserved: 'formal',
                polished: 'formal',
            },
        }),
        directness: normalizeChoice({
            field: 'directness',
            value: input.directness,
            values: personalityDirectnessValues,
            profiles: personalityDirectnessProfiles,
            fallback: archetypeDefaults.directness,
            aliases: {
                clear: 'balanced',
                careful: 'gentle',
                soft: 'gentle',
                blunt: 'firm',
                plain: 'firm',
            },
        }),
        reportStyle: normalizeChoice({
            field: 'reportStyle',
            value: input.reportStyle,
            values: personalityReportStyleValues,
            profiles: personalityReportStyleProfiles,
            fallback: archetypeDefaults.reportStyle,
            aliases: {
                short: 'concise',
                brief: 'concise',
                terse: 'concise',
                organized: 'structured',
                bullets: 'structured',
                detailed: 'narrative',
                explanatory: 'narrative',
            },
        }),
        humor: normalizeChoice({
            field: 'humor',
            value: input.humor,
            values: personalityHumorValues,
            profiles: personalityHumorProfiles,
            fallback: archetypeDefaults.humor,
            aliases: {
                no: 'none',
                never: 'none',
                occasional: 'light',
                understated: 'dry',
            },
        }),
        challengeStyle: normalizeChoice({
            field: 'challengeStyle',
            value: input.challengeStyle,
            values: personalityChallengeStyleValues,
            profiles: personalityChallengeStyleProfiles,
            fallback: archetypeDefaults.challengeStyle,
            aliases: {
                careful: 'supportive',
                questions: 'supportive',
                default: 'balanced',
                challenge: 'pushback',
                challenging: 'pushback',
                rigorous: 'pushback',
            },
        }),
        notes,
    })

    return {
        form,
        operatorFacts: normalizeTextArray(input.operatorFacts),
        roomPurpose: normalizeText(input.roomPurpose),
        activeProjects: normalizeTextArray(input.activeProjects),
        currentGoals: normalizeTextArray(input.currentGoals),
        knownUrls: normalizeUrlArray(input.knownUrls),
        preferences: normalizeTextArray(input.preferences),
        openQuestions: normalizeTextArray(input.openQuestions),
    }
}

function onboardingItem(text: string, tags: string[], priority = 3): MemoryItem {
    return {
        id: randomUUID(),
        text,
        createdAt: nowIso(),
        source: onboardingMemorySource,
        priority,
        tags,
    }
}

function replaceOnboardingItems(existing: MemoryItem[], nextItems: MemoryItem[]): MemoryItem[] {
    return [...existing.filter((item) => item.source !== onboardingMemorySource), ...nextItems]
}

function applyRoomProfile(memory: RoomMemory, profile: RoomProfileInput): RoomMemory {
    const projectItems = [
        ...(profile.roomPurpose
            ? [onboardingItem(`Room purpose: ${profile.roomPurpose}`, ['room-purpose'], 4)]
            : []),
        ...profile.activeProjects.map((project) =>
            onboardingItem(`Active project: ${project}`, ['project'], 4),
        ),
    ]
    const contextItems = [
        ...profile.knownUrls.map((url) => onboardingItem(`Reference URL: ${url}`, ['url'], 3)),
        ...profile.openQuestions.map((question) =>
            onboardingItem(`Open question: ${question}`, ['open-question'], 2),
        ),
    ]

    return {
        ...memory,
        personality: profile.form,
        operator: {
            ...memory.operator,
            facts: replaceOnboardingItems(
                memory.operator.facts,
                profile.operatorFacts.map((fact) => onboardingItem(fact, ['operator'], 4)),
            ),
            preferences: replaceOnboardingItems(
                memory.operator.preferences,
                profile.preferences.map((preference) =>
                    onboardingItem(preference, ['preference'], 3),
                ),
            ),
        },
        currentWork: {
            ...memory.currentWork,
            goals: replaceOnboardingItems(
                memory.currentWork.goals,
                profile.currentGoals.map((goal) => onboardingItem(goal, ['goal'], 4)),
            ),
            projects: replaceOnboardingItems(memory.currentWork.projects, projectItems),
            context: replaceOnboardingItems(memory.currentWork.context, contextItems),
        },
    }
}

export function createOnboardingPersonalityTool(ctx: RoomToolContext): ToolDefinition {
    return defineTool({
        name: onboardingPersonalityToolName,
        label: 'Set Room Profile',
        description:
            'Save the room intro as structured personality, operator facts, purpose, URLs, goals, and open questions.',
        promptSnippet:
            'set_room_profile saves the durable room profile. Natural labels are accepted for style fields.',
        parameters: Type.Object({
            archetype: Type.Optional(Type.String()),
            tone: Type.Optional(Type.String()),
            directness: Type.Optional(Type.String()),
            reportStyle: Type.Optional(Type.String()),
            humor: Type.Optional(Type.String()),
            challengeStyle: Type.Optional(Type.String()),
            notes: Type.Optional(Type.String()),
            operatorFacts: Type.Optional(Type.Array(Type.String())),
            roomPurpose: Type.Optional(Type.String()),
            activeProjects: Type.Optional(Type.Array(Type.String())),
            currentGoals: Type.Optional(Type.Array(Type.String())),
            knownUrls: Type.Optional(Type.Array(Type.String())),
            preferences: Type.Optional(Type.Array(Type.String())),
            openQuestions: Type.Optional(Type.Array(Type.String())),
        }),
        execute: async (_toolCallId, input) => {
            const profile = normalizeRoomProfileInput(input as Record<string, unknown>)
            const snapshot = await readMemory(ctx.config)
            await replaceMemory({
                config: ctx.config,
                expectedHash: snapshot.hash,
                memory: applyRoomProfile(snapshot.memory, profile),
            })
            await audit(ctx, 'room_profile_update', {
                archetype: profile.form.archetype,
                tone: profile.form.tone,
                directness: profile.form.directness,
                reportStyle: profile.form.reportStyle,
                humor: profile.form.humor,
                challengeStyle: profile.form.challengeStyle,
                hasNotes: profile.form.notes.length > 0,
                operatorFactCount: profile.operatorFacts.length,
                projectCount: profile.activeProjects.length + (profile.roomPurpose ? 1 : 0),
                goalCount: profile.currentGoals.length,
                urlCount: profile.knownUrls.length,
                preferenceCount: profile.preferences.length,
                openQuestionCount: profile.openQuestions.length,
            })
            return textResult(
                `Saved room profile: ${personalityArchetypeLabels[profile.form.archetype]}`,
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
        'Your job is to capture durable room setup information, not to complete a normal task.',
        'Ask one concise open question if the operator has not answered yet.',
        'If the operator shares a public website URL, you may fetch that exact URL once to understand durable public context when fetch_url is available.',
        `When you have enough setup context, call ${onboardingPersonalityToolName} exactly once.`,
        `Use archetype ids when possible: ${personalityArchetypeIds.join(', ')}. Natural labels are accepted, but ids are safest.`,
        'Save only durable facts, preferences, room purpose, active projects, useful URLs, goals, and open questions.',
        'Do not store secrets, provider tokens, OAuth details, account identifiers, raw transcript text, or bulky fetched content.',
        'After the tool succeeds, send a short acknowledgment naming what was saved and invite the operator to give the first task.',
        'Do not perform unrelated work or mention internal setup.',
        '',
        basePrompt,
    ].join('\n')
}

export const __testing = {
    applyRoomProfile,
    normalizeRoomProfileInput,
}
