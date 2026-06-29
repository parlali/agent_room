import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

function readDependencies(file: string): Record<string, string> {
    const parsed = JSON.parse(readFileSync(resolve(appRoot, file), 'utf8')) as {
        dependencies?: Record<string, string>
    }
    return parsed.dependencies ?? {}
}

describe('runtime dependency manifest', () => {
    test('every runtime manifest dependency version matches the app package.json', () => {
        const appDependencies = readDependencies('package.json')
        const runtimeDependencies = readDependencies('package.runtime.json')
        expect(Object.keys(runtimeDependencies).length).toBeGreaterThan(0)
        for (const [name, version] of Object.entries(runtimeDependencies)) {
            expect(
                appDependencies[name],
                `runtime dependency ${name} must exist in package.json`,
            ).toBe(version)
        }
    })
})
