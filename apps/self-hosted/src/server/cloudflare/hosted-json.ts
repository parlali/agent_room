import type { JsonValue } from '#/domain/domain-types'

export function nowIso(input?: Date): string {
    return (input ?? new Date()).toISOString()
}

export function parseJsonValue(value: string | null | undefined, fallback: JsonValue): JsonValue {
    if (!value) {
        return fallback
    }
    try {
        return JSON.parse(value) as JsonValue
    } catch (error) {
        const message = error instanceof Error ? error.message : 'invalid JSON'
        throw new Error(`Hosted persisted JSON is invalid: ${message}`)
    }
}

export function stringifyJson(value: JsonValue): string {
    return JSON.stringify(value)
}

export function nullableObjectRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null
}

export function objectRecord(value: unknown): Record<string, unknown> {
    return nullableObjectRecord(value) ?? {}
}

export function toDate(value: string | null | undefined): Date | null {
    return value ? new Date(value) : null
}

export function toIso(value: string | null | undefined): string | null {
    return value ? new Date(value).toISOString() : null
}

export function toJsonValue(value: unknown): JsonValue {
    if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return value
    }
    if (Array.isArray(value)) {
        return value.map((entry) => toJsonValue(entry))
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
                key,
                toJsonValue(entry),
            ]),
        )
    }
    return null
}
