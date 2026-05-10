export const weekDays = [
    { value: 1, short: 'Mon', label: 'Monday' },
    { value: 2, short: 'Tue', label: 'Tuesday' },
    { value: 3, short: 'Wed', label: 'Wednesday' },
    { value: 4, short: 'Thu', label: 'Thursday' },
    { value: 5, short: 'Fri', label: 'Friday' },
    { value: 6, short: 'Sat', label: 'Saturday' },
    { value: 0, short: 'Sun', label: 'Sunday' },
] as const

export type JobSchedule =
    | {
          type: 'interval'
          every: number
          unit: 'minutes' | 'hours' | 'days' | 'weeks'
      }
    | {
          type: 'daily'
          times: string[]
      }
    | {
          type: 'weekly'
          weekdays: number[]
          time: string
      }
    | {
          type: 'monthly'
          day: number
          time: string
      }

export const defaultJobSchedule: JobSchedule = {
    type: 'daily',
    times: ['09:00'],
}

const unitMinutes = {
    minutes: 1,
    hours: 60,
    days: 24 * 60,
    weeks: 7 * 24 * 60,
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function positiveInt(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.floor(value)
        : fallback
}

function parseTime(value: unknown, fallback = '09:00'): string {
    if (typeof value !== 'string') return fallback
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim())
    return match ? value.trim() : fallback
}

function normalizeWeekdays(value: unknown): number[] {
    const days = Array.isArray(value)
        ? value
              .filter(
                  (entry): entry is number => typeof entry === 'number' && Number.isInteger(entry),
              )
              .filter((entry) => entry >= 0 && entry <= 6)
        : []
    return [...new Set(days)].sort((a, b) => a - b)
}

export function intervalMinutes(schedule: JobSchedule): number {
    if (schedule.type === 'interval') {
        return Math.max(1, schedule.every) * unitMinutes[schedule.unit]
    }
    if (schedule.type === 'weekly') return 7 * 24 * 60
    if (schedule.type === 'monthly') return 30 * 24 * 60
    return 24 * 60
}

export function intervalScheduleFromMinutes(everyMinutes: number): JobSchedule {
    const minutes = Math.max(1, Math.floor(everyMinutes))
    if (minutes % (7 * 24 * 60) === 0) {
        return {
            type: 'interval',
            every: minutes / (7 * 24 * 60),
            unit: 'weeks',
        }
    }
    if (minutes % (24 * 60) === 0) {
        return {
            type: 'interval',
            every: minutes / (24 * 60),
            unit: 'days',
        }
    }
    if (minutes % 60 === 0) {
        return {
            type: 'interval',
            every: minutes / 60,
            unit: 'hours',
        }
    }
    return {
        type: 'interval',
        every: minutes,
        unit: 'minutes',
    }
}

export function normalizeJobSchedule(value: unknown, everyMinutes?: number): JobSchedule {
    if (!isRecord(value)) {
        return everyMinutes ? intervalScheduleFromMinutes(everyMinutes) : defaultJobSchedule
    }

    if (value.type === 'interval') {
        const unit =
            value.unit === 'minutes' ||
            value.unit === 'hours' ||
            value.unit === 'days' ||
            value.unit === 'weeks'
                ? value.unit
                : 'hours'
        return {
            type: 'interval',
            every: positiveInt(value.every, 1),
            unit,
        }
    }

    if (value.type === 'daily') {
        const times = Array.isArray(value.times)
            ? value.times.map((entry) => parseTime(entry, '')).filter(Boolean)
            : []
        return {
            type: 'daily',
            times: [...new Set(times.length > 0 ? times : ['09:00'])].sort(),
        }
    }

    if (value.type === 'weekly') {
        const weekdays = normalizeWeekdays(value.weekdays)
        return {
            type: 'weekly',
            weekdays: weekdays.length > 0 ? weekdays : [1],
            time: parseTime(value.time),
        }
    }

    if (value.type === 'monthly') {
        return {
            type: 'monthly',
            day: Math.min(31, positiveInt(value.day, 1)),
            time: parseTime(value.time),
        }
    }

    return everyMinutes ? intervalScheduleFromMinutes(everyMinutes) : defaultJobSchedule
}

function plural(value: number, singular: string, pluralValue = `${singular}s`): string {
    return value === 1 ? singular : pluralValue
}

