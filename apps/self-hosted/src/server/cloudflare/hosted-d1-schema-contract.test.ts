import { readdirSync, readFileSync } from 'node:fs'
import { createClient, type Client } from '@libsql/client'
import { describe, expect, it } from 'vitest'
import {
    connectionStatuses,
    healthStatuses,
    mcpAuthModes,
    mcpTransports,
    providerApis,
    providerAuthModes,
    roomDesiredStates,
    roomStatuses,
    usageEventKinds,
} from '../../domain/domain-types'
import {
    hostedBillingLedgerDirections,
    hostedBillingLedgerSources,
    hostedBillingPlanStatuses,
    hostedBillingReservationProviders,
    hostedBillingReservationStatuses,
    hostedUsageBillingStatuses,
} from './hosted-billing-types'

function readHostedMigration(): string {
    const migrationsUrl = new URL('../../../db/d1-migrations/', import.meta.url)
    return readdirSync(migrationsUrl)
        .filter((fileName) => fileName.endsWith('.sql'))
        .sort()
        .map((fileName) => readFileSync(new URL(fileName, migrationsUrl), 'utf8'))
        .join('\n')
}

function readHostedMigrationFile(fileName: string): string {
    return readFileSync(new URL(`../../../db/d1-migrations/${fileName}`, import.meta.url), 'utf8')
}

async function createHostedControlPlaneDb(): Promise<Client> {
    const db = createClient({ url: 'file::memory:' })
    await db.executeMultiple(readHostedMigrationFile('0001_hosted_control_plane.sql'))
    return db
}

async function createHostedFullDb(): Promise<Client> {
    const db = createClient({ url: 'file::memory:' })
    await db.executeMultiple(readHostedMigration())
    return db
}

async function insertHostedAuthRow(input: {
    db: Client
    userId: string
    organizationId: string
    memberId: string
    role?: string
}): Promise<void> {
    const now = new Date(0).toISOString()
    await input.db.execute({
        sql: `
            INSERT OR IGNORE INTO "user" (
                id,
                name,
                email,
                emailVerified,
                image,
                createdAt,
                updatedAt
            )
            VALUES (?1, ?2, ?3, 1, NULL, ?4, ?4)
        `,
        args: [input.userId, input.userId, `${input.userId}@example.test`, now],
    })
    await input.db.execute({
        sql: `
            INSERT OR IGNORE INTO organization (
                id,
                name,
                slug,
                logo,
                createdAt,
                metadata
            )
            VALUES (?1, ?2, ?3, NULL, ?4, '{}')
        `,
        args: [input.organizationId, input.organizationId, input.organizationId, now],
    })
    await input.db.execute({
        sql: `
            INSERT INTO member (
                id,
                organizationId,
                userId,
                role,
                createdAt
            )
            VALUES (?1, ?2, ?3, ?4, ?5)
        `,
        args: [input.memberId, input.organizationId, input.userId, input.role ?? 'owner', now],
    })
}

async function insertHostedRoom(input: {
    db: Client
    workspaceId: string
    roomId: string
    userId: string
    now?: string
}): Promise<void> {
    const now = input.now ?? new Date(0).toISOString()
    await input.db.execute({
        sql: `
            INSERT INTO hosted_room (
                id,
                workspace_id,
                slug,
                display_name,
                status,
                desired_state,
                created_by_user_id,
                created_at,
                updated_at
            )
            VALUES (?1, ?2, ?3, ?3, 'stopped', 'stopped', ?4, ?5, ?5)
        `,
        args: [input.roomId, input.workspaceId, input.roomId, input.userId, now],
    })
}

async function insertHostedRoomJob(input: {
    db: Client
    workspaceId: string
    roomId: string
    jobId: string
    now?: string
}): Promise<void> {
    const now = input.now ?? new Date(0).toISOString()
    await input.db.execute({
        sql: `
            INSERT INTO hosted_room_job (
                id,
                workspace_id,
                room_id,
                name,
                message,
                enabled,
                schedule,
                timezone,
                next_run_at,
                running_at,
                locked_until,
                lock_token,
                last_run_at,
                last_run_status,
                last_error,
                created_at,
                updated_at
            )
            VALUES (?1, ?2, ?3, ?1, 'Run', 1, '{}', 'UTC', NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?4, ?4)
        `,
        args: [input.jobId, input.workspaceId, input.roomId, now],
    })
}

async function insertHostedRoomJobRun(input: {
    db: Client
    workspaceId: string
    roomId: string
    runId: string
    jobId?: string | null
    now?: string
}): Promise<void> {
    const now = input.now ?? new Date(0).toISOString()
    await input.db.execute({
        sql: `
            INSERT INTO hosted_room_job_run (
                id,
                workspace_id,
                room_id,
                job_id,
                job_name,
                attempt,
                status,
                summary,
                error,
                lock_token,
                session_key,
                session_id,
                provider,
                model,
                config_version,
                started_at,
                finished_at,
                duration_ms,
                next_run_at
            )
            VALUES (?1, ?2, ?3, ?4, ?4, 1, 'running', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?5, NULL, NULL, NULL)
        `,
        args: [input.runId, input.workspaceId, input.roomId, input.jobId ?? null, now],
    })
}

async function insertHostedUsageEvent(input: {
    db: Client
    workspaceId: string
    roomId: string
    usageId: string
    jobId?: string | null
    billingLedgerEntryId?: string | null
    now?: string
}): Promise<void> {
    const now = input.now ?? new Date(0).toISOString()
    await input.db.execute({
        sql: `
            INSERT INTO hosted_usage_event (
                id,
                workspace_id,
                room_id,
                session_key,
                run_id,
                job_id,
                kind,
                provider,
                model,
                tool_name,
                input_tokens,
                output_tokens,
                cached_tokens,
                cost_micros,
                billing_status,
                billing_ledger_entry_id,
                created_at
            )
            VALUES (?1, ?2, ?3, NULL, ?1, ?4, 'job', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'not_billable', ?5, ?6)
        `,
        args: [
            input.usageId,
            input.workspaceId,
            input.roomId,
            input.jobId ?? null,
            input.billingLedgerEntryId ?? null,
            now,
        ],
    })
}

async function insertHostedBillingLedgerEntry(input: {
    db: Client
    workspaceId: string
    ledgerId: string
    usageEventId?: string | null
    now?: string
}): Promise<void> {
    const now = input.now ?? new Date(0).toISOString()
    await input.db.execute({
        sql: `
            INSERT INTO hosted_billing_ledger_entry (
                id,
                workspace_id,
                direction,
                source,
                amount_cents,
                balance_after_cents,
                stripe_event_id,
                stripe_checkout_session_id,
                stripe_invoice_id,
                usage_event_id,
                idempotency_key,
                metadata,
                created_at
            )
            VALUES (?1, ?2, 'debit', 'hosted_brave_usage', 1, 0, NULL, NULL, NULL, ?3, ?1, '{}', ?4)
        `,
        args: [input.ledgerId, input.workspaceId, input.usageEventId ?? null, now],
    })
}

