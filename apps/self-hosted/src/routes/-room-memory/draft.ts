import { useEffect, useState } from 'react'
import { BotIcon, LockIcon, UserIcon } from 'lucide-react'

import {
    canonicalMemoryJson,
    memorySectionPaths,
    nowIso,
    sectionItems,
    setSectionItems,
    type MemoryItem,
    type MemorySectionPath,
    type RoomMemory,
    type TimedMemoryItem,
} from '#/domain/room-memory'
import type { PersonalityForm } from '#/server/rooms/personality/form'

export interface DomainDraft<T> {
    draft: T
    baseline: T
    version: string
    dirty: boolean
    conflicted: boolean
    setDraft: (updater: T | ((current: T) => T)) => void
    revert: () => void
    commit: (value: T, version: string) => void
    adoptServer: () => void
}

export function useDomainDraft<T>(params: {
    scope: string
    server: T | undefined
    version: string | null
    clone: (value: T) => T
    equals: (a: T, b: T) => boolean
}): DomainDraft<T> | null {
    const { scope, server, version, clone, equals } = params
    const [snap, setSnap] = useState<{
        scope: string
        version: string
        draft: T
        baseline: T
    } | null>(null)

    useEffect(() => {
        if (server === undefined || version === null) {
            setSnap(null)
            return
        }

        setSnap((current) => {
            if (!current || current.scope !== scope) {
                return { scope, version, draft: clone(server), baseline: clone(server) }
            }
            if (current.version === version) return current
            if (equals(server, current.draft)) {
                return { scope, version, draft: current.draft, baseline: clone(server) }
            }
            if (equals(current.draft, current.baseline)) {
                return { scope, version, draft: clone(server), baseline: clone(server) }
            }
            return current
        })
    }, [clone, equals, scope, server, version])

    if (server === undefined || version === null || !snap || snap.scope !== scope) return null

    const dirty = !equals(snap.draft, snap.baseline)
    const conflicted =
        server !== undefined &&
        version !== null &&
        snap.version !== version &&
        dirty &&
        !equals(server, snap.draft)

    return {
        draft: snap.draft,
        baseline: snap.baseline,
        version: snap.version,
        dirty,
        conflicted,
        setDraft: (updater) =>
            setSnap((current) => {
                if (!current) return current
                const next =
                    typeof updater === 'function'
                        ? (updater as (value: T) => T)(current.draft)
                        : updater
                return { ...current, draft: next }
            }),
        revert: () =>
            setSnap((current) =>
                current ? { ...current, draft: clone(current.baseline) } : current,
            ),
        commit: (value, nextVersion) =>
            setSnap({
                scope,
                version: nextVersion,
                draft: clone(value),
                baseline: clone(value),
            }),
        adoptServer: () => {
            if (server === undefined || version === null) return
            setSnap({ scope, version, draft: clone(server), baseline: clone(server) })
        },
    }
}

export interface IdentityFields {
    displayName: string
    slug: string
}

export function identityVersion(fields: IdentityFields): string {
    return JSON.stringify([fields.displayName, fields.slug])
}

export function identityEquals(a: IdentityFields, b: IdentityFields): boolean {
    return a.displayName === b.displayName && a.slug === b.slug
}

export function personalityVersion(form: PersonalityForm): string {
    return JSON.stringify(form)
}

export function personalityEquals(a: PersonalityForm, b: PersonalityForm): boolean {
    return (
        a.archetype === b.archetype &&
        a.tone === b.tone &&
        a.directness === b.directness &&
        a.reportStyle === b.reportStyle &&
        a.humor === b.humor &&
        a.challengeStyle === b.challengeStyle &&
        a.notes === b.notes
    )
}

export function cloneMemory(memory: RoomMemory): RoomMemory {
    return structuredClone(memory)
}

export function createMemoryItem(): MemoryItem {
    return {
        id: crypto.randomUUID(),
        text: '',
        createdAt: nowIso(),
        source: 'operator',
    }
}

export function normaliseMemoryForSave(memory: RoomMemory): RoomMemory {
    let next: RoomMemory = {
        ...memory,
        identity: { ...memory.identity, role: memory.identity.role.trim() },
    }
    for (const path of memorySectionPaths) {
        const items = sectionItems(next, path)
            .map((item) => ({ ...item, text: item.text.trim() }))
            .filter((item) => item.text.length > 0)
        next = setSectionItems(next, path, items)
    }
    return next
}

export function memoryFingerprint(memory: RoomMemory): string {
    const normalised = normaliseMemoryForSave(memory)
    const withoutPersonality: RoomMemory = { ...normalised, personality: undefined }
    return canonicalMemoryJson(withoutPersonality)
}

export function memoryEquals(a: RoomMemory, b: RoomMemory): boolean {
    return memoryFingerprint(a) === memoryFingerprint(b)
}

export function patchMemoryItem(
    memory: RoomMemory,
    path: MemorySectionPath,
    id: string,
    patch: Partial<TimedMemoryItem>,
): RoomMemory {
    const items = sectionItems(memory, path).map((item) =>
        item.id === id ? { ...item, ...patch, updatedAt: nowIso() } : item,
    )
    return setSectionItems(memory, path, items)
}

export function isoToLocalInput(iso?: string): string {
    if (!iso) return ''
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return ''
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
        date.getHours(),
    )}:${pad(date.getMinutes())}`
}

export function localInputToIso(value: string): string | undefined {
    if (!value) return undefined
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return undefined
    return date.toISOString()
}

export interface Provenance {
    label: string
    icon: typeof UserIcon
    locked: boolean
}

export function provenanceFor(source: string | undefined): Provenance {
    if (source === 'system') return { label: 'System', icon: LockIcon, locked: true }
    if (source === 'agent') return { label: 'From this room', icon: BotIcon, locked: false }
    return { label: 'You', icon: UserIcon, locked: false }
}
