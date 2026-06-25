import type { D1Database, R2Bucket } from '@cloudflare/workers-types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoomRecord } from '#/domain/domain-types'
import type { AgentRoomHostedEnv } from './bindings'
import type { HostedActor } from './hosted-auth'
import {
    deleteHostedRoom,
    failClosedHostedRuntime,
    setHostedRoomDesiredState,
    updateHostedRoomIdentity,
} from './hosted-room-lifecycle-service'

const mocks = vi.hoisted(() => ({
    getHostedRoom: vi.fn(),
    getHostedRuntimeState: vi.fn(),
    deleteHostedWorkspacePrefix: vi.fn(),
    deleteHostedWorkspaceObjects: vi.fn(),
    releaseAuthorizedHostedBillingReservationsForRoom: vi.fn(),
}))

vi.mock('./hosted-room-store', () => ({
    getHostedRoom: mocks.getHostedRoom,
    getHostedRuntimeState: mocks.getHostedRuntimeState,
}))

vi.mock('./hosted-workspace-objects', () => ({
    deleteHostedWorkspacePrefix: mocks.deleteHostedWorkspacePrefix,
    deleteHostedWorkspaceObjects: mocks.deleteHostedWorkspaceObjects,
}))

vi.mock('./hosted-billing-repository', () => ({
    releaseAuthorizedHostedBillingReservationsForRoom:
        mocks.releaseAuthorizedHostedBillingReservationsForRoom,
}))

interface CapturedStatement {
    sql: string
    args: unknown[]
}

function stoppedRoom(): RoomRecord {
    const now = new Date(0)
    return {
        id: 'room_1',
        slug: 'room-1',
        displayName: 'Room 1',
        status: 'stopped',
        desiredState: 'stopped',
        createdByUserId: 'user_1',
        createdAt: now,
        updatedAt: now,
    }
}

function hostedActor(): HostedActor {
    return {
        authProvider: 'better-auth',
        userId: 'user_1',
        sessionId: 'session_1',
        email: 'user_1@example.test',
        workspaceId: 'workspace_1',
    }
}

function hostedEnv(): {
    env: AgentRoomHostedEnv
    statements: CapturedStatement[]
} {
    const statements: CapturedStatement[] = []
    const db = {
        prepare: (sql: string) => ({
            bind: (...args: unknown[]) => ({
                run: async () => {
                    statements.push({ sql, args })
                    return {
                        meta: {
                            changes: 1,
                        },
                    }
                },
            }),
        }),
        batch: async (batchStatements: Array<{ run: () => Promise<unknown> }>) => {
            const results = []
            for (const statement of batchStatements) {
                results.push(await statement.run())
            }
            return results
        },
    } as unknown as D1Database
    return {
        env: {
            AGENT_ROOM_DB: db,
            AGENT_ROOM_WORKSPACE_BUCKET: {
                delete: vi.fn(),
                list: vi.fn(async () => ({
                    objects: [],
                    truncated: false,
                })),
            } as unknown as R2Bucket,
            AGENT_ROOM_RUNTIME: {
                getByName: vi.fn(),
            } as unknown as AgentRoomHostedEnv['AGENT_ROOM_RUNTIME'],
            AGENT_ROOM_RUNTIME_JOBS: {} as AgentRoomHostedEnv['AGENT_ROOM_RUNTIME_JOBS'],
            AGENT_ROOM_AUTH_MODE: 'better-auth',
            AGENT_ROOM_BILLING_PLANS:
                '[{"key":"starter","priceId":"price_test_starter_000000","monthlyCents":700,"includedCents":0}]',
            AGENT_ROOM_BILLING_USAGE_MARKUP_BPS: '13000',
            AGENT_ROOM_BILLING_TAX_MODE: 'automatic',
            AGENT_ROOM_BILLING_MAX_CONCURRENT_ROOMS: '3',
            AGENT_ROOM_RUNTIME_BACKEND: 'cloudflare-containers',
            AGENT_ROOM_RUNTIME_STORAGE: 'r2',
            BETTER_AUTH_SECRET: 'a'.repeat(32),
            BETTER_AUTH_URL: 'https://rooms.example.test',
            AGENT_ROOM_HOSTED_ENCRYPTION_KEY_B64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
            STRIPE_SECRET_KEY: 'stripe-secret-test-value',
            STRIPE_WEBHOOK_SECRET: 'stripe-webhook-test-value',
            STRIPE_CREDIT_TOPUP_PRICE_ID: 'price_test_topup_000000',
            AGENT_ROOM_EMAIL_WEBHOOK_URL: 'https://mail.example.test/send',
            AGENT_ROOM_EMAIL_WEBHOOK_BEARER_TOKEN: 'b'.repeat(16),
            AGENT_ROOM_EMAIL_FROM: 'Agent Room <noreply@example.test>',
            AGENT_ROOM_HOSTED_OPENROUTER_API_KEY: 'openrouter-platform-key',
            AGENT_ROOM_HOSTED_BRAVE_API_KEY: 'brave-platform-key',
        },
        statements,
    }
}