async function insertHostedBillingReservation(input: {
    db: Client
    workspaceId: string
    roomId: string
    reservationId: string
    jobId?: string | null
    usageEventId?: string | null
    billingLedgerEntryId?: string | null
    now?: string
}): Promise<void> {
    const now = input.now ?? new Date(0).toISOString()
    await input.db.execute({
        sql: `
            INSERT INTO hosted_billing_reservation (
                id,
                workspace_id,
                room_id,
                session_key,
                run_id,
                job_id,
                provider,
                status,
                reserved_cents,
                included_reserved_cents,
                purchased_reserved_cents,
                settled_cents,
                usage_event_id,
                billing_ledger_entry_id,
                idempotency_key,
                metadata,
                expires_at,
                created_at,
                updated_at
            )
            VALUES (?1, ?2, ?3, NULL, NULL, ?4, 'brave', 'authorized', 1, 1, 0, 0, ?5, ?6, ?1, '{}', ?7, ?7, ?7)
        `,
        args: [
            input.reservationId,
            input.workspaceId,
            input.roomId,
            input.jobId ?? null,
            input.usageEventId ?? null,
            input.billingLedgerEntryId ?? null,
            now,
        ],
    })
}

function extractTableDefinition(sql: string, tableName: string): string {
    const start = sql.indexOf(`CREATE TABLE ${tableName} `)
    if (start === -1) {
        throw new Error(`Missing D1 table ${tableName}`)
    }
    const end = sql.indexOf(';', start)
    if (end === -1) {
        throw new Error(`Missing D1 table terminator for ${tableName}`)
    }
    return sql.slice(start, end)
}

function extractCheckValues(input: {
    sql: string
    tableName: string
    columnName: string
}): string[] {
    const tableDefinition = extractTableDefinition(input.sql, input.tableName)
    const columnPattern = new RegExp(
        `${input.columnName}\\s+TEXT\\s+NOT\\s+NULL\\s+CHECK\\s*\\(\\s*${input.columnName}\\s+IN\\s*\\(([^)]*)\\)\\s*\\)`,
        'm',
    )
    const match = tableDefinition.match(columnPattern)
    if (!match?.[1]) {
        throw new Error(`Missing D1 CHECK constraint for ${input.tableName}.${input.columnName}`)
    }
    return Array.from(match[1].matchAll(/'([^']+)'/g)).map((value) => value[1])
}

function normalizeSqlFragment(sql: string): string {
    return sql.replace(/\s+/g, ' ').trim()
}

function expectTableConstraint(input: {
    sql: string
    tableName: string
    constraint: string
}): void {
    expect(normalizeSqlFragment(extractTableDefinition(input.sql, input.tableName))).toContain(
        normalizeSqlFragment(input.constraint),
    )
}

