import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import type { WaitlistSubmission } from '../src/content/types'

export type StoredWaitlistSubmission = WaitlistSubmission & {
    id: number
    createdAt: string
    sourceIp: string
}

type WaitlistStoreOptions = {
    databasePath: string
}

export function createWaitlistStore(options: WaitlistStoreOptions) {
    mkdirSync(dirname(options.databasePath), { recursive: true })

    const database = new Database(options.databasePath)

    database.exec(`
        CREATE TABLE IF NOT EXISTS waitlist_submissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            source_ip TEXT NOT NULL,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            company TEXT NOT NULL,
            use_case TEXT NOT NULL,
            interest TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS waitlist_submissions_email_idx
            ON waitlist_submissions (email);

        CREATE INDEX IF NOT EXISTS waitlist_submissions_created_at_idx
            ON waitlist_submissions (created_at);
    `)

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
