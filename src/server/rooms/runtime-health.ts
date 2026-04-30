import { writeFile } from 'node:fs/promises'
import type { RuntimeHealthSnapshot } from '../domain/types'

function isProcessAlive(pid: number | null): boolean {
    if (pid === null) {
        return false
    }
    try {
        process.kill(pid, 0)
        return true
    } catch {
        return false
    }
}

async function probeLoopbackHealth(input: {
    roomId: string
    port: number | null
}): Promise<boolean> {
    if (input.port === null) {
        return false
    }
    try {
        const response = await fetch(`http://127.0.0.1:${input.port}/health`, {
            signal: AbortSignal.timeout(1500),
        })
        if (!response.ok) {
            return false
        }
        const payload = (await response.json()) as {
            healthy?: unknown
            roomId?: unknown
            runtime?: unknown
        }
        return (
            payload.healthy === true && payload.roomId === input.roomId && payload.runtime === 'pi'
        )
    } catch {
        return false
    }
}

export async function collectRuntimeHealthSnapshot(input: {
    roomId: string
    port: number | null
    pid: number | null
}): Promise<RuntimeHealthSnapshot> {
    const [processAlive, loopbackHealthy] = await Promise.all([
        Promise.resolve(isProcessAlive(input.pid)),
        probeLoopbackHealth({
            roomId: input.roomId,
            port: input.port,
        }),
    ])

    const healthy = processAlive && loopbackHealthy
    const message = healthy
        ? 'Room runtime is healthy'
        : `processAlive=${processAlive} loopbackHealthy=${loopbackHealthy}`

    return {
        roomId: input.roomId,
        port: input.port,
        pid: input.pid,
        healthy,
        message,
        checkedAt: new Date().toISOString(),
    }
}

export async function writeRuntimeHealthSnapshot(path: string, snapshot: RuntimeHealthSnapshot) {
    await writeFile(path, JSON.stringify(snapshot, null, 4), {
        encoding: 'utf8',
        mode: 0o600,
    })
}
