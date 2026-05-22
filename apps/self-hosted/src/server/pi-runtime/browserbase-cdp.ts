import { asRecord, redactBrowserbaseSensitiveText } from './browserbase-utils'

interface CdpTargetInfo {
    targetId: string
    type: string
    url?: string
}

interface CdpCommandResponse {
    id?: number
    result?: unknown
    error?: {
        message?: string
        code?: number
    }
}

interface PendingCdpCommand {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timeout: ReturnType<typeof setTimeout>
    cleanup: () => void
}

export class BrowserCdpConnection {
    private socket: WebSocket
    private commandTimeoutMs: number
    private nextId = 0
    private pending = new Map<number, PendingCdpCommand>()
    private closed = false

    private constructor(socket: WebSocket, commandTimeoutMs: number) {
        this.socket = socket
        this.commandTimeoutMs = commandTimeoutMs
        this.socket.addEventListener('message', this.onMessage)
        this.socket.addEventListener('close', this.onClose)
        this.socket.addEventListener('error', this.onClose)
    }

    static async connect(input: {
        url: string
        signal?: AbortSignal
        commandTimeoutMs: number
    }): Promise<BrowserCdpConnection> {
        const WebSocketConstructor = globalThis.WebSocket
        if (!WebSocketConstructor) {
            throw new Error('WebSocket is unavailable in this runtime')
        }
        let socket: WebSocket
        try {
            socket = new WebSocketConstructor(input.url)
        } catch {
            throw new Error('Browser CDP connection failed')
        }
        const connection = new BrowserCdpConnection(socket, input.commandTimeoutMs)
        try {
            await connection.waitForOpen({
                signal: input.signal,
                timeoutMs: input.commandTimeoutMs,
            })
            return connection
        } catch (error) {
            connection.close()
            if (
                error instanceof Error &&
                (error.message === 'Browser action was cancelled' ||
                    error.message === 'Browser CDP connection timed out')
            ) {
                throw error
            }
            throw new Error('Browser CDP connection failed')
        }
    }

    async attachToPage(signal?: AbortSignal): Promise<string> {
        const targets = await this.command('Target.getTargets', {}, undefined, signal)
        const targetInfos = Array.isArray(asRecord(targets)?.targetInfos)
            ? (asRecord(targets)?.targetInfos as unknown[])
            : []
        let page = targetInfos.map(parseCdpTargetInfo).find((target) => target?.type === 'page')
        if (!page) {
            const created = await this.command(
                'Target.createTarget',
                {
                    url: 'about:blank',
                },
                undefined,
                signal,
            )
            const targetId = asRecord(created)?.targetId
            if (typeof targetId !== 'string') {
                throw new Error('Browser target could not be created')
            }
            page = {
                targetId,
                type: 'page',
            }
        }
        const attached = await this.command(
            'Target.attachToTarget',
            {
                targetId: page.targetId,
                flatten: true,
            },
            undefined,
            signal,
        )
        const sessionId = asRecord(attached)?.sessionId
        if (typeof sessionId !== 'string') {
            throw new Error('Browser target could not be attached')
        }
        await this.command('Page.enable', {}, sessionId, signal)
        await this.command('Runtime.enable', {}, sessionId, signal)
        return sessionId
    }