function auditPayload(statement: CapturedStatement): Record<string, unknown> {
    return JSON.parse(String(statement.args[4])) as Record<string, unknown>
}

function auditStatements(statements: CapturedStatement[]): CapturedStatement[] {
    return statements.filter((statement) => /INSERT INTO hosted_audit_event/.test(statement.sql))
}

describe('hosted room lifecycle audit coverage', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.getHostedRoom.mockResolvedValue(stoppedRoom())
        mocks.getHostedRuntimeState.mockResolvedValue(null)
        mocks.deleteHostedWorkspacePrefix.mockResolvedValue(undefined)
        mocks.deleteHostedWorkspaceObjects.mockResolvedValue(undefined)
        mocks.releaseAuthorizedHostedBillingReservationsForRoom.mockResolvedValue(0)
    })

    it('audits desired-state updates before stopping runtime authority', async () => {
        const fixture = hostedEnv()

        await setHostedRoomDesiredState({
            env: fixture.env,
            actor: hostedActor(),
            roomId: 'room_1',
            desiredState: 'stopped',
        })

        const audits = auditStatements(fixture.statements)
        expect(audits).toHaveLength(1)
        expect(audits[0]?.args[3]).toBe('room.desired_state.changed')
        expect(auditPayload(audits[0]!)).toMatchObject({
            desiredState: 'stopped',
            status: 'stopped',
        })
    })

    it('audits room identity updates with the persisted identity fields', async () => {
        const fixture = hostedEnv()

        await updateHostedRoomIdentity({
            env: fixture.env,
            actor: hostedActor(),
            roomId: 'room_1',
            displayName: 'Updated Room',
            slug: 'Updated Room',
        })

        const audits = auditStatements(fixture.statements)
        expect(audits).toHaveLength(1)
        expect(audits[0]?.args[3]).toBe('room.identity.updated')
        expect(auditPayload(audits[0]!)).toMatchObject({
            displayName: 'Updated Room',
            slug: 'updated-room',
        })
    })

    it('rejects empty hosted room identity updates before writing state', async () => {
        const fixture = hostedEnv()

        await expect(
            updateHostedRoomIdentity({
                env: fixture.env,
                actor: hostedActor(),
                roomId: 'room_1',
                displayName: '   ',
                slug: 'room-1',
            }),
        ).rejects.toThrow('Room display name cannot be empty')

        await expect(
            updateHostedRoomIdentity({
                env: fixture.env,
                actor: hostedActor(),
                roomId: 'room_1',
                displayName: 'Room 1',
                slug: '---',
            }),
        ).rejects.toThrow('Room slug cannot be empty')

        expect(fixture.statements).toHaveLength(0)
    })

    it('audits deletes before removing room state and room-scoped secrets', async () => {
        const fixture = hostedEnv()

        await deleteHostedRoom({
            env: fixture.env,
            actor: hostedActor(),
            roomId: 'room_1',
            confirmSlug: 'room-1',
        })

        const statementKinds = fixture.statements.map((statement) => {
            if (/INSERT INTO hosted_audit_event/.test(statement.sql)) return 'audit'
            if (/DELETE FROM hosted_room/.test(statement.sql)) return 'room'
            if (/DELETE FROM hosted_secret/.test(statement.sql)) return 'secret'
            return 'other'
        })
        const audits = auditStatements(fixture.statements)
        expect(audits).toHaveLength(1)
        expect(audits[0]?.args[3]).toBe('room.deleted')
        expect(auditPayload(audits[0]!)).toMatchObject({
            slug: 'room-1',
            displayName: 'Room 1',
            status: 'stopped',
            desiredState: 'stopped',
        })
        expect(mocks.releaseAuthorizedHostedBillingReservationsForRoom).toHaveBeenCalledWith({
            env: fixture.env,
            workspaceId: 'workspace_1',
            roomId: 'room_1',
        })
        expect(statementKinds).toEqual(['audit', 'room', 'secret'])
    })

    it('audits fail-closed runtime cleanup with sanitized error evidence', async () => {
        const fixture = hostedEnv()

        await failClosedHostedRuntime({
            env: fixture.env,
            workspaceId: 'workspace_1',
            roomId: 'room_1',
            error: new Error('failed workspace_1 room_1 provider materialization'),
        })

        const audits = auditStatements(fixture.statements)
        expect(audits).toHaveLength(1)
        expect(audits[0]?.args[3]).toBe('room.runtime.fail_closed')
        expect(auditPayload(audits[0]!)).toMatchObject({
            status: 'failed',
            desiredState: 'stopped',
            runtimeDestroyed: false,
            runtimeObjectCount: 0,
            error: 'failed workspace room provider materialization',
        })
    })
})
