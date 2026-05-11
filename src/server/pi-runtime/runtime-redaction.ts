import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'

const maxRedactedStringChars = 4000
const maxRedactedArrayItems = 100
const maxRedactedObjectKeys = 100

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSensitiveEnvKey(key: string): boolean {
    return /TOKEN|SECRET|KEY|AUTH|PASSWORD|CREDENTIAL/i.test(key)
}

function bearerTokenParts(value: string): string[] {
    const match = value.match(/^Bearer\s+(.+)$/i)
    return match ? [value, match[1]!] : [value]
}

function redactionSecrets(config: PiRuntimeConfig): string[] {
    const values: string[] = [config.runtime.token]
    for (const server of config.mcpServers) {
        for (const value of [...Object.values(server.env), ...Object.values(server.headers)]) {
            values.push(...bearerTokenParts(value))
        }
    }
    for (const [key, value] of Object.entries(process.env)) {
        if (value && isSensitiveEnvKey(key)) {
            values.push(value)
        }
    }
    return [...new Set(values.filter((value) => value.trim().length >= 6))].sort(
        (left, right) => right.length - left.length,
    )
}

function boundRuntimeString(value: string): string {
    if (value.length <= maxRedactedStringChars) {
        return value
    }
    return `${value.slice(0, maxRedactedStringChars)}...[truncated]`
}

export function createRuntimeRedactor(config: PiRuntimeConfig) {
    const redactUnboundedString = (value: string): string => {
        let output = value
        for (const secret of redactionSecrets(config)) {
            output = output.replaceAll(secret, '[redacted]')
        }
        return output
    }

    const redactString = (value: string): string => {
        return boundRuntimeString(redactUnboundedString(value))
    }

    const redactPayload = (value: unknown, depth = 0): unknown => {
        if (typeof value === 'string') {
            return redactString(value)
        }
        if (
            value === null ||
            typeof value === 'number' ||
            typeof value === 'boolean' ||
            value === undefined
        ) {
            return value ?? null
        }
        if (depth > 8) {
            return '[truncated]'
        }
        if (Array.isArray(value)) {
            return value
                .slice(0, maxRedactedArrayItems)
                .map((entry) => redactPayload(entry, depth + 1))
        }
        if (isRecord(value)) {
            const output: Record<string, unknown> = {}
            for (const [key, entry] of Object.entries(value).slice(0, maxRedactedObjectKeys)) {
                output[key] = redactPayload(entry, depth + 1)
            }
            return output
        }
        return redactString(String(value))
    }

    const errorMessage = (error: unknown): string => {
        return redactString(error instanceof Error ? error.message : 'Unknown Pi runtime error')
    }

    return {
        redactString,
        redactUnboundedString,
        redactPayload,
        errorMessage,
    }
}
