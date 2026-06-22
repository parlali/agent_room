import { readFileSync } from 'node:fs'
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
    hostedUsageBillingStatuses,
} from './hosted-billing-types'

function readHostedMigration(): string {
    return readFileSync(
        new URL('../../../db/d1-migrations/0001_hosted_control_plane.sql', import.meta.url),
        'utf8',
    )
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
    })

    it('constrains scheduled job enabled flags to boolean integers', () => {
        const sql = readHostedMigration()

        expectTableConstraint({
            sql,
            tableName: 'hosted_room_job',
            constraint: 'enabled INTEGER NOT NULL CHECK (enabled IN (0, 1))',
        })
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