describe('hosted D1 schema contract', () => {
    it('keeps hosted CHECK constraints aligned with canonical domain values', () => {
        const sql = readHostedMigration()

        expect(
            extractCheckValues({
                sql,
                tableName: 'hosted_room',
                columnName: 'status',
            }),
        ).toEqual([...roomStatuses])
        expect(
            extractCheckValues({
                sql,
                tableName: 'hosted_room',
                columnName: 'desired_state',
            }),
        ).toEqual([...roomDesiredStates])
        expect(
            extractCheckValues({
                sql,
                tableName: 'hosted_room_runtime_state',
                columnName: 'health_status',
            }),
        ).toEqual([...healthStatuses])
        expect(
            extractCheckValues({
                sql,
                tableName: 'hosted_provider_connection',
                columnName: 'auth_mode',
            }),
        ).toEqual([...providerAuthModes])
        expect(
            extractCheckValues({
                sql,
                tableName: 'hosted_provider_connection',
                columnName: 'api',
            }),
        ).toEqual([...providerApis])
        expect(
            extractCheckValues({
                sql,
                tableName: 'hosted_provider_connection',
                columnName: 'status',
            }),
        ).toEqual([...connectionStatuses])
        expect(
            extractCheckValues({
                sql,
                tableName: 'hosted_mcp_connection',
                columnName: 'transport',
            }),
        ).toEqual([...mcpTransports])
        expect(
            extractCheckValues({
                sql,
                tableName: 'hosted_mcp_connection',
                columnName: 'auth_mode',
            }),
        ).toEqual([...mcpAuthModes])
        expect(
            extractCheckValues({
                sql,
                tableName: 'hosted_mcp_connection',
                columnName: 'status',
            }),
        ).toEqual([...connectionStatuses])
        expect(
            extractCheckValues({
                sql,
                tableName: 'hosted_usage_event',
                columnName: 'kind',
            }),
        ).toEqual([...usageEventKinds])
        expect(
            extractCheckValues({
                sql,
                tableName: 'hosted_billing_account',
                columnName: 'plan_status',
            }),
        ).toEqual([...hostedBillingPlanStatuses])
        expect(
            extractCheckValues({
                sql,
                tableName: 'hosted_billing_ledger_entry',
                columnName: 'direction',
            }),
        ).toEqual([...hostedBillingLedgerDirections])
        expect(
            extractCheckValues({
                sql,
                tableName: 'hosted_billing_ledger_entry',
                columnName: 'source',
            }),
        ).toEqual([...hostedBillingLedgerSources])
        expect(
            extractCheckValues({
                sql,
                tableName: 'hosted_usage_event',
                columnName: 'billing_status',
            }),
        ).toEqual([...hostedUsageBillingStatuses])
        expect(
            extractCheckValues({
                sql,
                tableName: 'hosted_billing_reservation',
                columnName: 'provider',
            }),
        ).toEqual([...hostedBillingReservationProviders])
        expect(
            extractCheckValues({
                sql,
                tableName: 'hosted_billing_reservation',
                columnName: 'status',
            }),
        ).toEqual([...hostedBillingReservationStatuses])
    })

    it('enforces workspace ownership for hosted room state, jobs, and usage rows', () => {
        const sql = readHostedMigration()

        expectTableConstraint({
            sql,
            tableName: 'hosted_room',
            constraint: 'UNIQUE(workspace_id, id)',
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_provider_connection',
            constraint: 'UNIQUE(workspace_id, id)',
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_room_job',
            constraint: 'UNIQUE(workspace_id, id)',
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_usage_event',
            constraint: 'UNIQUE(workspace_id, id)',
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_billing_ledger_entry',
            constraint: 'UNIQUE(workspace_id, id)',
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_billing_reservation',
            constraint: 'UNIQUE(workspace_id, id)',
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_provider_connection',
            constraint: `
                FOREIGN KEY (workspace_id, credential_secret_id)
                    REFERENCES hosted_secret(workspace_id, id)
                    ON DELETE RESTRICT
            `,
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_room',
            constraint: `
                FOREIGN KEY (workspace_id, created_by_user_id)
                    REFERENCES member(organizationId, userId)
            `,
        })
        for (const tableName of [
            'hosted_room_runtime_state',
            'hosted_room_job',
            'hosted_usage_event',
            'hosted_room_mcp_binding',
            'hosted_room_secret',
        ]) {
            expectTableConstraint({
                sql,
                tableName,
                constraint: `
                    FOREIGN KEY (workspace_id, room_id)
                        REFERENCES hosted_room(workspace_id, id)
                        ON DELETE CASCADE
                `,
            })
        }
        expectTableConstraint({
            sql,
            tableName: 'hosted_mcp_connection',
            constraint: 'UNIQUE(workspace_id, id)',
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_mcp_connection',
            constraint: `
                FOREIGN KEY (workspace_id, credential_secret_id)
                    REFERENCES hosted_secret(workspace_id, id)
                    ON DELETE RESTRICT
            `,
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_workspace_settings',
            constraint: `
                FOREIGN KEY (workspace_id, default_provider_connection_id)
                    REFERENCES hosted_provider_connection(workspace_id, id)
                    ON DELETE RESTRICT
            `,
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_room_config',
            constraint: `
                FOREIGN KEY (workspace_id, provider_connection_id)
                    REFERENCES hosted_provider_connection(workspace_id, id)
                    ON DELETE RESTRICT
            `,
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_room_config',
            constraint: `
                FOREIGN KEY (workspace_id, image_secret_id)
                    REFERENCES hosted_secret(workspace_id, id)
                    ON DELETE RESTRICT
            `,
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_room_mcp_binding',
            constraint: `
                FOREIGN KEY (workspace_id, mcp_connection_id)
                    REFERENCES hosted_mcp_connection(workspace_id, id)
                    ON DELETE CASCADE
            `,
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_secret',
            constraint: 'UNIQUE(workspace_id, id)',
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_room_secret',
            constraint: `
                FOREIGN KEY (workspace_id, secret_id)
                    REFERENCES hosted_secret(workspace_id, id)
                    ON DELETE CASCADE
            `,
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_usage_event',
            constraint: `
                FOREIGN KEY (workspace_id, job_id)
                    REFERENCES hosted_room_job(workspace_id, id)
                    ON DELETE RESTRICT
            `,
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_room_job_run',
            constraint: `
                FOREIGN KEY (workspace_id, job_id)
                    REFERENCES hosted_room_job(workspace_id, id)
                    ON DELETE RESTRICT
            `,
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_billing_ledger_entry',
            constraint: `
                FOREIGN KEY (workspace_id, usage_event_id)
                    REFERENCES hosted_usage_event(workspace_id, id)
                    ON DELETE RESTRICT
            `,
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_usage_event',
            constraint: `
                FOREIGN KEY (workspace_id, billing_ledger_entry_id)
                    REFERENCES hosted_billing_ledger_entry(workspace_id, id)
                    ON DELETE RESTRICT
            `,
        })
        for (const constraint of [
            `
                FOREIGN KEY (workspace_id, job_id)
                    REFERENCES hosted_room_job(workspace_id, id)
                    ON DELETE RESTRICT
            `,
            `
                FOREIGN KEY (workspace_id, usage_event_id)
                    REFERENCES hosted_usage_event(workspace_id, id)
                    ON DELETE RESTRICT
            `,
            `
                FOREIGN KEY (workspace_id, billing_ledger_entry_id)
                    REFERENCES hosted_billing_ledger_entry(workspace_id, id)
                    ON DELETE RESTRICT
            `,
        ]) {
            expectTableConstraint({
                sql,
                tableName: 'hosted_billing_reservation',
                constraint,
            })
        }
        for (const triggerName of [
            'hosted_room_delete_clear_usage_event_room_id',
            'hosted_room_job_delete_clear_usage_event_job_id',
            'hosted_billing_ledger_entry_delete_clear_usage_event_ledger_id',
            'hosted_usage_event_delete_clear_billing_ledger_usage_id',
            'hosted_room_job_delete_clear_job_run_job_id',
            'hosted_room_delete_clear_billing_reservation_room_id',
            'hosted_room_job_delete_clear_billing_reservation_job_id',
            'hosted_usage_event_delete_clear_billing_reservation_usage_id',
            'hosted_billing_ledger_entry_delete_clear_billing_reservation_ledger_id',
        ]) {
            expect(normalizeSqlFragment(sql)).toContain(
                normalizeSqlFragment(`CREATE TRIGGER ${triggerName}`),
            )
        }
    })

    it('enforces owner-only hosted membership from the baseline schema', async () => {
        const db = await createHostedControlPlaneDb()
        try {
            const now = new Date(0).toISOString()
            await insertHostedAuthRow({
                db,
                userId: 'user_1',
                organizationId: 'workspace_1',
                memberId: 'member_1',
            })

            await expect(
                db.execute({
                    sql: `
                        INSERT OR IGNORE INTO member (
                            id,
                            organizationId,
                            userId,
                            role,
                            createdAt
                        )
                        VALUES ('member_1', 'workspace_1', 'user_1', 'owner', ?1)
                    `,
                    args: [now],
                }),
            ).resolves.toBeDefined()

            await expect(
                db.execute({
                    sql: `
                        INSERT INTO invitation (
                            id,
                            organizationId,
                            email,
                            role,
                            status,
                            expiresAt,
                            createdAt,
                            inviterId
                        )
                        VALUES ('invitation_1', 'workspace_1', 'invitee@example.test', 'owner', 'pending', ?1, ?1, 'user_1')
                    `,
                    args: [now],
                }),
            ).rejects.toThrow(/invitations/)

            await expect(
                insertHostedAuthRow({
                    db,
                    userId: 'user_non_owner',
                    organizationId: 'workspace_non_owner',
                    memberId: 'member_non_owner',
                    role: 'member',
                }),
            ).rejects.toThrow(/owner-only/)

            await insertHostedAuthRow({
                db,
                userId: 'user_2',
                organizationId: 'workspace_2',
                memberId: 'member_2',
            })

            await expect(
                db.execute({
                    sql: `
                        INSERT OR REPLACE INTO member (
                            id,
                            organizationId,
                            userId,
                            role,
                            createdAt
                        )
                        VALUES ('member_1', 'workspace_2', 'user_2', 'owner', ?1)
                    `,
                    args: [now],
                }),
            ).rejects.toThrow(/Hosted/)
            const member = await db.execute({
                sql: 'SELECT organizationId, userId FROM member WHERE id = ?1',
                args: ['member_1'],
            })
            expect(member.rows[0]).toMatchObject({
                organizationId: 'workspace_1',
                userId: 'user_1',
            })

            await expect(
                db.execute({
                    sql: `
                        INSERT INTO member (
                            id,
                            organizationId,
                            userId,
                            role,
                            createdAt
                        )
                        VALUES ('member_3', 'workspace_1', 'user_2', 'owner', ?1)
                    `,
                    args: [now],
                }),
            ).rejects.toThrow(/Hosted/)

            await expect(
                db.execute({
                    sql: `
                        INSERT INTO organization (
                            id,
                            name,
                            slug,
                            logo,
                            createdAt,
                            metadata
                        )
                        VALUES ('workspace_3', 'workspace_3', 'workspace_3', NULL, ?1, '{}')
                    `,
                    args: [now],
                }),
            ).resolves.toBeDefined()

            await expect(
                db.execute({
                    sql: `
                        INSERT INTO member (
                            id,
                            organizationId,
                            userId,
                            role,
                            createdAt
                        )
                        VALUES ('member_4', 'workspace_3', 'user_1', 'owner', ?1)
                    `,
                    args: [now],
                }),
            ).rejects.toThrow(/one workspace/)
        } finally {
            db.close()
        }
    })

    it('rejects cross-workspace hosted runtime config references at the database layer', async () => {
        const db = await createHostedFullDb()
        try {
            const now = new Date(0).toISOString()
            await insertHostedAuthRow({
                db,
                userId: 'user_1',
                organizationId: 'workspace_1',
                memberId: 'member_1',
            })
            await insertHostedAuthRow({
                db,
                userId: 'user_2',
                organizationId: 'workspace_2',
                memberId: 'member_2',
            })
            await db.execute({
                sql: `
                    INSERT INTO hosted_room (
                        id,
                        workspace_id,
                        slug,
                        display_name,
                        status,
                        desired_state,
                        created_by_user_id,
                        created_at,
                        updated_at
                    )
                    VALUES ('room_1', 'workspace_1', 'room-1', 'Room 1', 'stopped', 'stopped', 'user_1', ?1, ?1)
                `,
                args: [now],
            })
            await db.execute({
                sql: `
                    INSERT INTO hosted_provider_connection (
                        id,
                        workspace_id,
                        label,
                        provider,
                        auth_mode,
                        api,
                        base_url,
                        default_model,
                        fallback_models,
                        credential_secret_id,
                        status,
                        validation_message,
                        last_validated_at,
                        created_by_user_id,
                        created_at,
                        updated_at
                    )
                    VALUES ('provider_2', 'workspace_2', 'Provider 2', 'openai', 'api_key', 'openai-completions', NULL, 'gpt-test', '[]', NULL, 'ready', NULL, NULL, 'user_2', ?1, ?1)
                `,
                args: [now],
            })
            await db.execute({
                sql: `
                    INSERT INTO hosted_mcp_connection (
                        id,
                        workspace_id,
                        name,
                        server_key,
                        transport,
                        command,
                        args,
                        url,
                        headers,
                        auth_mode,
                        credential_secret_id,
                        allowed_tools,
                        status,
                        validation_message,
                        last_validated_at,
                        created_by_user_id,
                        created_at,
                        updated_at
                    )
                    VALUES ('mcp_2', 'workspace_2', 'MCP 2', 'mcp-2', 'http', NULL, '[]', 'https://mcp.example.test', '{}', 'none', NULL, '[]', 'ready', NULL, NULL, 'user_2', ?1, ?1)
                `,
                args: [now],
            })
            await db.execute({
                sql: `
                    INSERT INTO hosted_secret (
                        id,
                        workspace_id,
                        key_name,
                        cipher_text,
                        nonce,
                        auth_tag,
                        key_version,
                        created_at,
                        updated_at
                    )
                    VALUES ('secret_2', 'workspace_2', 'secret-2', 'cipher', 'nonce', 'tag', 1, ?1, ?1)
                `,
                args: [now],
            })

            await expect(
                db.execute({
                    sql: `
                        INSERT INTO hosted_provider_connection (
                            id,
                            workspace_id,
                            label,
                            provider,
                            auth_mode,
                            api,
                            base_url,
                            default_model,
                            fallback_models,
                            credential_secret_id,
                            status,
                            validation_message,
                            last_validated_at,
                            created_by_user_id,
                            created_at,
                            updated_at
                        )
                        VALUES ('provider_cross_secret', 'workspace_1', 'Provider Cross Secret', 'openai', 'api_key', 'openai-completions', NULL, 'gpt-test', '[]', 'secret_2', 'ready', NULL, NULL, 'user_1', ?1, ?1)
                    `,
                    args: [now],
                }),
            ).rejects.toThrow(/FOREIGN KEY/)

            await expect(
                db.execute({
                    sql: `
                        INSERT INTO hosted_mcp_connection (
                            id,
                            workspace_id,
                            name,
                            server_key,
                            transport,
                            command,
                            args,
                            url,
                            headers,
                            auth_mode,
                            credential_secret_id,
                            allowed_tools,
                            status,
                            validation_message,
                            last_validated_at,
                            created_by_user_id,
                            created_at,
                            updated_at
                        )
                        VALUES ('mcp_cross_secret', 'workspace_1', 'MCP Cross Secret', 'mcp-cross-secret', 'http', NULL, '[]', 'https://mcp.example.test', '{}', 'bearer', 'secret_2', '[]', 'ready', NULL, NULL, 'user_1', ?1, ?1)
                    `,
                    args: [now],
                }),
            ).rejects.toThrow(/FOREIGN KEY/)

            await expect(
                db.execute({
                    sql: `
                        INSERT INTO hosted_workspace_settings (
                            workspace_id,
                            default_provider_connection_id,
                            default_model,
                            capability_defaults,
                            search_config,
                            image_config,
                            onboarding_completed_at,
                            created_at,
                            updated_at
                        )
                        VALUES ('workspace_1', 'provider_2', NULL, '{}', '{}', '{}', NULL, ?1, ?1)
                    `,
                    args: [now],
                }),
            ).rejects.toThrow(/FOREIGN KEY/)

            await expect(
                db.execute({
                    sql: `
                        INSERT INTO hosted_room_config (
                            room_id,
                            workspace_id,
                            instructions,
                            provider_mode,
                            provider_connection_id,
                            room_mode,
                            capability_overrides,
                            image_provider,
                            image_model,
                            image_secret_id,
                            cron_timezone,
                            browser_action_budget,
                            created_at,
                            updated_at
                        )
                        VALUES ('room_1', 'workspace_1', '', 'app_connection', 'provider_2', 'coworker', '{}', NULL, NULL, NULL, 'UTC', 50, ?1, ?1)
                    `,
                    args: [now],
                }),
            ).rejects.toThrow(/FOREIGN KEY/)

            await expect(
                db.execute({
                    sql: `
                        INSERT INTO hosted_room_config (
                            room_id,
                            workspace_id,
                            instructions,
                            provider_mode,
                            provider_connection_id,
                            room_mode,
                            capability_overrides,
                            image_provider,
                            image_model,
                            image_secret_id,
                            cron_timezone,
                            browser_action_budget,
                            created_at,
                            updated_at
                        )
                        VALUES ('room_1', 'workspace_1', '', 'app_default', NULL, 'coworker', '{}', 'openai', 'gpt-image-test', 'secret_2', 'UTC', 50, ?1, ?1)
                    `,
                    args: [now],
                }),
            ).rejects.toThrow(/FOREIGN KEY/)

            await expect(
                db.execute({
                    sql: `
                        INSERT INTO hosted_room_mcp_binding (
                            workspace_id,
                            room_id,
                            mcp_connection_id,
                            allowed_tools,
                            enabled,
                            created_at,
                            updated_at
                        )
                        VALUES ('workspace_1', 'room_1', 'mcp_2', '[]', 1, ?1, ?1)
                    `,
                    args: [now],
                }),
            ).rejects.toThrow(/FOREIGN KEY/)

            await expect(
                db.execute({
                    sql: `
                        INSERT INTO hosted_room_secret (
                            id,
                            workspace_id,
                            room_id,
                            secret_id,
                            label,
                            env_key,
                            purpose,
                            provider,
                            created_by_user_id,
                            created_at,
                            updated_at
                        )
                        VALUES ('room_secret_1', 'workspace_1', 'room_1', 'secret_2', 'Secret', 'SECRET', 'generic', NULL, 'user_1', ?1, ?1)
                    `,
                    args: [now],
                }),
            ).rejects.toThrow(/FOREIGN KEY/)
        } finally {
            db.close()
        }
    })

    it('rejects cross-workspace hosted execution and billing references at the database layer', async () => {
        const db = await createHostedFullDb()
        try {
            const now = new Date(0).toISOString()
            await insertHostedAuthRow({
                db,
                userId: 'user_1',
                organizationId: 'workspace_1',
                memberId: 'member_1',
            })
            await insertHostedAuthRow({
                db,
                userId: 'user_2',
                organizationId: 'workspace_2',
                memberId: 'member_2',
            })
            for (const [workspaceId, roomId, userId] of [
                ['workspace_1', 'room_1', 'user_1'],
                ['workspace_2', 'room_2', 'user_2'],
            ] as const) {
                await db.execute({
                    sql: `
                        INSERT INTO hosted_room (
                            id,
                            workspace_id,
                            slug,
                            display_name,
                            status,
                            desired_state,
                            created_by_user_id,
                            created_at,
                            updated_at
                        )
                        VALUES (?1, ?2, ?3, ?4, 'stopped', 'stopped', ?5, ?6, ?6)
                    `,
                    args: [roomId, workspaceId, roomId, roomId, userId, now],
                })
            }
            await db.execute({
                sql: `
                    INSERT INTO hosted_room_job (
                        id,
                        workspace_id,
                        room_id,
                        name,
                        message,
                        enabled,
                        schedule,
                        timezone,
                        next_run_at,
                        running_at,
                        locked_until,
                        lock_token,
                        last_run_at,
                        last_run_status,
                        last_error,
                        created_at,
                        updated_at
                    )
                    VALUES ('job_2', 'workspace_2', 'room_2', 'Job 2', 'Run', 1, '{}', 'UTC', NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?1, ?1)
                `,
                args: [now],
            })
            await db.execute({
                sql: `
                    INSERT INTO hosted_usage_event (
                        id,
                        workspace_id,
                        room_id,
                        session_key,
                        run_id,
                        job_id,
                        kind,
                        provider,
                        model,
                        tool_name,
                        input_tokens,
                        output_tokens,
                        cached_tokens,
                        cost_micros,
                        billing_status,
                        billing_ledger_entry_id,
                        created_at
                    )
                    VALUES ('usage_2', 'workspace_2', 'room_2', NULL, 'run_2', 'job_2', 'job', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'not_billable', NULL, ?1)
                `,
                args: [now],
            })
            await db.execute({
                sql: `
                    INSERT INTO hosted_billing_ledger_entry (
                        id,
                        workspace_id,
                        direction,
                        source,
                        amount_cents,
                        balance_after_cents,
                        stripe_event_id,
                        stripe_checkout_session_id,
                        stripe_invoice_id,
                        usage_event_id,
                        idempotency_key,
                        metadata,
                        created_at
                    )
                    VALUES ('ledger_2', 'workspace_2', 'debit', 'hosted_brave_usage', 1, 0, NULL, NULL, NULL, 'usage_2', 'ledger_2', '{}', ?1)
                `,
                args: [now],
            })

            await expect(
                db.execute({
                    sql: `
                        INSERT INTO hosted_usage_event (
                            id,
                            workspace_id,
                            room_id,
                            session_key,
                            run_id,
                            job_id,
                            kind,
                            provider,
                            model,
                            tool_name,
                            input_tokens,
                            output_tokens,
                            cached_tokens,
                            cost_micros,
                            billing_status,
                            billing_ledger_entry_id,
                            created_at
                        )
                        VALUES ('usage_cross_job', 'workspace_1', 'room_1', NULL, 'run_cross', 'job_2', 'job', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'not_billable', NULL, ?1)
                    `,
                    args: [now],
                }),
            ).rejects.toThrow(/FOREIGN KEY/)

            await expect(
                db.execute({
                    sql: `
                        INSERT INTO hosted_room_job_run (
                            id,
                            workspace_id,
                            room_id,
                            job_id,
                            job_name,
                            attempt,
                            status,
                            summary,
                            error,
                            lock_token,
                            session_key,
                            session_id,
                            provider,
                            model,
                            config_version,
                            started_at,
                            finished_at,
                            duration_ms,
                            next_run_at
                        )
                        VALUES ('run_cross_job', 'workspace_1', 'room_1', 'job_2', 'Job 2', 1, 'running', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?1, NULL, NULL, NULL)
                    `,
                    args: [now],
                }),
            ).rejects.toThrow(/FOREIGN KEY/)

            await expect(
                db.execute({
                    sql: `
                        INSERT INTO hosted_billing_ledger_entry (
                            id,
                            workspace_id,
                            direction,
                            source,
                            amount_cents,
                            balance_after_cents,
                            stripe_event_id,
                            stripe_checkout_session_id,
                            stripe_invoice_id,
                            usage_event_id,
                            idempotency_key,
                            metadata,
                            created_at
                        )
                        VALUES ('ledger_cross_usage', 'workspace_1', 'debit', 'hosted_brave_usage', 1, 0, NULL, NULL, NULL, 'usage_2', 'ledger_cross_usage', '{}', ?1)
                    `,
                    args: [now],
                }),
            ).rejects.toThrow(/FOREIGN KEY/)

            await expect(
                insertHostedUsageEvent({
                    db,
                    workspaceId: 'workspace_1',
                    roomId: 'room_1',
                    usageId: 'usage_cross_ledger',
                    billingLedgerEntryId: 'ledger_2',
                    now,
                }),
            ).rejects.toThrow(/FOREIGN KEY/)

            await expect(
                db.execute({
                    sql: `
                        INSERT INTO hosted_billing_reservation (
                            id,
                            workspace_id,
                            room_id,
                            session_key,
                            run_id,
                            job_id,
                            provider,
                            status,
                            reserved_cents,
                            included_reserved_cents,
                            purchased_reserved_cents,
                            settled_cents,
                            usage_event_id,
                            billing_ledger_entry_id,
                            idempotency_key,
                            metadata,
                            expires_at,
                            created_at,
                            updated_at
                        )
                        VALUES ('reservation_cross_job', 'workspace_1', 'room_1', NULL, NULL, 'job_2', 'brave', 'authorized', 1, 1, 0, 0, NULL, NULL, 'reservation_cross_job', '{}', ?1, ?1, ?1)
                    `,
                    args: [now],
                }),
            ).rejects.toThrow(/FOREIGN KEY/)

            await expect(
                db.execute({
                    sql: `
                        INSERT INTO hosted_billing_reservation (
                            id,
                            workspace_id,
                            room_id,
                            session_key,
                            run_id,
                            job_id,
                            provider,
                            status,
                            reserved_cents,
                            included_reserved_cents,
                            purchased_reserved_cents,
                            settled_cents,
                            usage_event_id,
                            billing_ledger_entry_id,
                            idempotency_key,
                            metadata,
                            expires_at,
                            created_at,
                            updated_at
                        )
                        VALUES ('reservation_cross_usage', 'workspace_1', 'room_1', NULL, NULL, NULL, 'brave', 'authorized', 1, 1, 0, 0, 'usage_2', NULL, 'reservation_cross_usage', '{}', ?1, ?1, ?1)
                    `,
                    args: [now],
                }),
            ).rejects.toThrow(/FOREIGN KEY/)

            await expect(
                db.execute({
                    sql: `
                        INSERT INTO hosted_billing_reservation (
                            id,
                            workspace_id,
                            room_id,
                            session_key,
                            run_id,
                            job_id,
                            provider,
                            status,
                            reserved_cents,
                            included_reserved_cents,
                            purchased_reserved_cents,
                            settled_cents,
                            usage_event_id,
                            billing_ledger_entry_id,
                            idempotency_key,
                            metadata,
                            expires_at,
                            created_at,
                            updated_at
                        )
                        VALUES ('reservation_cross_ledger', 'workspace_1', 'room_1', NULL, NULL, NULL, 'brave', 'authorized', 1, 1, 0, 0, NULL, 'ledger_2', 'reservation_cross_ledger', '{}', ?1, ?1, ?1)
                    `,
                    args: [now],
                }),
            ).rejects.toThrow(/same room/)
        } finally {
            db.close()
        }
    })

    it('rejects same-workspace cross-room execution and billing references at the database layer', async () => {
        const db = await createHostedFullDb()
        try {
            const now = new Date(0).toISOString()
            await insertHostedAuthRow({
                db,
                userId: 'user_1',
                organizationId: 'workspace_1',
                memberId: 'member_1',
            })
            await insertHostedRoom({
                db,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                userId: 'user_1',
                now,
            })
            await insertHostedRoom({
                db,
                workspaceId: 'workspace_1',
                roomId: 'room_2',
                userId: 'user_1',
                now,
            })
            await insertHostedRoomJob({
                db,
                workspaceId: 'workspace_1',
                roomId: 'room_2',
                jobId: 'job_2',
                now,
            })
            await insertHostedUsageEvent({
                db,
                workspaceId: 'workspace_1',
                roomId: 'room_2',
                usageId: 'usage_2',
                jobId: 'job_2',
                now,
            })
            await insertHostedBillingLedgerEntry({
                db,
                workspaceId: 'workspace_1',
                ledgerId: 'ledger_2',
                usageEventId: 'usage_2',
                now,
            })

            await expect(
                insertHostedUsageEvent({
                    db,
                    workspaceId: 'workspace_1',
                    roomId: 'room_1',
                    usageId: 'usage_wrong_job',
                    jobId: 'job_2',
                    now,
                }),
            ).rejects.toThrow(/FOREIGN KEY/)

            await expect(
                insertHostedRoomJobRun({
                    db,
                    workspaceId: 'workspace_1',
                    roomId: 'room_1',
                    runId: 'run_wrong_job',
                    jobId: 'job_2',
                    now,
                }),
            ).rejects.toThrow(/FOREIGN KEY/)

            await expect(
                insertHostedUsageEvent({
                    db,
                    workspaceId: 'workspace_1',
                    roomId: 'room_1',
                    usageId: 'usage_wrong_ledger',
                    billingLedgerEntryId: 'ledger_2',
                    now,
                }),
            ).rejects.toThrow(/FOREIGN KEY/)

            await expect(
                insertHostedBillingReservation({
                    db,
                    workspaceId: 'workspace_1',
                    roomId: 'room_1',
                    reservationId: 'reservation_wrong_job',
                    jobId: 'job_2',
                    now,
                }),
            ).rejects.toThrow(/FOREIGN KEY/)

            await expect(
                insertHostedBillingReservation({
                    db,
                    workspaceId: 'workspace_1',
                    roomId: 'room_1',
                    reservationId: 'reservation_wrong_usage',
                    usageEventId: 'usage_2',
                    now,
                }),
            ).rejects.toThrow(/FOREIGN KEY/)

            await expect(
                insertHostedBillingReservation({
                    db,
                    workspaceId: 'workspace_1',
                    roomId: 'room_1',
                    reservationId: 'reservation_wrong_ledger',
                    billingLedgerEntryId: 'ledger_2',
                    now,
                }),
            ).rejects.toThrow(/same room/)
        } finally {
            db.close()
        }
    })

    it('accepts same-workspace hosted execution and billing references at the database layer', async () => {
        const db = await createHostedFullDb()
        try {
            const now = new Date(0).toISOString()
            await insertHostedAuthRow({
                db,
                userId: 'user_1',
                organizationId: 'workspace_1',
                memberId: 'member_1',
            })
            await insertHostedRoom({
                db,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                userId: 'user_1',
                now,
            })
            await insertHostedRoomJob({
                db,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                jobId: 'job_1',
                now,
            })
            await insertHostedRoomJobRun({
                db,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                runId: 'run_1',
                jobId: 'job_1',
                now,
            })
            await insertHostedUsageEvent({
                db,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                usageId: 'usage_1',
                jobId: 'job_1',
                now,
            })
            await insertHostedBillingLedgerEntry({
                db,
                workspaceId: 'workspace_1',
                ledgerId: 'ledger_1',
                usageEventId: 'usage_1',
                now,
            })
            await db.execute({
                sql: `
                    UPDATE hosted_usage_event
                    SET billing_ledger_entry_id = 'ledger_1'
                    WHERE workspace_id = 'workspace_1'
                      AND id = 'usage_1'
                `,
            })
            await insertHostedBillingReservation({
                db,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                reservationId: 'reservation_1',
                jobId: 'job_1',
                usageEventId: 'usage_1',
                billingLedgerEntryId: 'ledger_1',
                now,
            })

            const reservation = await db.execute({
                sql: `
                    SELECT job_id AS jobId,
                           usage_event_id AS usageEventId,
                           billing_ledger_entry_id AS billingLedgerEntryId
                    FROM hosted_billing_reservation
                    WHERE id = 'reservation_1'
                `,
            })

            expect(reservation.rows[0]).toMatchObject({
                jobId: 'job_1',
                usageEventId: 'usage_1',
                billingLedgerEntryId: 'ledger_1',
            })
        } finally {
            db.close()
        }
    })

    it('preserves hosted history rows when scoped nullable parents are deleted', async () => {
        const db = await createHostedFullDb()
        try {
            const now = new Date(0).toISOString()
            await insertHostedAuthRow({
                db,
                userId: 'user_1',
                organizationId: 'workspace_1',
                memberId: 'member_1',
            })
            await insertHostedRoom({
                db,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                userId: 'user_1',
                now,
            })
            await insertHostedRoomJob({
                db,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                jobId: 'job_1',
                now,
            })
            await insertHostedRoomJobRun({
                db,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                runId: 'run_1',
                jobId: 'job_1',
                now,
            })
            await insertHostedUsageEvent({
                db,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                usageId: 'usage_1',
                jobId: 'job_1',
                now,
            })
            await insertHostedBillingLedgerEntry({
                db,
                workspaceId: 'workspace_1',
                ledgerId: 'ledger_1',
                usageEventId: 'usage_1',
                now,
            })
            await db.execute({
                sql: `
                    UPDATE hosted_usage_event
                    SET billing_ledger_entry_id = 'ledger_1'
                    WHERE workspace_id = 'workspace_1'
                      AND id = 'usage_1'
                `,
            })
            await insertHostedBillingReservation({
                db,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                reservationId: 'reservation_1',
                jobId: 'job_1',
                usageEventId: 'usage_1',
                billingLedgerEntryId: 'ledger_1',
                now,
            })

            await db.execute({
                sql: `
                    DELETE FROM hosted_room_job
                    WHERE workspace_id = 'workspace_1'
                      AND id = 'job_1'
                `,
            })

            const jobRefs = await db.execute({
                sql: `
                    SELECT (
                        SELECT job_id
                        FROM hosted_room_job_run
                        WHERE id = 'run_1'
                    ) AS runJobId,
                    (
                        SELECT job_id
                        FROM hosted_usage_event
                        WHERE id = 'usage_1'
                    ) AS usageJobId,
                    (
                        SELECT job_id
                        FROM hosted_billing_reservation
                        WHERE id = 'reservation_1'
                    ) AS reservationJobId
                `,
            })

            expect(jobRefs.rows[0]).toMatchObject({
                runJobId: null,
                usageJobId: null,
                reservationJobId: null,
            })

            await db.execute({
                sql: `
                    DELETE FROM hosted_billing_ledger_entry
                    WHERE workspace_id = 'workspace_1'
                      AND id = 'ledger_1'
                `,
            })

            const ledgerRefs = await db.execute({
                sql: `
                    SELECT (
                        SELECT billing_ledger_entry_id
                        FROM hosted_usage_event
                        WHERE id = 'usage_1'
                    ) AS usageLedgerId,
                    (
                        SELECT billing_ledger_entry_id
                        FROM hosted_billing_reservation
                        WHERE id = 'reservation_1'
                    ) AS reservationLedgerId
                `,
            })

            expect(ledgerRefs.rows[0]).toMatchObject({
                usageLedgerId: null,
                reservationLedgerId: null,
            })

            await db.execute({
                sql: `
                    DELETE FROM hosted_usage_event
                    WHERE workspace_id = 'workspace_1'
                      AND id = 'usage_1'
                `,
            })

            const usageRefs = await db.execute({
                sql: `
                    SELECT usage_event_id AS usageEventId
                    FROM hosted_billing_reservation
                    WHERE id = 'reservation_1'
                `,
            })

            expect(usageRefs.rows[0]).toMatchObject({
                usageEventId: null,
            })
        } finally {
            db.close()
        }
    })

    it('preserves hosted billing evidence when deleting a room', async () => {
        const db = await createHostedFullDb()
        try {
            const now = new Date(0).toISOString()
            await insertHostedAuthRow({
                db,
                userId: 'user_1',
                organizationId: 'workspace_1',
                memberId: 'member_1',
            })
            await insertHostedRoom({
                db,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                userId: 'user_1',
                now,
            })
            await insertHostedRoomJob({
                db,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                jobId: 'job_1',
                now,
            })
            await insertHostedUsageEvent({
                db,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                usageId: 'usage_1',
                jobId: 'job_1',
                now,
            })
            await insertHostedBillingLedgerEntry({
                db,
                workspaceId: 'workspace_1',
                ledgerId: 'ledger_1',
                usageEventId: 'usage_1',
                now,
            })
            await db.execute({
                sql: `
                    UPDATE hosted_usage_event
                    SET billing_ledger_entry_id = 'ledger_1'
                    WHERE workspace_id = 'workspace_1'
                      AND id = 'usage_1'
                `,
            })
            await insertHostedBillingReservation({
                db,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                reservationId: 'reservation_1',
                jobId: 'job_1',
                usageEventId: 'usage_1',
                billingLedgerEntryId: 'ledger_1',
                now,
            })

            await db.execute({
                sql: `
                    DELETE FROM hosted_room
                    WHERE workspace_id = 'workspace_1'
                      AND id = 'room_1'
                `,
            })

            const evidence = await db.execute({
                sql: `
                    SELECT (
                        SELECT room_id
                        FROM hosted_usage_event
                        WHERE id = 'usage_1'
                    ) AS usageRoomId,
                    (
                        SELECT job_id
                        FROM hosted_usage_event
                        WHERE id = 'usage_1'
                    ) AS usageJobId,
                    (
                        SELECT usage_event_id
                        FROM hosted_billing_ledger_entry
                        WHERE id = 'ledger_1'
                    ) AS ledgerUsageId,
                    (
                        SELECT room_id
                        FROM hosted_billing_reservation
                        WHERE id = 'reservation_1'
                    ) AS reservationRoomId,
                    (
                        SELECT job_id
                        FROM hosted_billing_reservation
                        WHERE id = 'reservation_1'
                    ) AS reservationJobId,
                    (
                        SELECT usage_event_id
                        FROM hosted_billing_reservation
                        WHERE id = 'reservation_1'
                    ) AS reservationUsageId,
                    (
                        SELECT billing_ledger_entry_id
                        FROM hosted_billing_reservation
                        WHERE id = 'reservation_1'
                    ) AS reservationLedgerId
                `,
            })

            expect(evidence.rows[0]).toMatchObject({
                usageRoomId: null,
                usageJobId: null,
                ledgerUsageId: 'usage_1',
                reservationRoomId: null,
                reservationJobId: null,
                reservationUsageId: 'usage_1',
                reservationLedgerId: 'ledger_1',
            })
        } finally {
            db.close()
        }
    })

    it('preserves hosted ledger rows when deleting a usage event', async () => {
        const db = await createHostedFullDb()
        try {
            const now = new Date(0).toISOString()
            await insertHostedAuthRow({
                db,
                userId: 'user_1',
                organizationId: 'workspace_1',
                memberId: 'member_1',
            })
            await insertHostedRoom({
                db,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                userId: 'user_1',
                now,
            })
            await insertHostedUsageEvent({
                db,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                usageId: 'usage_1',
                now,
            })
            await insertHostedBillingLedgerEntry({
                db,
                workspaceId: 'workspace_1',
                ledgerId: 'ledger_1',
                usageEventId: 'usage_1',
                now,
            })
            await db.execute({
                sql: `
                    UPDATE hosted_usage_event
                    SET billing_ledger_entry_id = 'ledger_1'
                    WHERE workspace_id = 'workspace_1'
                      AND id = 'usage_1'
                `,
            })
            await insertHostedBillingReservation({
                db,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                reservationId: 'reservation_1',
                usageEventId: 'usage_1',
                billingLedgerEntryId: 'ledger_1',
                now,
            })

            await db.execute({
                sql: `
                    DELETE FROM hosted_usage_event
                    WHERE workspace_id = 'workspace_1'
                      AND id = 'usage_1'
                `,
            })

            const evidence = await db.execute({
                sql: `
                    SELECT (
                        SELECT usage_event_id
                        FROM hosted_billing_ledger_entry
                        WHERE id = 'ledger_1'
                    ) AS ledgerUsageId,
                    (
                        SELECT usage_event_id
                        FROM hosted_billing_reservation
                        WHERE id = 'reservation_1'
                    ) AS reservationUsageId,
                    (
                        SELECT billing_ledger_entry_id
                        FROM hosted_billing_reservation
                        WHERE id = 'reservation_1'
                    ) AS reservationLedgerId
                `,
            })

            expect(evidence.rows[0]).toMatchObject({
                ledgerUsageId: null,
                reservationUsageId: null,
                reservationLedgerId: 'ledger_1',
            })
        } finally {
            db.close()
        }
    })

    it('constrains scheduled job enabled flags to boolean integers', () => {
        const sql = readHostedMigration()

        expectTableConstraint({
            sql,
            tableName: 'hosted_room_job',
            constraint: 'enabled INTEGER NOT NULL CHECK (enabled IN (0, 1))',
        })
    })

    it('keeps hosted runtime execution migration durable for existing rooms and audit history', () => {
        const sql = readHostedMigration()

        expect(normalizeSqlFragment(sql)).toContain(
            normalizeSqlFragment('INSERT INTO hosted_room_config'),
        )
        expect(normalizeSqlFragment(sql)).toContain(
            normalizeSqlFragment('CREATE TABLE hosted_room_job_run'),
        )
        expect(normalizeSqlFragment(sql)).not.toContain(
            normalizeSqlFragment('CREATE TABLE hosted_room_memory'),
        )
        expect(
            normalizeSqlFragment(extractTableDefinition(sql, 'hosted_audit_event')),
        ).not.toContain(normalizeSqlFragment('REFERENCES hosted_room(workspace_id, id)'))
    })

    it('constrains hosted billing balances and ledger amounts to non-negative cents', () => {
        const sql = readHostedMigration()

        expectTableConstraint({
            sql,
            tableName: 'hosted_billing_account',
            constraint:
                'included_balance_cents INTEGER NOT NULL DEFAULT 0 CHECK (included_balance_cents >= 0)',
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_billing_account',
            constraint:
                'purchased_balance_cents INTEGER NOT NULL DEFAULT 0 CHECK (purchased_balance_cents >= 0)',
        })
        expect(normalizeSqlFragment(sql)).toContain(
            normalizeSqlFragment(
                'ADD COLUMN included_reserved_cents INTEGER NOT NULL DEFAULT 0 CHECK (included_reserved_cents >= 0)',
            ),
        )
        expect(normalizeSqlFragment(sql)).toContain(
            normalizeSqlFragment(
                'ADD COLUMN purchased_reserved_cents INTEGER NOT NULL DEFAULT 0 CHECK (purchased_reserved_cents >= 0)',
            ),
        )
        expectTableConstraint({
            sql,
            tableName: 'hosted_billing_reservation',
            constraint: 'reserved_cents INTEGER NOT NULL CHECK (reserved_cents > 0)',
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_billing_reservation',
            constraint:
                'CHECK (included_reserved_cents + purchased_reserved_cents = reserved_cents)',
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_billing_ledger_entry',
            constraint: 'amount_cents INTEGER NOT NULL CHECK (amount_cents > 0)',
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_billing_ledger_entry',
            constraint: 'balance_after_cents INTEGER NOT NULL CHECK (balance_after_cents >= 0)',
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_billing_ledger_entry',
            constraint: 'UNIQUE(workspace_id, idempotency_key)',
        })
    })
})
