import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'

export const internalStateDocumentKinds = ['memory', 'plan', 'tasks', 'decisions'] as const

export type InternalStateDocumentKind = (typeof internalStateDocumentKinds)[number]

export interface InternalStateDocumentPolicy {
    kind: InternalStateDocumentKind
    fileName: string
    maxBytes: number
    title: string
    initialContent: string
}

export interface InternalStateDocumentSnapshot {
    kind: InternalStateDocumentKind
    fileName: string
    path: string
    content: string
    byteLength: number
    maxBytes: number
    truncated: boolean
    sha256: string
}

export interface InternalStateSummary {
    text: string
    byteLength: number
    maxBytes: number
    truncated: boolean
    documents: InternalStateDocumentSnapshot[]
}

export const internalStatePolicy = {
    maxInjectedBytes: 16000,
    documents: [
        {
            kind: 'memory',
            fileName: 'memory.md',
            maxBytes: 12000,
            title: 'Memory',
            initialContent:
                '# Memory\n\nDurable room memory goes here. Store only stable facts, preferences, constraints, and handoff notes. Do not store raw chat history or secrets.\n',
        },
        {
            kind: 'plan',
            fileName: 'plan.md',
            maxBytes: 8000,
            title: 'Plan',
            initialContent:
                '# Plan\n\nCurrent objective, approach, blockers, and completion criteria go here. Keep this current and concise.\n',
        },
        {
            kind: 'tasks',
            fileName: 'tasks.md',
            maxBytes: 8000,
            title: 'Tasks',
            initialContent:
                '# Tasks\n\n- [ ] Track active work here when a request needs multiple steps.\n',
        },
        {
            kind: 'decisions',
            fileName: 'decisions.md',
            maxBytes: 8000,
            title: 'Decisions',
            initialContent:
                '# Decisions\n\nDurable implementation and operating decisions go here. Keep entries short and dated when useful.\n',
        },
    ] satisfies InternalStateDocumentPolicy[],
} as const

export function internalStateDocumentPolicy(
    kind: InternalStateDocumentKind,
): InternalStateDocumentPolicy {
    const policy = internalStatePolicy.documents.find((document) => document.kind === kind)
    if (!policy) {
        throw new Error(`Unknown internal state document ${kind}`)
    }
    return policy
}

export function isInternalStateDocumentKind(value: unknown): value is InternalStateDocumentKind {
    return (
        typeof value === 'string' &&
        internalStateDocumentKinds.includes(value as InternalStateDocumentKind)
    )
}

export function internalStateDocumentPath(
    config: PiRuntimeConfig,
    kind: InternalStateDocumentKind,
): string {
    return join(config.paths.internalStateDir, internalStateDocumentPolicy(kind).fileName)
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex')
}

function boundUtf8(
    input: string,
    maxBytes: number,
): {
    text: string
    truncated: boolean
} {
    const buffer = Buffer.from(input)
    if (buffer.byteLength <= maxBytes) {
        return {
            text: input,
            truncated: false,
        }
    }
    return {
        text: buffer.subarray(0, maxBytes).toString('utf8'),
        truncated: true,
    }
}

function assertContentWithinCap(kind: InternalStateDocumentKind, content: string): void {
    const policy = internalStateDocumentPolicy(kind)
    const byteLength = Buffer.byteLength(content)
    if (byteLength > policy.maxBytes) {
        throw new Error(
            `${policy.fileName} is ${byteLength} bytes; hard cap is ${policy.maxBytes} bytes`,
        )
    }
}

async function exists(path: string): Promise<boolean> {
    try {
        await access(path, fsConstants.F_OK)
        return true
    } catch {
        return false
    }
}

export async function ensureInternalState(config: PiRuntimeConfig): Promise<void> {
    await mkdir(config.paths.internalStateDir, {
        recursive: true,
        mode: 0o700,
    })
    await Promise.all(
        internalStatePolicy.documents.map(async (document) => {
            const path = internalStateDocumentPath(config, document.kind)
            if (await exists(path)) {
                return
            }
            await writeFile(path, document.initialContent, {
                encoding: 'utf8',
                mode: 0o600,
            })
        }),
    )
}

export async function readInternalStateDocument(
    config: PiRuntimeConfig,
    kind: InternalStateDocumentKind,
): Promise<InternalStateDocumentSnapshot> {
    const policy = internalStateDocumentPolicy(kind)
    const path = internalStateDocumentPath(config, kind)
    await ensureInternalState(config)
    const raw = await readFile(path, 'utf8')
    const bounded = boundUtf8(raw, policy.maxBytes)
    return {
        kind,
        fileName: policy.fileName,
        path,
        content: bounded.text,
        byteLength: Buffer.byteLength(raw),
        maxBytes: policy.maxBytes,
        truncated: bounded.truncated,
        sha256: sha256(bounded.text),
    }
}

export async function writeInternalStateDocument(input: {
    config: PiRuntimeConfig
    kind: InternalStateDocumentKind
    content: string
    expectedSha256?: string | null
}): Promise<InternalStateDocumentSnapshot> {
    const content = input.content.trimEnd() + '\n'
    assertContentWithinCap(input.kind, content)
    const previous = await readInternalStateDocument(input.config, input.kind)
    if (input.expectedSha256 && input.expectedSha256 !== previous.sha256) {
        throw new Error(`${previous.fileName} changed before update; read it again`)
    }
    await writeFile(previous.path, content, {
        encoding: 'utf8',
        mode: 0o600,
    })
    return readInternalStateDocument(input.config, input.kind)
}

export async function buildInternalStateSummary(
    config: PiRuntimeConfig,
): Promise<InternalStateSummary> {
    const documents = await Promise.all(
        internalStateDocumentKinds.map((kind) => readInternalStateDocument(config, kind)),
    )
    const sections = documents.map((document) =>
        [
            `## ${document.fileName} (${document.byteLength}/${document.maxBytes} bytes)`,
            document.content.trim() || '(empty)',
            document.truncated ? '[document truncated at hard cap]' : '',
        ]
            .filter(Boolean)
            .join('\n'),
    )
    const raw = [
        'Internal agent state is hidden from room files and capped. It is not chat history.',
        ...sections,
    ].join('\n\n')
    const bounded = boundUtf8(raw, internalStatePolicy.maxInjectedBytes)
    return {
        text: bounded.text,
        byteLength: Buffer.byteLength(raw),
        maxBytes: internalStatePolicy.maxInjectedBytes,
        truncated: bounded.truncated,
        documents,
    }
}
