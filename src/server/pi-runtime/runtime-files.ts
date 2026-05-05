import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

function isNotFoundError(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        String((error as { code: unknown }).code) === 'ENOENT'
    )
}

export async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
    try {
        return JSON.parse(await readFile(path, 'utf8')) as T
    } catch (error) {
        if (isNotFoundError(error)) {
            return fallback
        }
        throw new Error(`Failed to read runtime JSON file ${path}`)
    }
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), {
        recursive: true,
        mode: 0o700,
    })
    const tempPath = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
    await writeFile(tempPath, JSON.stringify(value, null, 4), {
        encoding: 'utf8',
        mode: 0o600,
    })
    await rename(tempPath, path)
}
