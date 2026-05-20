import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
    auditRepository,
    roomConfigRepository,
    roomOnboardingRepository,
    roomRepository,
} from '../db/repositories'
import { getRoomSessionWindow } from './pi-execution-adapter/runtime-snapshots'
import { createRoomThread, sendRoomThreadMessage } from './pi-execution-adapter/thread-operations'
import { roomProcessSnapshot } from './runtime-lifecycle'
import {
    defaultPersonalityForm,
    sanitizePersonalityForm,
    type PersonalityForm,
} from './personality/form'
import { personalityArchetypeIds } from './personality/archetypes'
import { readRoomMemory, updateRoomMemory } from './room-memory-store'
import { emptyRoomMemory } from '../pi-runtime/memory'
import { onboardingPersonalityToolEvent } from '../pi-runtime/onboarding-personality-tool'
import { getRoomPaths } from './room-paths'

const onboardingSessionTitle = 'Getting to know this room'
const onboardingOpenerInstruction = [
    'You are opening a new coworker room onboarding chat.',
    'Infer what you can from the room name and any standing instructions already configured.',
    'Send one short assistant message that welcomes the operator, reflects what you already understand,',
    'and asks a single open question about the room purpose and preferred working style.',
    'Do not mention onboarding, system prompts, or internal setup.',
].join(' ')

const onboardingLocks = new Map<string, Promise<void>>()

function withRoomOnboardingLock<T>(roomId: string, work: () => Promise<T>): Promise<T> {
    const previous = onboardingLocks.get(roomId) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(work)
    const stored = run
        .then(
            () => undefined,
            () => undefined,
        )
        .finally(() => {
            if (onboardingLocks.get(roomId) === stored) {
                onboardingLocks.delete(roomId)
            }
        })
    onboardingLocks.set(roomId, stored)
    return run
}

async function mergePersonalityIntoMemory(roomId: string, form: PersonalityForm): Promise<void> {
    const snapshot = await readRoomMemory(roomId)
    const next = {
        ...snapshot.memory,
        personality: form,
    }
    await updateRoomMemory({
        roomId,
        memory: next,
        expectedHash: snapshot.hash,
    })
}

async function runtimeIsHealthy(roomId: string): Promise<boolean> {
    const process = await roomProcessSnapshot(roomId)
    return process.running
}

