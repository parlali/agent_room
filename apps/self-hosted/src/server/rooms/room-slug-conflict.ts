export function isRoomSlugUniqueViolation(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
        return false
    }

    const record = error as { code?: unknown; message?: unknown }
    const code = String(record.code ?? '')
    const message = String(record.message ?? '')

    return code === 'SQLITE_CONSTRAINT_UNIQUE' || message.includes('UNIQUE constraint failed')
}

export function throwRoomSlugConflict(error: unknown, slug: string): never {
    if (isRoomSlugUniqueViolation(error)) {
        throw new Error(`A room named "${slug}" already exists. Choose a different name.`)
    }
    throw error
}