export function describeJobSchedule(schedule: JobSchedule): string {
    if (schedule.type === 'interval') {
        return `Every ${schedule.every} ${plural(schedule.every, schedule.unit.slice(0, -1))}`
    }
    if (schedule.type === 'daily') {
        return schedule.times.length === 1
            ? `Every day at ${schedule.times[0]}`
            : `Every day at ${schedule.times.join(', ')}`
    }
    if (schedule.type === 'weekly') {
        const dayLabels = schedule.weekdays
            .map((day) => weekDays.find((entry) => entry.value === day)?.short)
            .filter(Boolean)
            .join(', ')
        return `Every week on ${dayLabels} at ${schedule.time}`
    }
    return `Every month on day ${schedule.day} at ${schedule.time}`
}

function timeParts(value: string): { hour: number; minute: number } {
    const [hour, minute] = value.split(':').map((part) => Number(part))
    return {
        hour: Number.isFinite(hour) ? hour : 9,
        minute: Number.isFinite(minute) ? minute : 0,
    }
}

function zonedParts(date: Date, timezone: string) {
    const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
        weekday: 'short',
    })
    const parts = Object.fromEntries(
        formatter.formatToParts(date).map((part) => [part.type, part.value]),
    )
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday ?? '')
    return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        hour: Number(parts.hour),
        minute: Number(parts.minute),
        second: Number(parts.second),
        weekday: weekday < 0 ? date.getUTCDay() : weekday,
    }
}

function wallTimestamp(input: {
    year: number
    month: number
    day: number
    hour: number
    minute: number
    second?: number
}): number {
    return Date.UTC(
        input.year,
        input.month - 1,
        input.day,
        input.hour,
        input.minute,
        input.second ?? 0,
    )
}

function zonedWallTimeToDate(input: {
    year: number
    month: number
    day: number
    hour: number
    minute: number
    timezone: string
}): Date {
    const targetWall = wallTimestamp(input)
    let guess = new Date(Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute))
    for (let index = 0; index < 2; index += 1) {
        const observed = zonedParts(guess, input.timezone)
        const observedWall = wallTimestamp(observed)
        guess = new Date(guess.getTime() + targetWall - observedWall)
    }
    return guess
}

function addWallDays(parts: ReturnType<typeof zonedParts>, days: number) {
    const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12, 0, 0))
    return {
        year: next.getUTCFullYear(),
        month: next.getUTCMonth() + 1,
        day: next.getUTCDate(),
        weekday: next.getUTCDay(),
    }
}

function daysInMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function firstFuture(candidates: Date[], after: Date): Date {
    const future = candidates
        .filter((candidate) => candidate.getTime() > after.getTime())
        .sort((a, b) => a.getTime() - b.getTime())
    return future[0] ?? candidates.sort((a, b) => a.getTime() - b.getTime())[0] ?? after
}

export function computeNextRunAt(input: {
    schedule: JobSchedule
    after: Date
    timezone: string
}): Date {
    const schedule = normalizeJobSchedule(input.schedule)
    if (schedule.type === 'interval') {
        return new Date(input.after.getTime() + intervalMinutes(schedule) * 60000)
    }

    const base = zonedParts(input.after, input.timezone)

    if (schedule.type === 'daily') {
        const candidates: Date[] = []
        for (let offset = 0; offset <= 7; offset += 1) {
            const day = addWallDays(base, offset)
            for (const time of schedule.times) {
                const { hour, minute } = timeParts(time)
                candidates.push(
                    zonedWallTimeToDate({
                        ...day,
                        hour,
                        minute,
                        timezone: input.timezone,
                    }),
                )
            }
        }
        return firstFuture(candidates, input.after)
    }

    if (schedule.type === 'weekly') {
        const candidates: Date[] = []
        for (let offset = 0; offset <= 14; offset += 1) {
            const day = addWallDays(base, offset)
            if (!schedule.weekdays.includes(day.weekday)) continue
            const { hour, minute } = timeParts(schedule.time)
            candidates.push(
                zonedWallTimeToDate({
                    ...day,
                    hour,
                    minute,
                    timezone: input.timezone,
                }),
            )
        }
        return firstFuture(candidates, input.after)
    }

    const candidates: Date[] = []
    for (let offset = 0; offset <= 15; offset += 1) {
        const monthIndex = base.month - 1 + offset
        const year = base.year + Math.floor(monthIndex / 12)
        const month = (monthIndex % 12) + 1
        const day = Math.min(schedule.day, daysInMonth(year, month))
        const { hour, minute } = timeParts(schedule.time)
        candidates.push(
            zonedWallTimeToDate({
                year,
                month,
                day,
                hour,
                minute,
                timezone: input.timezone,
            }),
        )
    }
    return firstFuture(candidates, input.after)
}
