import { createClient } from '@libsql/client'
import { describe, expect, it } from 'vitest'
import {
    createHostedFullDb,
    insertHostedAuthRow,
    insertHostedBillingLedgerEntry,
    insertHostedBillingReservation,
    insertHostedRoom,
    insertHostedRoomJob,
    insertHostedUsageEvent,
    readHostedMigrationFile,
} from './hosted-d1-schema-contract-support'

describe('hosted D1 schema contract', () => {
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

    it('scopes hosted Browserbase sessions to their owning hosted room', async () => {
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
            await insertHostedRoom({
                db,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                userId: 'user_1',
                now,
            })
            await insertHostedRoom({
                db,
                workspaceId: 'workspace_2',
                roomId: 'room_2',
                userId: 'user_2',
                now,
            })

            await db.execute({
                sql: `
                    INSERT INTO hosted_browserbase_session (
                        browserbase_session_id,
                        workspace_id,
                        room_id,
                        session_key,
                        run_id,
                        job_id,
                        usage_request_id,
                        status,
                        created_at,
                        updated_at,
                        released_at
                    )
                    VALUES ('bb-session-1', 'workspace_1', 'room_1', 'thread_1', 'run_1', NULL, 'usage_request_1', 'active', ?1, ?1, NULL)
                `,
                args: [now],
            })

            await expect(
                db.execute({
                    sql: `
                        INSERT INTO hosted_browserbase_session (
                            browserbase_session_id,
                            workspace_id,
                            room_id,
                            session_key,
                            run_id,
                            job_id,
                            usage_request_id,
                            status,
                            created_at,
                            updated_at,
                            released_at
                        )
                        VALUES ('bb-session-2', 'workspace_1', 'room_2', 'thread_2', 'run_2', NULL, 'usage_request_2', 'active', ?1, ?1, NULL)
                    `,
                    args: [now],
                }),
            ).rejects.toThrow()

            await expect(
                db.execute({
                    sql: `
                        INSERT INTO hosted_browserbase_session (
                            browserbase_session_id,
                            workspace_id,
                            room_id,
                            session_key,
                            run_id,
                            job_id,
                            usage_request_id,
                            status,
                            created_at,
                            updated_at,
                            released_at
                        )
                        VALUES ('bb-session-duplicate-usage', 'workspace_1', 'room_1', 'thread_1', 'run_1', NULL, 'usage_request_1', 'active', ?1, ?1, NULL)
                    `,
                    args: [now],
                }),
            ).rejects.toThrow()

            await db.execute({
                sql: `
                    DELETE FROM hosted_room
                    WHERE workspace_id = 'workspace_1'
                      AND id = 'room_1'
                `,
            })
            const remaining = await db.execute({
                sql: `
                    SELECT COUNT(*) AS count
                    FROM hosted_browserbase_session
                    WHERE browserbase_session_id = 'bb-session-1'
                `,
            })

            expect(remaining.rows[0]).toMatchObject({
                count: 0,
            })
        } finally {
            db.close()
        }
    })

    it('migrates existing billing enum constraints for managed web usage without writable schema', async () => {
        const db = createClient({ url: 'file::memory:' })
        try {
            const controlPlaneMigration = readHostedMigrationFile('0001_hosted_control_plane.sql')
            const reservationMigration = readHostedMigrationFile(
                '0003_hosted_billing_reservations.sql',
            )
            expect(controlPlaneMigration).toContain(
                ", 'hosted_browserbase_usage', 'hosted_fetch_url_usage'",
            )
            expect(reservationMigration).toContain(", 'browserbase', 'fetch_url'")
            const oldControlPlaneMigration = controlPlaneMigration.replace(
                ", 'hosted_browserbase_usage', 'hosted_fetch_url_usage'",
                '',
            )
            const oldReservationMigration = reservationMigration.replace(
                ", 'browserbase', 'fetch_url'",
                '',
            )
            const managedWebMigration = readHostedMigrationFile(
                '0004_hosted_managed_web_billing.sql',
            )

            expect(managedWebMigration).not.toMatch(/writable_schema/i)
            expect(managedWebMigration).not.toMatch(/PRAGMA\s+foreign_keys/i)
            expect(managedWebMigration).toMatch(/PRAGMA\s+defer_foreign_keys\s*=\s*ON/i)
            expect(oldControlPlaneMigration).not.toContain('hosted_browserbase_usage')
            expect(oldReservationMigration).not.toContain("'fetch_url'")

            await db.executeMultiple(oldControlPlaneMigration)
            await db.executeMultiple(readHostedMigrationFile('0002_hosted_runtime_execution.sql'))
            await db.executeMultiple(oldReservationMigration)

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
            await insertHostedBillingLedgerEntry({
                db,
                workspaceId: 'workspace_1',
                ledgerId: 'ledger_existing',
                now,
            })
            await insertHostedBillingReservation({
                db,
                workspaceId: 'workspace_1',
                roomId: 'room_1',
                reservationId: 'reservation_existing',
                now,
            })

            await db.executeMultiple(managedWebMigration)

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
                    VALUES ('ledger_browserbase', 'workspace_1', 'debit', 'hosted_browserbase_usage', 1, 0, NULL, NULL, NULL, NULL, 'ledger_browserbase', '{}', ?1)
                `,
                args: [now],
            })
            await db.execute({
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
                    VALUES ('reservation_fetch', 'workspace_1', 'room_1', NULL, NULL, NULL, 'fetch_url', 'authorized', 1, 1, 0, 0, NULL, NULL, 'reservation_fetch', '{}', ?1, ?1, ?1)
                `,
                args: [now],
            })

            const counts = await db.execute({
                sql: `
                    SELECT
                        (SELECT COUNT(*) FROM hosted_billing_ledger_entry) AS ledgerCount,
                        (SELECT COUNT(*) FROM hosted_billing_reservation) AS reservationCount
                `,
            })

            expect(counts.rows[0]).toMatchObject({
                ledgerCount: 2,
                reservationCount: 2,
            })
        } finally {
            db.close()
        }
    })
})
