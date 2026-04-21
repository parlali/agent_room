import { createConnection } from 'node:net'
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

async function canConnectLoopback(port: number | null): Promise<boolean> {
    if (port === null) {
        return false
    }
    return new Promise<boolean>((resolve) => {
        const socket = createConnection({
            host: '127.0.0.1',
            port,
            timeout: 1500,
        })
        socket.on('connect', () => {
            socket.destroy()
            resolve(true)
        })
        socket.on('error', () => {
            resolve(false)
        })
        socket.on('timeout', () => {
            socket.destroy()
            resolve(false)
        })
    })
}

export async function collectRuntimeHealthSnapshot(input: {
    roomId: string
    port: number | null
    pid: number | null
}): Promise<RuntimeHealthSnapshot> {
    const [processAlive, loopbackReachable] = await Promise.all([
        Promise.resolve(isProcessAlive(input.pid)),
        canConnectLoopback(input.port),
    ])

    const healthy = processAlive && loopbackReachable
    const message = healthy
        ? 'Room runtime is healthy'
        : `processAlive=${processAlive} loopbackReachable=${loopbackReachable}`

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
