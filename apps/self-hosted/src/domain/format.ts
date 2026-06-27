const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

function timestampFromInput(input: number | string | Date | null | undefined): number | null {
    if (input === null || input === undefined) return null
    const ts =
        input instanceof Date
            ? input.getTime()
            : typeof input === 'string'
              ? Date.parse(input)
              : input
    return Number.isFinite(ts) ? ts : null
}

export function formatRelativeTime(input: number | string | Date | null | undefined): string {
    const ts = timestampFromInput(input)
    if (ts === null) return '-'

    const diff = Date.now() - ts
    const abs = Math.abs(diff)
    const future = diff < 0

    if (abs < 30 * SECOND) return future ? 'in a moment' : 'just now'
    if (abs < MINUTE) {
        const s = Math.round(abs / SECOND)
        return future ? `in ${s}s` : `${s}s ago`
    }
    if (abs < HOUR) {
        const m = Math.round(abs / MINUTE)
        return future ? `in ${m} min` : `${m} min ago`
    }
    if (abs < DAY) {
        const h = Math.round(abs / HOUR)
        return future ? `in ${h}h` : `${h}h ago`
    }
    if (abs < WEEK) {
        const d = Math.round(abs / DAY)
        return future ? `in ${d}d` : `${d}d ago`
    }
    return formatDateTime(ts, { dateOnly: true })
}

export function formatDateTime(
    input: number | string | Date | null | undefined,
    opts: { dateOnly?: boolean } = {},
): string {
    const ts = timestampFromInput(input)
    if (ts === null) return '-'
    const date = new Date(ts)
    if (opts.dateOnly) {
        return date.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        })
    }
    return date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    })
}

export function formatBytes(bytes: number | null | undefined): string {
    if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '-'
    if (bytes < 1024) return `${bytes} B`
    const units = ['KB', 'MB', 'GB', 'TB']
    let value = bytes / 1024
    let unit = 0
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024
        unit += 1
    }
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

const byteUnitMultipliers: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
}

export function parseFormattedBytes(label: string | null | undefined): number | null {
    const value = label?.trim()
    if (!value || value === '-') return null
    const match = /^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)$/i.exec(value)
    if (!match) return null
    const amount = Number(match[1])
    const unit = match[2]?.toUpperCase()
    const multiplier = unit ? byteUnitMultipliers[unit] : undefined
    if (!Number.isFinite(amount) || !multiplier) return null
    return Math.round(amount * multiplier)
}

export function formatDurationMs(ms: number | null | undefined): string {
    if (ms === null || ms === undefined || !Number.isFinite(ms)) return '-'
    if (ms < 1000) return `${Math.round(ms)} ms`
    if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
    if (ms < 3_600_000) {
        const min = Math.floor(ms / 60_000)
        const sec = Math.round((ms % 60_000) / 1000)
        return sec ? `${min}m ${sec}s` : `${min}m`
    }
    const hours = Math.floor(ms / 3_600_000)
    const min = Math.round((ms % 3_600_000) / 60_000)
    return min ? `${hours}h ${min}m` : `${hours}h`
}

export function formatTokens(count: number | null | undefined): string {
    if (count === null || count === undefined || !Number.isFinite(count)) return '-'
    if (count < 1000) return String(count)
    if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`
    return `${(count / 1_000_000).toFixed(1)}M`
}

export function formatCostUsd(usd: number | null | undefined): string {
    if (usd === null || usd === undefined || !Number.isFinite(usd)) return '-'
    if (usd < 0.01) return '<$0.01'
    if (usd < 1) return `$${usd.toFixed(3)}`
    return `$${usd.toFixed(2)}`
}

export function roleLabel(role: 'root' | 'operator'): string {
    return role === 'root' ? 'Owner' : 'Member'
}

export function pluralize(count: number, singular: string, plural?: string): string {
    return count === 1 ? singular : (plural ?? `${singular}s`)
}

export function initialsFromName(name: string | null | undefined, fallback = '..'): string {
    if (!name) return fallback
    const trimmed = name.trim()
    if (!trimmed) return fallback
    const parts = trimmed.split(/\s+/).filter(Boolean)
    if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}
