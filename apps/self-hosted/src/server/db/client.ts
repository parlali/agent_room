import postgres from 'postgres'
import { getAppEnv } from '../config/env'

const env = getAppEnv()

export const sql = postgres(env.databaseUrl, {
    max: 10,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
})

export type DatabaseQuery = typeof sql | postgres.TransactionSql

export async function withTransaction<T>(work: (trx: postgres.TransactionSql) => Promise<T>) {
    return sql.begin(async (trx) => work(trx))
}
