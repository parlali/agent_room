import { describe, expect, it } from 'vitest'
import { describeRoomState } from './state'

describe('describeRoomState', () => {
    it('shows a slept room that should be running as idle instead of paused', () => {
        expect(
            describeRoomState({
                status: 'stopped',
                desiredState: 'running',
                healthStatus: 'unknown',
            }),
        ).toEqual({ kind: 'ready', label: 'Idle', tone: 'muted' })
    })

    it('shows an intentionally stopped room as paused', () => {
        expect(
            describeRoomState({
                status: 'stopped',
                desiredState: 'stopped',
                healthStatus: 'unknown',
            }),
        ).toEqual({ kind: 'paused', label: 'Paused', tone: 'muted' })
    })

    it('keeps running and starting rooms unchanged', () => {
        expect(
            describeRoomState({
                status: 'running',
                desiredState: 'running',
                healthStatus: 'healthy',
            }),
        ).toEqual({ kind: 'ready', label: 'Ready', tone: 'ready' })
        expect(
            describeRoomState({
                status: 'starting',
                desiredState: 'running',
                healthStatus: 'unknown',
            }),
        ).toEqual({ kind: 'starting', label: 'Starting', tone: 'working' })
    })
})
