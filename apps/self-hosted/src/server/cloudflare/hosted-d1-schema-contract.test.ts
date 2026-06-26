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
    hostedQuotaActions,
    hostedQuotaDecisions,
    hostedQuotaPolicyStatuses,
    hostedQuotaScopes,
} from './hosted-abuse-controls'
import {
    hostedBillingLedgerDirections,
    hostedBillingLedgerSources,
    hostedBillingPlanStatuses,
    hostedBillingReservationProviders,
    hostedBillingReservationStatuses,
    hostedUsageBillingStatuses,
} from './hosted-billing-types'
import {
    extractCheckValues,
    extractTableDefinition,
    expectTableConstraint,
    normalizeSqlFragment,
    readHostedMigration,
} from './hosted-d1-schema-contract-support'

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
        expect(
            extractCheckValues({
                sql,
                tableName: 'hosted_quota_policy',
                columnName: 'status',
            }),
        ).toEqual([...hostedQuotaPolicyStatuses])
        expect(
            extractCheckValues({
                sql,
                tableName: 'hosted_quota_counter',
                columnName: 'scope',
            }),
        ).toEqual([...hostedQuotaScopes])
        expect(
            extractCheckValues({
                sql,
                tableName: 'hosted_quota_event',
                columnName: 'scope',
            }),
        ).toEqual([...hostedQuotaScopes])
        expect(
            extractCheckValues({
                sql,
                tableName: 'hosted_quota_event',
                columnName: 'action',
            }),
        ).toEqual([...hostedQuotaActions])
        expect(
            extractCheckValues({
                sql,
                tableName: 'hosted_quota_event',
                columnName: 'decision',
            }),
        ).toEqual([...hostedQuotaDecisions])
    })

    it('constrains scheduled job enabled flags to boolean integers', () => {
        const sql = readHostedMigration()

        expectTableConstraint({
            sql,
            tableName: 'hosted_room_job',
            constraint: 'enabled INTEGER NOT NULL CHECK (enabled IN (0, 1))',
        })
    })

    it('constrains hosted quota policy JSON columns to objects', () => {
        const sql = readHostedMigration()

        expectTableConstraint({
            sql,
            tableName: 'hosted_quota_policy',
            constraint:
                "limits TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(limits) AND json_type(limits) = 'object')",
        })
        expectTableConstraint({
            sql,
            tableName: 'hosted_quota_policy',
            constraint:
                "restrictions TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(restrictions) AND json_type(restrictions) = 'object')",
        })
    })

    it('keeps hosted runtime execution migration durable for existing rooms and audit history', () => {
        const sql = readHostedMigration()

        expect(normalizeSqlFragment(sql)).toContain(
            normalizeSqlFragment('INSERT INTO hosted_room_config'),
        )
        expect(normalizeSqlFragment(sql)).not.toContain(
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
