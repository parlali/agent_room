import { describe, expect, it } from 'vitest'
import {
    createHostedFullDb,
    insertHostedAuthRow,
    insertHostedBillingLedgerEntry,
    insertHostedBillingReservation,
    insertHostedRoom,
    insertHostedRoomJob,
    insertHostedUsageEvent,
} from './hosted-d1-schema-contract-support'

describe('hosted D1 schema contract', () => {
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
})
