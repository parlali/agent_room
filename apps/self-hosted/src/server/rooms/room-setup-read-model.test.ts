import { describe, expect, it } from 'vitest'
import { buildRoomSetupSnapshot } from './room-setup-read-model'
import type {
    RoomOnboardingRecord,
    RoomRecord,
    RoomRuntimeMetadataRecord,
} from '#/domain/domain-types'

const now = new Date('2026-01-01T00:00:00.000Z')

function room(overrides: Partial<RoomRecord> = {}): RoomRecord {
    return {
        id: 'room-1',
        slug: 'room-one',
        displayName: 'Room One',
        status: 'running',
        desiredState: 'running',
        createdByUserId: 'user-1',
        createdAt: now,
        updatedAt: now,
        ...overrides,
    }
}

function runtime(overrides: Partial<RoomRuntimeMetadataRecord> = {}): RoomRuntimeMetadataRecord {
    return {
        roomId: 'room-1',
        port: 12345,
        pid: 123,
        sandboxUid: null,
        sandboxGid: null,
        sandboxUserName: null,
        sandboxGroupName: null,
        configVersion: 1,
        tokenVersion: 1,
        healthStatus: 'healthy',
        startedAt: now,
        lastHealthAt: now,
        lastError: null,
        updatedAt: now,
        ...overrides,
    }
}

function onboarding(overrides: Partial<RoomOnboardingRecord> = {}): RoomOnboardingRecord {
    return {
        roomId: 'room-1',
        status: 'pending',
        sessionKey: 'session-1',
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        deferredAt: null,
        ...overrides,
    }
}

describe('room setup read model', () => {
    it('gates normal sessions while onboarding has a pending session', () => {
        const setup = buildRoomSetupSnapshot({
            room: room(),
            runtimeMetadata: runtime(),
            onboarding: onboarding(),
        })

        expect(setup).toMatchObject({
            phase: 'onboarding',
            onboardingSessionKey: 'session-1',
            canStartSessions: false,
        })
    })

    it('reports setup required from configuration blockers before onboarding', () => {
        const setup = buildRoomSetupSnapshot({
            room: room({ status: 'setup_required' }),
            runtimeMetadata: runtime({
                lastError: 'Room configuration is blocked: Codex app server login is missing',
            }),
            onboarding: onboarding(),
        })

        expect(setup).toMatchObject({
            phase: 'setup_required',
            canStartSessions: false,
        })
    })

    it('allows normal sessions after onboarding is completed', () => {
        const setup = buildRoomSetupSnapshot({
            room: room(),
            runtimeMetadata: runtime(),
            onboarding: onboarding({
                status: 'completed',
                completedAt: now,
            }),
        })

        expect(setup).toMatchObject({
            phase: 'ready',
            canStartSessions: true,
            completedAt: now.toISOString(),
        })
    })
})