async function onboardingSessionHasAssistantMessage(input: {
    roomId: string
    sessionKey: string
}): Promise<boolean> {
    try {
        const window = await getRoomSessionWindow({
            roomId: input.roomId,
            sessionKey: input.sessionKey,
            limitRows: 20,
        })
        return window.rows.some(
            (row) => row.type === 'assistant_final' && row.message.text.trim().length > 0,
        )
    } catch {
        return false
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function runtimePersonalityEventPayload(value: unknown): Record<string, unknown> | null {
    if (!isRecord(value)) {
        return null
    }
    if (value.event !== onboardingPersonalityToolEvent) {
        return null
    }
    return isRecord(value.payload) ? value.payload : null
}

async function findRuntimePersonalityEvent(input: {
    roomId: string
    sessionKey: string
    runId: string | null
}): Promise<Record<string, unknown> | null> {
    if (!input.runId) {
        return null
    }
    let raw = ''
    try {
        raw = await readFile(
            join(getRoomPaths(input.roomId).engineStateDir, 'runtime-events.jsonl'),
            'utf8',
        )
    } catch {
        return null
    }
    const lines = raw.split(/\r?\n/).filter(Boolean).reverse()
    for (const line of lines) {
        let parsed: unknown
        try {
            parsed = JSON.parse(line)
        } catch {
            continue
        }
        if (!isRecord(parsed)) {
            continue
        }
        if (parsed.sessionKey !== input.sessionKey || parsed.runId !== input.runId) {
            continue
        }
        const payload = runtimePersonalityEventPayload(parsed)
        if (payload) {
            return payload
        }
    }
    return null
}

export async function ensureRoomOnboardingStarted(roomId: string): Promise<{
    sessionKey: string | null
    started: boolean
}> {
    return withRoomOnboardingLock(roomId, async () => {
        const onboarding = await roomOnboardingRepository.getOrCreate(roomId)
        if (onboarding.status !== 'pending') {
            return {
                sessionKey: onboarding.sessionKey,
                started: false,
            }
        }

        if (!(await runtimeIsHealthy(roomId))) {
            return {
                sessionKey: onboarding.sessionKey,
                started: false,
            }
        }

        if (
            onboarding.sessionKey &&
            (await onboardingSessionHasAssistantMessage({
                roomId,
                sessionKey: onboarding.sessionKey,
            }))
        ) {
            return {
                sessionKey: onboarding.sessionKey,
                started: false,
            }
        }

        const room = await roomRepository.findRoomById(roomId)
        const config = await roomConfigRepository.getOrCreate(roomId)
        const instruction = [
            onboardingOpenerInstruction,
            `Room name: ${room?.displayName ?? 'Room'}`,
            config.instructions.trim()
                ? `Standing instructions: ${config.instructions.trim()}`
                : 'Standing instructions: none yet',
        ].join('\n')
        const createdSession = !onboarding.sessionKey
        const thread = onboarding.sessionKey
            ? { key: onboarding.sessionKey }
            : await createRoomThread({
                  roomId,
                  firstMessage: null,
                  title: onboardingSessionTitle,
                  kind: 'onboarding',
                  hideUserMessage: true,
                  awaitInitialRun: true,
                  internalInstruction: instruction,
              })

        if (onboarding.sessionKey) {
            await sendRoomThreadMessage({
                roomId,
                sessionKey: onboarding.sessionKey,
                message: instruction,
                hideUserMessage: true,
                awaitCompletion: true,
            })
        }

        if (createdSession) {
            await roomOnboardingRepository.update({
                roomId,
                status: 'pending',
                sessionKey: thread.key,
            })

            await auditRepository.appendEvent({
                actorUserId: null,
                roomId,
                action: 'room.onboarding_started',
                payload: {
                    sessionKey: thread.key,
                },
            })
        }

        return {
            sessionKey: thread.key,
            started: true,
        }
    })
}

export async function completeOnboardingAfterPersonalityTool(input: {
    roomId: string
    sessionKey: string
    runId: string | null
}): Promise<{ completed: boolean }> {
    return withRoomOnboardingLock(input.roomId, async () => {
        const onboarding = await roomOnboardingRepository.findByRoomId(input.roomId)
        if (!onboarding || onboarding.status !== 'pending') {
            return { completed: false }
        }
        if (onboarding.sessionKey !== input.sessionKey) {
            return { completed: false }
        }
        const event = await findRuntimePersonalityEvent(input)
        if (!event) {
            return { completed: false }
        }
        await roomOnboardingRepository.update({
            roomId: input.roomId,
            status: 'completed',
            completedAt: new Date(),
        })
        await auditRepository.appendEvent({
            actorUserId: null,
            roomId: input.roomId,
            action: 'room.onboarding_completed',
            payload: {
                sessionKey: input.sessionKey,
                archetype: typeof event.archetype === 'string' ? event.archetype : null,
                tone: typeof event.tone === 'string' ? event.tone : null,
                directness: typeof event.directness === 'string' ? event.directness : null,
                reportStyle: typeof event.reportStyle === 'string' ? event.reportStyle : null,
                humor: typeof event.humor === 'string' ? event.humor : null,
                challengeStyle:
                    typeof event.challengeStyle === 'string' ? event.challengeStyle : null,
            },
        })
        return { completed: true }
    })
}

export async function saveRoomPersonality(input: {
    roomId: string
    form: unknown
    actorUserId: string
}): Promise<PersonalityForm> {
    const form = sanitizePersonalityForm(input.form)
    if (!(personalityArchetypeIds as readonly string[]).includes(form.archetype)) {
        throw new Error('Unknown personality archetype')
    }
    await mergePersonalityIntoMemory(input.roomId, form)
    await auditRepository.appendEvent({
        actorUserId: input.actorUserId,
        roomId: input.roomId,
        action: 'room.personality_updated',
        payload: {
            archetype: form.archetype,
            tone: form.tone,
            directness: form.directness,
            reportStyle: form.reportStyle,
            humor: form.humor,
            challengeStyle: form.challengeStyle,
            hasNotes: form.notes.trim().length > 0,
        },
    })
    return form
}

export async function getRoomPersonality(roomId: string): Promise<PersonalityForm> {
    try {
        const snapshot = await readRoomMemory(roomId)
        const personality = (snapshot.memory as { personality?: unknown }).personality
        if (personality) {
            return sanitizePersonalityForm(personality)
        }
    } catch {}
    return defaultPersonalityForm()
}

export async function seedDefaultRoomMemory(roomId: string): Promise<void> {
    const memory = emptyRoomMemory()
    const withPersonality = {
        ...memory,
        personality: defaultPersonalityForm(),
    }
    await updateRoomMemory({
        roomId,
        memory: withPersonality,
    })
}

export async function beginRoomOnboarding(roomId: string): Promise<void> {
    await roomOnboardingRepository.getOrCreate(roomId)
    const existing = await roomOnboardingRepository.findByRoomId(roomId)
    if (existing?.status === 'completed') {
        return
    }
    await roomOnboardingRepository.update({
        roomId,
        status: 'pending',
        sessionKey: null,
        completedAt: null,
        deferredAt: null,
    })
}

export const __testing = {
    findRuntimePersonalityEvent,
    onboardingSessionTitle,
}
