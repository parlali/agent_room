import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { JsonValue } from '../domain/types'
import { getRoomPaths } from '../rooms/room-paths'

export interface CodexAuthStatus {
    required: boolean
    ready: boolean
    profilePath: string
    setupCommand: string
    message: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function collectProfileCandidates(
    value: unknown,
): Array<{ profileId: string | null; value: JsonValue }> {
    const candidates: Array<{ profileId: string | null; value: JsonValue }> = []

    const visit = (entry: unknown, key: string | null) => {
        if (Array.isArray(entry)) {
            for (const item of entry) {
                visit(item, null)
            }
            return
        }

        if (!isRecord(entry)) {
            return
        }

        const provider = entry.provider
        const profileId = typeof entry.id === 'string' ? entry.id : key
        if (
            provider === 'openai-codex' ||
            profileId?.startsWith('openai-codex:') ||
            profileId === 'openai-codex'
        ) {
            candidates.push({
                profileId,
                value: entry as JsonValue,
            })
        }

        for (const [childKey, child] of Object.entries(entry)) {
            if (childKey === 'access' || childKey === 'refresh') {
                continue
            }
            visit(child, childKey)
        }
    }

    visit(value, null)
    return candidates
}

function profileHasToken(value: JsonValue): boolean {
    if (!isRecord(value)) {
        return false
    }

    if (typeof value.access === 'string' || typeof value.refresh === 'string') {
        return true
    }

    if (isRecord(value.credentials)) {
        return (
            typeof value.credentials.access === 'string' ||
            typeof value.credentials.refresh === 'string'
        )
    }

    if (isRecord(value.oauth)) {
        return typeof value.oauth.access === 'string' || typeof value.oauth.refresh === 'string'
    }

    return false
}

function profileIsExpired(value: JsonValue, nowMs: number): boolean {
    if (!isRecord(value)) {
        return false
    }

    const expires = value.expires
    if (typeof expires === 'number') {
        const expiresMs = expires < 100_000_000_000 ? expires * 1000 : expires
        return expiresMs < nowMs
    }
    if (typeof expires === 'string') {
        const parsed = Date.parse(expires)
        return Number.isFinite(parsed) && parsed < nowMs
    }

    return false
}

function buildSetupCommand(roomId: string): string {
    const paths = getRoomPaths(roomId)
    return `Use the room dashboard to generate a Codex OAuth link for ${paths.engineStateDir}`
}

export function getCodexAuthProfilePath(roomId: string): string {
    const paths = getRoomPaths(roomId)
    return join(paths.engineStateDir, 'auth.json')
}

export async function inspectCodexAuthStatus(roomId: string): Promise<CodexAuthStatus> {
    const profilePath = getCodexAuthProfilePath(roomId)
    const setupCommand = buildSetupCommand(roomId)

    let raw: string
    try {
        raw = await readFile(profilePath, 'utf8')
    } catch {
        return {
            required: true,
            ready: false,
            profilePath,
            setupCommand,
            message:
                'OpenAI Codex OAuth profile is missing. Use this room dashboard to generate a login link.',
        }
    }

    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return {
            required: true,
            ready: false,
            profilePath,
            setupCommand,
            message: `OpenAI Codex OAuth profile at ${profilePath} is not valid JSON`,
        }
    }

    const candidates = collectProfileCandidates(parsed)
    const usable = candidates.find(
        (candidate) =>
            profileHasToken(candidate.value) && !profileIsExpired(candidate.value, Date.now()),
    )

    if (!usable) {
        return {
            required: true,
            ready: false,
            profilePath,
            setupCommand,
            message:
                'OpenAI Codex OAuth profile is not usable for this room. Generate a new room login link.',
        }
    }

    return {
        required: true,
        ready: true,
        profilePath,
        setupCommand,
        message: `OpenAI Codex OAuth profile ${usable.profileId ?? 'default'} is available for this room`,
    }
}

export const __testing = {
    profileIsExpired,
}
