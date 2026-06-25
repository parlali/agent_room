import { afterEach, describe, expect, it } from 'vitest'
import { withIsolatedWebSearchProviderEnv } from './web-search-validation'

const testEnvKeyA = 'AGENT_ROOM_TEST_SEARCH_SECRET_A'
const testEnvKeyB = 'AGENT_ROOM_TEST_SEARCH_SECRET_B'

function envObservation(label: string): string {
    return [label, process.env[testEnvKeyA] ?? 'unset', process.env[testEnvKeyB] ?? 'unset'].join(
        ':',
    )
}

describe('web search validation env isolation', () => {
    const originalValues = new Map<string, string | undefined>()

    afterEach(() => {
        for (const key of [testEnvKeyA, testEnvKeyB]) {
            const value = originalValues.get(key)
            if (value === undefined) {
                delete process.env[key]
            } else {
                process.env[key] = value
            }
            originalValues.delete(key)
        }
    })

    it('serializes concurrent process env materialization', async () => {
        for (const key of [testEnvKeyA, testEnvKeyB]) {
            originalValues.set(key, process.env[key])
        }
        process.env[testEnvKeyA] = 'outer-a'
        process.env[testEnvKeyB] = 'outer-b'

        const observations: string[] = []
        let firstReadyResolve: () => void = () => {}
        let releaseFirst: () => void = () => {}
        const firstReady = new Promise<void>((resolve) => {
            firstReadyResolve = resolve
        })
        const firstRelease = new Promise<void>((resolve) => {
            releaseFirst = resolve
        })

        const first = withIsolatedWebSearchProviderEnv({
            isolatedEnvKeys: [testEnvKeyA, testEnvKeyB],
            env: {
                [testEnvKeyA]: 'first',
            },
            run: async () => {
                observations.push(envObservation('first-start'))
                firstReadyResolve()
                await firstRelease
                observations.push(envObservation('first-end'))
            },
        })
        await firstReady

        const second = withIsolatedWebSearchProviderEnv({
            isolatedEnvKeys: [testEnvKeyA, testEnvKeyB],
            env: {
                [testEnvKeyB]: 'second',
            },
            run: async () => {
                observations.push(envObservation('second'))
            },
        })
        await Promise.resolve()
        expect(observations).toEqual(['first-start:first:unset'])

        releaseFirst()
        await Promise.all([first, second])

        expect(observations).toEqual([
            'first-start:first:unset',
            'first-end:first:unset',
            'second:unset:second',
        ])
        expect(process.env[testEnvKeyA]).toBe('outer-a')
        expect(process.env[testEnvKeyB]).toBe('outer-b')
    })
})
