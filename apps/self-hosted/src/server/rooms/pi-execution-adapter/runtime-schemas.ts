import { z } from 'zod'

import type {
    PiRuntimeAbortPayload,
    PiRuntimeCompactPayload,
    PiRuntimeForkPayload,
    PiRuntimeSendPayload,
    PiRuntimeSnapshotPayload,
    PiRuntimeSessionWindowPayload,
    PiRuntimeThreadModelPayload,
    PiRuntimeThreadCreatePayload,
} from '../../pi-runtime/protocol'

const thinkingLevelSchema = z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'])
const speedModeSchema = z.enum(['normal', 'fast'])
const modelOptionSchema = z.object({
    value: z.string(),
    provider: z.string(),
    model: z.string(),
    label: z.string(),
    supportsReasoning: z.boolean(),
    availableThinkingLevels: z.array(thinkingLevelSchema),
    availableSpeedModes: z.array(speedModeSchema),
})

export const snapshotSchema = z.custom<PiRuntimeSnapshotPayload>(
    (value) => typeof value === 'object' && value !== null,
)
export const sessionWindowSchema = z.custom<PiRuntimeSessionWindowPayload>(
    (value) => typeof value === 'object' && value !== null,
)
export const createThreadSchema = z
    .object({
        key: z.string().min(1),
    })
    .passthrough() satisfies z.ZodType<PiRuntimeThreadCreatePayload>

export const sendSchema = z
    .object({
        runId: z.string().nullable(),
        status: z.string(),
        messageSeq: z.number().int().nullable(),
        interruptedActiveRun: z.boolean(),
        error: z.string().nullable(),
    })
    .passthrough() satisfies z.ZodType<PiRuntimeSendPayload>

export const abortSchema = z
    .object({
        abortedRunId: z.string().nullable(),
        status: z.string(),
    })
    .passthrough() satisfies z.ZodType<PiRuntimeAbortPayload>

export const compactSchema = z
    .object({
        status: z.string(),
        error: z.string().nullable(),
        compactionCount: z.number().int(),
    })
    .passthrough() satisfies z.ZodType<PiRuntimeCompactPayload>

export const forkSchema = z
    .object({
        key: z.string().min(1),
        parentThreadKey: z.string().min(1),
        parentSessionFile: z.string().min(1),
    })
    .passthrough() satisfies z.ZodType<PiRuntimeForkPayload>

export const threadModelSchema = z
    .object({
        value: z.string(),
        provider: z.string(),
        model: z.string(),
        label: z.string(),
        thinkingLevel: thinkingLevelSchema,
        availableThinkingLevels: z.array(thinkingLevelSchema),
        speedMode: speedModeSchema.nullable(),
        availableSpeedModes: z.array(speedModeSchema),
        options: z.array(modelOptionSchema),
    })
    .passthrough() satisfies z.ZodType<PiRuntimeThreadModelPayload>

export const memorySnapshotSchema = z
    .object({
        memory: z.unknown(),
        hash: z.string(),
        brief: z.string(),
    })
    .passthrough()

export const sessionMutationSchema = z
    .object({
        ok: z.boolean(),
    })
    .passthrough()
