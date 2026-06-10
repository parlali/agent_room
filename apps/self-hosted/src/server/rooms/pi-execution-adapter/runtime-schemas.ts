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

export const snapshotSchema = z.custom<PiRuntimeSnapshotPayload>(
    (value) => typeof value === 'object' && value !== null,
)
export const sessionWindowSchema = z.custom<PiRuntimeSessionWindowPayload>(
    (value) => typeof value === 'object' && value !== null,
)
export const createThreadSchema = z.custom<PiRuntimeThreadCreatePayload>(
    (value) => typeof value === 'object' && value !== null,
)
export const sendSchema = z.custom<PiRuntimeSendPayload>(
    (value) => typeof value === 'object' && value !== null,
)
export const abortSchema = z.custom<PiRuntimeAbortPayload>(
    (value) => typeof value === 'object' && value !== null,
)
export const compactSchema = z.custom<PiRuntimeCompactPayload>(
    (value) => typeof value === 'object' && value !== null,
)
export const forkSchema = z.custom<PiRuntimeForkPayload>(
    (value) => typeof value === 'object' && value !== null,
)
export const threadModelSchema = z.custom<PiRuntimeThreadModelPayload>(
    (value) => typeof value === 'object' && value !== null,
)

export const sessionMutationSchema = z
    .object({
        ok: z.boolean(),
    })
    .passthrough()