    async command(
        method: string,
        params: Record<string, unknown> = {},
        sessionId?: string,
        signal?: AbortSignal,
    ): Promise<unknown> {
        if (this.closed || this.socket.readyState >= 2) {
            throw new Error('Browser CDP connection is closed')
        }
        if (signal?.aborted) {
            throw new Error('Browser action was cancelled')
        }
        const id = ++this.nextId
        const payload = {
            id,
            method,
            params,
            ...(sessionId ? { sessionId } : {}),
        }
        return new Promise<unknown>((resolve, reject) => {
            let cleanup = () => {}
            const abort = signal
                ? () => {
                      cleanup()
                      reject(new Error('Browser action was cancelled'))
                  }
                : null
            cleanup = () => {
                const pending = this.pending.get(id)
                if (!pending) {
                    return
                }
                clearTimeout(pending.timeout)
                pending.cleanup()
                this.pending.delete(id)
            }
            const timeout = setTimeout(() => {
                cleanup()
                reject(new Error(`Browser CDP command ${method} timed out`))
            }, this.commandTimeoutMs)
            timeout.unref?.()
            if (abort) {
                signal?.addEventListener('abort', abort, { once: true })
            }
            this.pending.set(id, {
                resolve: (value) => {
                    cleanup()
                    resolve(value)
                },
                reject: (error) => {
                    cleanup()
                    reject(error)
                },
                timeout,
                cleanup: () => {
                    if (abort) {
                        signal?.removeEventListener('abort', abort)
                    }
                },
            })
            try {
                this.socket.send(JSON.stringify(payload))
            } catch {
                cleanup()
                reject(new Error('Browser CDP send failed'))
            }
        })
    }

    close(): void {
        if (this.closed) return
        this.closed = true
        this.socket.removeEventListener('message', this.onMessage)
        this.socket.removeEventListener('close', this.onClose)
        this.socket.removeEventListener('error', this.onClose)
        this.rejectPending(new Error('Browser CDP connection closed'))
        if (this.socket.readyState < 2) {
            this.socket.close()
        }
    }

    private waitForOpen(input: { signal?: AbortSignal; timeoutMs: number }): Promise<void> {
        if (this.socket.readyState === 1) {
            return Promise.resolve()
        }
        return new Promise((resolve, reject) => {
            let timedOut = false
            const timeout = setTimeout(() => {
                timedOut = true
                cleanup()
                reject(new Error('Browser CDP connection timed out'))
            }, input.timeoutMs)
            timeout.unref?.()
            const cleanup = () => {
                clearTimeout(timeout)
                this.socket.removeEventListener('open', open)
                this.socket.removeEventListener('close', close)
                this.socket.removeEventListener('error', close)
                input.signal?.removeEventListener('abort', abort)
            }
            const open = () => {
                cleanup()
                resolve()
            }
            const close = () => {
                cleanup()
                reject(
                    new Error(
                        timedOut
                            ? 'Browser CDP connection timed out'
                            : 'Browser CDP connection failed',
                    ),
                )
            }
            const abort = () => {
                cleanup()
                reject(new Error('Browser action was cancelled'))
            }
            this.socket.addEventListener('open', open, { once: true })
            this.socket.addEventListener('close', close, { once: true })
            this.socket.addEventListener('error', close, { once: true })
            input.signal?.addEventListener('abort', abort, { once: true })
            if (input.signal?.aborted) {
                abort()
            }
        })
    }

    private onMessage = (event: MessageEvent) => {
        const data = typeof event.data === 'string' ? event.data : null
        if (!data) {
            return
        }
        let message: CdpCommandResponse
        try {
            message = JSON.parse(data) as CdpCommandResponse
        } catch {
            return
        }
        if (typeof message.id !== 'number') {
            return
        }
        const pending = this.pending.get(message.id)
        if (!pending) {
            return
        }
        if (message.error) {
            pending.reject(
                new Error(
                    redactBrowserbaseSensitiveText(
                        message.error.message ?? 'Browser CDP command failed',
                    ),
                ),
            )
            return
        }
        pending.resolve(message.result ?? {})
    }

    private onClose = () => {
        if (this.closed) {
            return
        }
        this.closed = true
        this.rejectPending(new Error('Browser CDP connection closed'))
    }

    private rejectPending(error: Error): void {
        const pending = [...this.pending.values()]
        this.pending.clear()
        for (const entry of pending) {
            clearTimeout(entry.timeout)
            entry.cleanup()
            entry.reject(error)
        }
    }
}

function parseCdpTargetInfo(value: unknown): CdpTargetInfo | null {
    const record = asRecord(value)
    const targetId = typeof record?.targetId === 'string' ? record.targetId : null
    const type = typeof record?.type === 'string' ? record.type : null
    if (!targetId || !type) {
        return null
    }
    return {
        targetId,
        type,
        url: typeof record?.url === 'string' ? record.url : undefined,
    }
}
