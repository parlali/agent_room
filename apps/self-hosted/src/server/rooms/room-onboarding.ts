import { readdir, readFile } from 'node:fs/promises'
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
import { readRoomMemory, updateRoomMemory } from './room-memory-store'
import { emptyRoomMemory } from '../pi-runtime/memory'
import { onboardingPersonalityToolEvent } from '../pi-runtime/onboarding-personality-tool'
import { getRoomPaths } from './room-paths'

const onboardingSessionTitle = 'Getting to know this room'
const runtimeEventsFileName = 'runtime-events.jsonl'
const legacyOnboardingPersonalityToolEvent = 'tool.personality_update'
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
    if (
        value.event !== onboardingPersonalityToolEvent &&
        value.event !== legacyOnboardingPersonalityToolEvent
    ) {
        return null
    }
    return isRecord(value.payload) ? value.payload : null
}

async function runtimeEventFileNames(engineStateDir: string): Promise<string[]> {
    let entries: string[]
    try {
        entries = await readdir(engineStateDir)
    } catch {
        return [runtimeEventsFileName]
    }
    const names = entries.filter(
        (name) => name === runtimeEventsFileName || /^runtime-events\.jsonl\.\d+$/.test(name),
    )
    if (!names.includes(runtimeEventsFileName)) {
        names.push(runtimeEventsFileName)
    }
    return names.sort((left, right) => {
        if (left === runtimeEventsFileName) return -1
        if (right === runtimeEventsFileName) return 1
        const leftIndex = Number(left.slice(`${runtimeEventsFileName}.`.length))
        const rightIndex = Number(right.slice(`${runtimeEventsFileName}.`.length))
        return leftIndex - rightIndex
    })
}

async function readRuntimeEventLines(roomId: string): Promise<string[]> {
    const engineStateDir = getRoomPaths(roomId).engineStateDir
    const fileNames = await runtimeEventFileNames(engineStateDir)
    const lines: string[] = []
    for (const fileName of fileNames) {
        let raw = ''
        try {
            raw = await readFile(join(engineStateDir, fileName), 'utf8')
        } catch {
            continue
        }
        lines.push(...raw.split(/\r?\n/).filter(Boolean).reverse())
    }
    return lines
}

async function findRuntimePersonalityEvent(input: {
    roomId: string
    sessionKey: string
    runId?: string | null
}): Promise<Record<string, unknown> | null> {
    const lines = await readRuntimeEventLines(input.roomId)
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
        if (parsed.sessionKey !== input.sessionKey) {
            continue
        }
        if (input.runId && parsed.runId !== input.runId) {
            continue
        }
        const payload = runtimePersonalityEventPayload(parsed)
        if (payload) {
            return payload
        }
    }
    return null
}

async function markOnboardingCompleted(input: {
    roomId: string
    sessionKey: string
    event: Record<string, unknown>
    source: string
}): Promise<void> {
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
            archetype: typeof input.event.archetype === 'string' ? input.event.archetype : null,
            tone: typeof input.event.tone === 'string' ? input.event.tone : null,
            directness: typeof input.event.directness === 'string' ? input.event.directness : null,
            reportStyle:
                typeof input.event.reportStyle === 'string' ? input.event.reportStyle : null,
            humor: typeof input.event.humor === 'string' ? input.event.humor : null,
            challengeStyle:
                typeof input.event.challengeStyle === 'string' ? input.event.challengeStyle : null,
            source: input.source,
        },
    })
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
                  awaitInitialRun: false,
                  internalInstruction: instruction,
              })

        if (onboarding.sessionKey) {
            await sendRoomThreadMessage({
                roomId,
                sessionKey: onboarding.sessionKey,
                message: instruction,
                hideUserMessage: true,
                awaitCompletion: false,
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
        await markOnboardingCompleted({
            roomId: input.roomId,
            sessionKey: input.sessionKey,
            event,
            source: 'send_result',
        })
        return { completed: true }
    })
}

export async function syncRoomOnboardingCompletion(
    roomId: string,
): Promise<{ completed: boolean }> {
    return withRoomOnboardingLock(roomId, async () => {
        const onboarding = await roomOnboardingRepository.findByRoomId(roomId)
        if (!onboarding || onboarding.status !== 'pending' || !onboarding.sessionKey) {
            return { completed: false }
        }
        const event = await findRuntimePersonalityEvent({
            roomId,
            sessionKey: onboarding.sessionKey,
        })
        if (!event) {
            return { completed: false }
        }
        await markOnboardingCompleted({
            roomId,
            sessionKey: onboarding.sessionKey,
            event,
            source: 'runtime_event_sync',
        })
        return { completed: true }
    })
}

export function scheduleOnboardingCompletionCheck(input: {
    roomId: string
    sessionKey: string
    runId: string | null
}): void {
    void pollOnboardingCompletion(input).catch((error) => {
        console.error(
            `Failed to reconcile onboarding completion for room ${input.roomId}`,
            error instanceof Error ? error.message : error,
        )
    })
}

async function pollOnboardingCompletion(input: {
    roomId: string
    sessionKey: string
    runId: string | null
}): Promise<void> {
    const delays = [
        250, 250, 500, 500, 1000, 1000, 1000, 1000, 1500, 1500, 2000, 2000, 3000, 3000, 5000, 5000,
        10000, 10000,
    ]
    for (const delay of delays) {
        await new Promise((resolve) => setTimeout(resolve, delay))
        const result = await completeOnboardingAfterPersonalityTool(input)
        if (result.completed) {
            return
        }
    }
}

export async function deferRoomOnboarding(input: {
    roomId: string
    sessionKey?: string | null
    source: string
}): Promise<{ deferred: boolean }> {
    return withRoomOnboardingLock(input.roomId, async () => {
        const onboarding = await roomOnboardingRepository.findByRoomId(input.roomId)
        if (!onboarding || onboarding.status !== 'pending') {
            return { deferred: false }
        }
        if (input.sessionKey && onboarding.sessionKey !== input.sessionKey) {
            return { deferred: false }
        }
        await roomOnboardingRepository.update({
            roomId: input.roomId,
            status: 'user_deferred',
            deferredAt: new Date(),
        })
        await auditRepository.appendEvent({
            actorUserId: null,
            roomId: input.roomId,
            action: 'room.onboarding_deferred',
            payload: {
                sessionKey: onboarding.sessionKey,
                source: input.source,
            },
        })
        return { deferred: true }
    })
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
