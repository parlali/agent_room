import { Database } from 'bun:sqlite'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { WaitlistSubmission } from '../src/content/types'

export type StoredWaitlistSubmission = WaitlistSubmission & {
    id: number
    createdAt: string
    sourceIp: string
}

type WaitlistStoreOptions = {
    databasePath: string
}

const waitlistSchemaSql = readFileSync(
    fileURLToPath(new URL('../db/migrations/0001_waitlist.sql', import.meta.url)),
    'utf8',
)

export function createWaitlistStore(options: WaitlistStoreOptions) {
    mkdirSync(dirname(options.databasePath), { recursive: true })

    const database = new Database(options.databasePath)

    database.exec(waitlistSchemaSql)

    const insertStatement = database.prepare(`
        INSERT INTO waitlist_submissions (
            created_at,
            source_ip,
            name,
            email,
            company,
            use_case,
            interest
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    return {
        save(submission: WaitlistSubmission, sourceIp: string): StoredWaitlistSubmission {
            const createdAt = new Date().toISOString()
            const result = insertStatement.run(
                createdAt,
                sourceIp,
                submission.name,
                submission.email,
                submission.company,
                submission.useCase,
                submission.interest,
            )

            return {
                id: Number(result.lastInsertRowid),
                createdAt,
                sourceIp,
                ...submission,
            }
        },
        close() {
            database.close()
        },
    }
}
