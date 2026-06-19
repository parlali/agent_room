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
    })
})
