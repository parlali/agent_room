import { describe, expect, it } from 'vitest'

import { computeNextRunAt, describeJobSchedule, normalizeJobSchedule } from './job-schedule'

describe('job schedules', () => {
    it('normalizes legacy intervals and describes typed schedules', () => {
        expect(normalizeJobSchedule(null, 120)).toEqual({
            type: 'interval',
            every: 2,
            unit: 'hours',
        })
        expect(
            describeJobSchedule({
                type: 'weekly',
                weekdays: [1, 3, 5],
                time: '09:30',
            }),
        ).toBe('Every week on Mon, Wed, Fri at 09:30')
    })

    it('computes daily runs in the room timezone', () => {
        const next = computeNextRunAt({
            schedule: {
                type: 'daily',
                times: ['09:00'],
            },
            after: new Date('2026-05-09T08:30:00.000Z'),
            timezone: 'Europe/London',
        })

        expect(next.toISOString()).toBe('2026-05-10T08:00:00.000Z')
    })

    it('computes weekly and monthly wall-clock schedules', () => {
        const weekly = computeNextRunAt({
            schedule: {
                type: 'weekly',
                weekdays: [1],
                time: '10:15',
            },
            after: new Date('2026-05-09T12:00:00.000Z'),
            timezone: 'UTC',
        })
        const monthly = computeNextRunAt({
            schedule: {
                type: 'monthly',
                day: 31,
                time: '18:00',
            },
            after: new Date('2026-04-30T20:00:00.000Z'),
            timezone: 'UTC',
        })

        expect(weekly.toISOString()).toBe('2026-05-11T10:15:00.000Z')
        expect(monthly.toISOString()).toBe('2026-05-31T18:00:00.000Z')
    })
})
