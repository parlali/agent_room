import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    BrowserbaseBrowserAutomationManager,
    browserbaseRuntimeShutdownGraceMs,
    browserbaseRuntimeShutdownReleaseRequestTimeoutMs,
    createBrowserAutomationTools,
} from './browserbase-browser'
import { createTestPiRuntimeConfig } from './test-runtime-defaults'
import { withToolRunContext } from './tool-run-context'

const originalFetch = globalThis.fetch
const originalWebSocket = globalThis.WebSocket
const originalBrowserbaseKey = process.env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY

interface FetchCall {
    url: string
    method: string
    body: unknown
    apiKey: string | null
}

interface FakeBrowserState {
    url: string
    title: string
    text: string
    sent: unknown[]
}

function configuredBrowserbaseConfig(input: { browserActionsPerTurn?: number } = {}) {
    return createTestPiRuntimeConfig({
        search: {
            ...createTestPiRuntimeConfig().search,
            browserbase: {
                enabled: true,
                envKey: 'AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY',
                timeoutMs: 10000,
                resultCount: 5,
            },
        },
        budgets: {
            browserActionsPerTurn: input.browserActionsPerTurn ?? 50,
        },
    })
}

function createManager(
    input: {
        events?: Array<{ event: string; payload: unknown }>
        broadcasts?: Array<{ sessionKey: string; event: string; payload: unknown }>
        browserActionsPerTurn?: number
    } = {},
) {
    const events = input.events ?? []
    const broadcasts = input.broadcasts ?? []
    const config = configuredBrowserbaseConfig({
        browserActionsPerTurn: input.browserActionsPerTurn,
    })
    const manager = new BrowserbaseBrowserAutomationManager({
        config,
        audit: async (event, payload) => {
            events.push({ event, payload })
        },
        broadcast: (sessionKey, event, payload) => {
            broadcasts.push({ sessionKey, event, payload })
        },
    })
    return {
        config,
        manager,
        events,
        broadcasts,
    }
}

function installBrowserbaseFakes(
    input: {
        connectUrl?: string
        failWebSocket?: boolean
        liveUrl?: string
        neverOpenWebSocket?: boolean
        navigateResult?: unknown
        onReadyStateCheck?: () => void
        readyStateResults?: boolean[]
        releaseFailures?: number
        releaseStalls?: boolean
        releaseStatus?: number
        sessionCreateStatus?: number
        state?: FakeBrowserState
    } = {},
) {
    const state = input.state ?? {
        url: 'about:blank',
        title: 'Example Page',
        text: 'Visible text from the page',
        sent: [],
    }
    const fetchCalls: FetchCall[] = []
    const readyStateResults = [...(input.readyStateResults ?? [])]
    let sessionCount = 0
    let releaseFailuresRemaining = input.releaseFailures ?? null
    globalThis.fetch = (async (request, init) => {
        const url = String(request)
        const body = init?.body ? JSON.parse(String(init.body)) : null
        fetchCalls.push({
            url,
            method: init?.method ?? 'GET',
            body,
            apiKey: new Headers(init?.headers).get('x-bb-api-key'),
        })
        if (url === 'https://api.browserbase.com/v1/sessions' && init?.method === 'POST') {
            if (input.sessionCreateStatus) {
                return Response.json(
                    {
                        error: 'session create failed',
                    },
                    {
                        status: input.sessionCreateStatus,
                    },
                )
            }
            sessionCount += 1
            const id = `bb-session-${sessionCount}`
            return Response.json(
                {
                    id,
                    connectUrl: input.connectUrl ?? `wss://connect.browserbase.test/${id}-secret`,
                },
                {
                    status: 201,
                },
            )
        }
        if (url.endsWith('/debug')) {
            return Response.json({
                debuggerFullscreenUrl: input.liveUrl ?? 'https://browserbase.test/live/live-secret',
                debuggerUrl: 'https://browserbase.test/debug/debug-secret',
                pages: [
                    {
                        url: state.url,
                        title: state.title,
                        debuggerFullscreenUrl:
                            input.liveUrl ?? 'https://browserbase.test/live/live-secret',
                        debuggerUrl: 'https://browserbase.test/debug/debug-secret',
                    },
                ],
            })
        }
        if (url.includes('/sessions/bb-session-') && init?.method === 'POST') {
            if (input.releaseStalls) {
                return new Promise<Response>((_resolve, reject) => {
                    const fail = () => reject(new Error('aborted'))
                    if (init.signal?.aborted) {
                        fail()
                        return
                    }
                    init.signal?.addEventListener('abort', fail, { once: true })
                })
            }
            if (
                input.releaseStatus &&
                (releaseFailuresRemaining === null || releaseFailuresRemaining > 0)
            ) {
                if (releaseFailuresRemaining !== null) {
                    releaseFailuresRemaining -= 1
                }
                return Response.json(
                    {
                        error: 'release failed',
                    },
                    {
                        status: input.releaseStatus,
                    },
                )
            }
            return Response.json({
                id: url.split('/').at(-1),
                status: 'COMPLETED',
            })
        }
        return new Response('not found', {
            status: 404,
        })
    }) as typeof fetch

    class FakeWebSocket extends EventTarget {
        static instances: FakeWebSocket[] = []
        readyState = 0
        url: string
        browserState: FakeBrowserState

        constructor(url: string) {
            super()
            if (input.failWebSocket) {
                throw new Error(`Cannot connect to ${url}`)
            }
            this.url = url
            this.browserState = {
                url: state.url,
                title: state.title,
                text: state.text,
                sent: state.sent,
            }
            FakeWebSocket.instances.push(this)
            if (!input.neverOpenWebSocket) {
                queueMicrotask(() => {
                    this.readyState = 1
                    this.dispatchEvent(new Event('open'))
                })
            }
        }

        send(raw: string): void {
            const message = JSON.parse(raw) as {
                id: number
                method: string
                params?: Record<string, unknown>
            }
            state.sent.push(message)
            const result = cdpResult(message, this.browserState, {
                navigateResult: input.navigateResult,
                onReadyStateCheck: input.onReadyStateCheck,
                readyStateResults,
            })
            queueMicrotask(() => {
                this.emitMessage(
                    JSON.stringify({
                        id: message.id,
                        result,
                    }),
                )
            })
        }

        close(): void {
            this.readyState = 3
            this.dispatchEvent(new Event('close'))
        }

        private emitMessage(data: string): void {
            const event = new Event('message') as MessageEvent<string>
            Object.defineProperty(event, 'data', {
                value: data,
            })
            this.dispatchEvent(event)
        }
    }

    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    return {
        fetchCalls,
        state,
        FakeWebSocket,
    }
}

function cdpResult(
    message: { method: string; params?: Record<string, unknown> },
    state: FakeBrowserState,
    input: {
        navigateResult?: unknown
        onReadyStateCheck?: () => void
        readyStateResults: boolean[]
    },
): unknown {
    if (message.method === 'Target.getTargets') {
        return {
            targetInfos: [
                {
                    targetId: 'target-1',
                    type: 'page',
                    url: state.url,
                },
            ],
        }
    }
    if (message.method === 'Target.attachToTarget') {
        return {
            sessionId: 'cdp-session-1',
        }
    }
    if (message.method === 'Page.navigate') {
        state.url = String(message.params?.url ?? state.url)
        state.title = 'Example Page'
        return input.navigateResult ?? {}
    }
    if (message.method === 'Runtime.evaluate') {
        const expression = String(message.params?.expression ?? '')
        if (expression.includes('document.readyState')) {
            input.onReadyStateCheck?.()
            return {
                result: {
                    value:
                        input.readyStateResults.length > 0 ? input.readyStateResults.shift() : true,
                },
            }
        }
        if (expression.includes('window.location.href')) {
            return {
                result: {
                    value: {
                        url: state.url,
                        title: state.title,
                    },
                },
            }
        }
        if (
            expression.includes('document.querySelector') &&
            expression.includes('getBoundingClientRect')
        ) {
            return {
                result: {
                    value: {
                        x: 40,
                        y: 50,
                        label: 'Example button',
                    },
                },
            }
        }
        if (expression.includes('document.querySelector') && expression.includes('element.focus')) {
            return {
                result: {
                    value: {
                        label: 'Search',
                    },
                },
            }
        }
        if (expression.includes('innerText') || expression.includes('textContent')) {
            return {
                result: {
                    value: {
                        text: state.text,
                        source: 'body',
                    },
                },
            }
        }
        return {
            result: {
                value: undefined,
            },
        }
    }
    if (message.method === 'Page.captureScreenshot') {
        return {
            data: 'iVBORw0KGgo=',
        }
    }
    return {}
}

function payloadText(payload: unknown): string {
    return JSON.stringify(payload)
}

describe('Browserbase browser automation', () => {
    afterEach(() => {
        vi.useRealTimers()
        globalThis.fetch = originalFetch
        globalThis.WebSocket = originalWebSocket
        if (originalBrowserbaseKey === undefined) {
            delete process.env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY
        } else {
            process.env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY = originalBrowserbaseKey
        }
    })

    it('registers tools only when Browserbase is configured and materialized', () => {
        delete process.env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY
        const unconfigured = createManager()

        expect(
            createBrowserAutomationTools({
                config: unconfigured.config,
                record: { key: 'thread-1' },
                browserAutomation: unconfigured.manager,
            }),
        ).toHaveLength(0)

        process.env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY = 'browserbase-secret'
        const configured = createManager()
        const tools = createBrowserAutomationTools({
            config: configured.config,
            record: { key: 'thread-1' },
            browserAutomation: configured.manager,
        })

        expect(tools.map((tool) => tool.name)).toEqual([
            'agent_room_browser_open',
            'agent_room_browser_close',
            'agent_room_browser_navigate',
            'agent_room_browser_click',
            'agent_room_browser_type',
            'agent_room_browser_scroll',
            'agent_room_browser_screenshot',
            'agent_room_browser_read_text',
        ])
    })

    it('opens a Browserbase session, exposes snapshot live state, and keeps secrets out of audit payloads', async () => {
        process.env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY = 'browserbase-secret'
        const { fetchCalls } = installBrowserbaseFakes()
        const { manager, events, broadcasts } = createManager()

        const result = await withToolRunContext(
            {
                sessionKey: 'thread-1',
                runId: 'run-1',
                signal: new AbortController().signal,
            },
            () =>
                manager.open(
                    {
                        action: 'open',
                        toolCallId: 'call-1',
                        sessionKey: 'thread-1',
                        runId: 'run-1',
                    },
                    {
                        url: 'https://93.184.216.34/start?token=query#hash',
                    },
                ),
        )

        expect(result.details).toMatchObject({
            action: 'open',
            sessionId: 'bb-session-1',
            liveSessionAvailable: true,
        })
        expect(manager.snapshot()).toMatchObject({
            status: 'open',
            sessionId: 'bb-session-1',
            sessionKey: 'thread-1',
            pageUrl: 'https://93.184.216.34/start?token=query#hash',
            liveUrl: 'https://browserbase.test/live/live-secret',
        })
        expect(fetchCalls.map((call) => [call.method, call.url])).toEqual([
            ['POST', 'https://api.browserbase.com/v1/sessions'],
            ['GET', 'https://api.browserbase.com/v1/sessions/bb-session-1/debug'],
        ])
        expect(fetchCalls[0]?.apiKey).toBe('browserbase-secret')
        expect(fetchCalls[0]?.body).toEqual({
            keepAlive: true,
            browserSettings: {
                timeout: 660,
            },
        })
        const audit = events.map((event) => payloadText(event.payload)).join('\n')
        expect(audit).not.toContain('browserbase-secret')
        expect(audit).not.toContain('connect.browserbase.test')
        expect(audit).not.toContain('live-secret')
        expect(audit).toContain('https://93.184.216.34/start?[redacted]#[redacted]')
        expect(broadcasts.some((entry) => entry.event === 'browser.session_changed')).toBe(true)
        expect(payloadText(broadcasts)).not.toContain('live-secret')
    })

    it('fails closed when the per-turn browser action budget is exhausted but still allows close', async () => {
        process.env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY = 'browserbase-secret'
        const { fetchCalls } = installBrowserbaseFakes()
        const { manager, events } = createManager({
            browserActionsPerTurn: 1,
        })
        const context = {
            action: 'open' as const,
            toolCallId: 'call-1',
            sessionKey: 'thread-1',
            runId: 'run-1',
        }
        await manager.open(context, {
            url: 'https://93.184.216.34/start',
        })

        await expect(
            manager.navigate(
                {
                    ...context,
                    action: 'navigate',
                    toolCallId: 'call-2',
                },
                {
                    url: 'https://93.184.216.34/next',
                },
            ),
        ).rejects.toThrow('Browser action budget exhausted')

        const failed = events.find(
            (event) =>
                event.event === 'tool.browser_navigate' &&
                payloadText(event.payload).includes('Browser action budget exceeded'),
        )
        expect(failed).toBeTruthy()

        await expect(
            manager.close({
                ...context,
                action: 'close',
                toolCallId: 'call-3',
            }),
        ).resolves.toBeTruthy()
        expect(fetchCalls.at(-1)).toMatchObject({
            method: 'POST',
            url: 'https://api.browserbase.com/v1/sessions/bb-session-1',
            body: {
                status: 'REQUEST_RELEASE',
            },
        })
    })

    it('executes navigate, click, type, scroll, screenshot, and read text through the active session', async () => {
        process.env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY = 'browserbase-secret'
        const { state } = installBrowserbaseFakes()
        const { manager, events } = createManager()
        const context = {
            action: 'open' as const,
            toolCallId: 'call-1',
            sessionKey: 'thread-1',
            runId: 'run-1',
        }
        await manager.open(context, {
            url: 'https://93.184.216.34/start',
        })

        await manager.navigate(
            {
                ...context,
                action: 'navigate',
                toolCallId: 'call-2',
            },
            {
                url: 'https://93.184.216.34/next',
            },
        )
        await manager.click(
            {
                ...context,
                action: 'click',
                toolCallId: 'call-3',
            },
            {
                selector: '#submit',
            },
        )
        await manager.type(
            {
                ...context,
                action: 'type',
                toolCallId: 'call-4',
            },
            {
                selector: 'input[name="q"]',
                text: 'browser test',
                clear: true,
            },
        )
        await manager.scroll(
            {
                ...context,
                action: 'scroll',
                toolCallId: 'call-5',
            },
            {
                direction: 'down',
                amount: 400,
            },
        )
        const screenshot = await manager.screenshot({
            ...context,
            action: 'screenshot',
            toolCallId: 'call-6',
        })
        const text = await manager.readText(
            {
                ...context,
                action: 'read_text',
                toolCallId: 'call-7',
            },
            {},
        )

        const methods = state.sent.map((entry) => (entry as { method: string }).method)
        expect(methods).toContain('Page.navigate')
        expect(methods).toContain('Input.dispatchMouseEvent')
        expect(methods).toContain('Input.insertText')
        expect(methods).toContain('Page.captureScreenshot')
        expect(screenshot.content.some((entry) => entry.type === 'image')).toBe(true)
        expect(text.content[0]?.type === 'text' ? text.content[0].text : '').toContain(
            'Visible text from the page',
        )
        for (const action of ['navigate', 'click', 'type', 'scroll', 'screenshot', 'read_text']) {
            expect(
                events.some(
                    (event) =>
                        event.event === `tool.browser_${action}` &&
                        payloadText(event.payload).includes('"status":"complete"'),
                ),
            ).toBe(true)
        }
    })

    it('replaces the existing room Browserbase session when a new chat session opens', async () => {
        process.env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY = 'browserbase-secret'
        const { fetchCalls } = installBrowserbaseFakes()
        const { manager } = createManager()
        const firstSession = {
            action: 'open' as const,
            toolCallId: 'call-1',
            sessionKey: 'thread-1',
            runId: 'run-1',
        }
        const secondSession = {
            action: 'navigate' as const,
            toolCallId: 'call-2',
            sessionKey: 'thread-2',
            runId: 'run-2',
        }
        await manager.open(firstSession, {
            url: 'https://93.184.216.34/first',
        })

        await manager.open(
            {
                ...secondSession,
                action: 'open',
                toolCallId: 'call-3',
            },
            {
                url: 'https://93.184.216.34/second',
            },
        )
        expect(manager.snapshot('thread-1')).toMatchObject({
            status: 'closed',
            sessionId: 'bb-session-1',
            sessionKey: 'thread-1',
            liveUrl: null,
        })
        expect(manager.snapshot('thread-2')).toMatchObject({
            status: 'open',
            sessionId: 'bb-session-2',
            sessionKey: 'thread-2',
        })
        expect(
            fetchCalls.some(
                (call) =>
                    call.method === 'POST' &&
                    call.url === 'https://api.browserbase.com/v1/sessions/bb-session-1' &&
                    payloadText(call.body).includes('"status":"REQUEST_RELEASE"'),
            ),
        ).toBe(true)

        await manager.close({
            ...secondSession,
            action: 'close',
            toolCallId: 'call-6',
        })
        expect(manager.snapshot('thread-1')).toMatchObject({
            status: 'closed',
            sessionId: 'bb-session-1',
        })
        expect(manager.snapshot('thread-2')).toMatchObject({
            status: 'closed',
            sessionId: 'bb-session-2',
        })
    })

    it('audits invalid input failures after budget consumption without exposing raw invalid values', async () => {
        process.env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY = 'browserbase-secret'
        installBrowserbaseFakes()
        const { manager, events } = createManager()

        await expect(
            manager.navigate(
                {
                    action: 'navigate',
                    toolCallId: 'call-1',
                    sessionKey: 'thread-1',
                    runId: 'run-1',
                },
                {
                    url: 'not a url with token',
                },
            ),
        ).rejects.toThrow('Browser URL must be an absolute http or https URL')

        const failed = events.find(
            (event) =>
                event.event === 'tool.browser_navigate' &&
                payloadText(event.payload).includes('"status":"failed"'),
        )
        expect(failed).toBeTruthy()
        expect(payloadText(failed?.payload)).toContain(
            'Browser URL must be an absolute http or https URL',
        )
        expect(payloadText(failed?.payload)).not.toContain('not a url with token')
        expect(payloadText(failed?.payload)).toContain('"used":1')
    })

    it.each([
        [401, 'Browserbase authentication failed'],
        [429, 'Browserbase session limit or rate limit was reached'],
    ])('fails closed and audits Browserbase create status %s', async (status, message) => {
        process.env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY = 'browserbase-secret'
        installBrowserbaseFakes({
            sessionCreateStatus: status,
        })
        const { manager, events } = createManager()

        await expect(
            manager.open(
                {
                    action: 'open',
                    toolCallId: 'call-1',
                    sessionKey: 'thread-1',
                    runId: 'run-1',
                },
                {
                    url: 'https://93.184.216.34/start',
                },
            ),
        ).rejects.toThrow(message)

        expect(payloadText(events)).toContain(message)
        expect(payloadText(events)).not.toContain('browserbase-secret')
    })

    it('fails closed and releases the created session when navigation fails', async () => {
        process.env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY = 'browserbase-secret'
        const { fetchCalls } = installBrowserbaseFakes({
            navigateResult: {
                errorText: 'net::ERR_NAME_NOT_RESOLVED',
            },
        })
        const { manager, events } = createManager()

        await expect(
            manager.open(
                {
                    action: 'open',
                    toolCallId: 'call-1',
                    sessionKey: 'thread-1',
                    runId: 'run-1',
                },
                {
                    url: 'https://93.184.216.34/start',
                },
            ),
        ).rejects.toThrow('Browser navigation failed for https://93.184.216.34/start')

        expect(fetchCalls.at(-1)).toMatchObject({
            method: 'POST',
            url: 'https://api.browserbase.com/v1/sessions/bb-session-1',
            body: {
                status: 'REQUEST_RELEASE',
            },
        })
        expect(manager.snapshot()).toMatchObject({
            status: 'error',
            sessionId: null,
        })
        expect(payloadText(events)).toContain('net::ERR_NAME_NOT_RESOLVED')
    })

    it('fails closed and releases the created session when readiness polling times out', async () => {
        const originalDateNow = Date.now
        let fakeNow = new Date('2026-05-16T00:00:00.000Z').getTime()
        Date.now = () => fakeNow
        process.env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY = 'browserbase-secret'
        const { fetchCalls } = installBrowserbaseFakes({
            onReadyStateCheck: () => {
                fakeNow += 10001
            },
            readyStateResults: [false],
        })
        const { manager } = createManager()

        try {
            await expect(
                manager.open(
                    {
                        action: 'open',
                        toolCallId: 'call-1',
                        sessionKey: 'thread-1',
                        runId: 'run-1',
                    },
                    {
                        url: 'https://93.184.216.34/start',
                    },
                ),
            ).rejects.toThrow('Browser page did not become ready before timeout')

            expect(fetchCalls.at(-1)).toMatchObject({
                method: 'POST',
                url: 'https://api.browserbase.com/v1/sessions/bb-session-1',
                body: {
                    status: 'REQUEST_RELEASE',
                },
            })
            expect(manager.snapshot()).toMatchObject({
                status: 'error',
                sessionId: null,
                message: 'Browser page did not become ready before timeout',
            })
        } finally {
            Date.now = originalDateNow
        }
    })

    it('fails closed and releases the created session when navigation starts a download', async () => {
        process.env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY = 'browserbase-secret'
        const { fetchCalls } = installBrowserbaseFakes({
            navigateResult: {
                isDownload: true,
            },
        })
        const { manager } = createManager()

        await expect(
            manager.open(
                {
                    action: 'open',
                    toolCallId: 'call-1',
                    sessionKey: 'thread-1',
                    runId: 'run-1',
                },
                {
                    url: 'https://93.184.216.34/start',
                },
            ),
        ).rejects.toThrow(
            'Browser navigation started a download instead of loading https://93.184.216.34/start',
        )

        expect(fetchCalls.at(-1)).toMatchObject({
            method: 'POST',
            url: 'https://api.browserbase.com/v1/sessions/bb-session-1',
            body: {
                status: 'REQUEST_RELEASE',
            },
        })
    })

    it('redacts Browserbase connection URLs from connect failures, audit payloads, and snapshots', async () => {
        process.env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY = 'browserbase-secret'
        installBrowserbaseFakes({
            connectUrl: 'wss://connect.browserbase.test/session-secret?token=secret-token',
            failWebSocket: true,
        })
        const { manager, events, broadcasts } = createManager()

        await expect(
            manager.open(
                {
                    action: 'open',
                    toolCallId: 'call-1',
                    sessionKey: 'thread-1',
                    runId: 'run-1',
                },
                {
                    url: 'https://93.184.216.34/start',
                },
            ),
        ).rejects.toThrow('Browser CDP connection failed')

        const serialized = payloadText({
            events,
            broadcasts,
            snapshot: manager.snapshot(),
        })
        expect(serialized).not.toContain('connect.browserbase.test')
        expect(serialized).not.toContain('session-secret')
        expect(serialized).not.toContain('secret-token')
        expect(manager.snapshot()).toMatchObject({
            status: 'error',
            message: 'Browser CDP connection failed',
        })
    })

    it('times out a stalled Browserbase WebSocket handshake and releases the created session', async () => {
        vi.useFakeTimers()
        process.env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY = 'browserbase-secret'
        const { fetchCalls } = installBrowserbaseFakes({
            connectUrl: 'wss://connect.browserbase.test/session-secret?token=secret-token',
            neverOpenWebSocket: true,
        })
        const { manager, events } = createManager()

        const opened = manager.open(
            {
                action: 'open',
                toolCallId: 'call-1',
                sessionKey: 'thread-1',
                runId: 'run-1',
            },
            {
                url: 'https://93.184.216.34/start',
            },
        )
        const openedExpectation = expect(opened).rejects.toThrow('Browser CDP connection timed out')
        await vi.advanceTimersByTimeAsync(0)
        await vi.advanceTimersByTimeAsync(15000)

        await openedExpectation
        expect(fetchCalls.at(-1)).toMatchObject({
            method: 'POST',
            url: 'https://api.browserbase.com/v1/sessions/bb-session-1',
            body: {
                status: 'REQUEST_RELEASE',
            },
        })
        const serialized = payloadText({
            events,
            snapshot: manager.snapshot(),
        })
        expect(serialized).not.toContain('connect.browserbase.test')
        expect(serialized).not.toContain('session-secret')
        expect(serialized).toContain('Browser CDP connection timed out')
    })

    it('retries release for a created session after open fails before it becomes active', async () => {
        vi.useFakeTimers()
        process.env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY = 'browserbase-secret'
        const { fetchCalls } = installBrowserbaseFakes({
            neverOpenWebSocket: true,
            releaseStatus: 500,
            releaseFailures: 1,
        })
        const { manager, events } = createManager()

        const opened = manager.open(
            {
                action: 'open',
                toolCallId: 'call-1',
                sessionKey: 'thread-1',
                runId: 'run-1',
            },
            {
                url: 'https://93.184.216.34/start',
            },
        )
        const openedExpectation = expect(opened).rejects.toThrow('Browser CDP connection timed out')
        await vi.advanceTimersByTimeAsync(0)
        await vi.advanceTimersByTimeAsync(15000)
        await openedExpectation

        expect(
            fetchCalls.filter(
                (call) =>
                    call.method === 'POST' &&
                    call.url === 'https://api.browserbase.com/v1/sessions/bb-session-1',
            ),
        ).toHaveLength(2)
        const releaseAudit = events
            .filter((event) => event.event === 'browser.session_release')
            .map((event) => payloadText(event.payload))
            .join('\n')
        expect(releaseAudit).toContain('"reason":"open_failed"')
        expect(releaseAudit).toContain('"attempt":1')
        expect(releaseAudit).toContain('"attempt":2')
        expect(releaseAudit).toContain('"status":"failed"')
        expect(releaseAudit).toContain('"status":"complete"')
    })

    it('audits replacement, idle, and shutdown release paths', async () => {
        process.env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY = 'browserbase-secret'
        installBrowserbaseFakes()
        const { manager, events } = createManager()
        const context = {
            action: 'open' as const,
            toolCallId: 'call-1',
            sessionKey: 'thread-1',
            runId: 'run-1',
        }
        await manager.open(context, {
            url: 'https://93.184.216.34/one',
        })
        await manager.open(
            {
                ...context,
                toolCallId: 'call-2',
            },
            {
                url: 'https://93.184.216.34/two',
            },
        )
        await manager.closeAll('runtime_shutdown')
        await manager.open(
            {
                ...context,
                toolCallId: 'call-3',
                runId: 'run-2',
            },
            {
                url: 'https://93.184.216.34/three',
            },
        )
        await manager.closeAll('idle_timeout')

        const releaseAudit = events
            .filter((event) => event.event === 'browser.session_release')
            .map((event) => payloadText(event.payload))
            .join('\n')
        expect(releaseAudit).toContain('"reason":"replaced"')
        expect(releaseAudit).toContain('"reason":"runtime_shutdown"')
        expect(releaseAudit).toContain('"reason":"idle_timeout"')
        expect(releaseAudit).toContain('"status":"complete"')
    })

    it('retries automatic release after a transient Browserbase release failure', async () => {
        vi.useFakeTimers()
        process.env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY = 'browserbase-secret'
        const { fetchCalls } = installBrowserbaseFakes({
            releaseStatus: 500,
            releaseFailures: 1,
        })
        const { manager, events } = createManager()
        const context = {
            action: 'open' as const,
            toolCallId: 'call-1',
            sessionKey: 'thread-1',
            runId: 'run-1',
        }
        await manager.open(context, {
            url: 'https://93.184.216.34/start',
        })

        await manager.closeAll('idle_timeout')

        expect(manager.snapshot()).toMatchObject({
            status: 'error',
            sessionId: 'bb-session-1',
        })
        expect(payloadText(events)).toContain('"reason":"idle_timeout"')
        expect(payloadText(events)).toContain('"status":"failed"')
        await vi.advanceTimersByTimeAsync(30000)

        expect(manager.snapshot()).toMatchObject({
            status: 'closed',
            sessionId: 'bb-session-1',
        })
        expect(
            fetchCalls.filter(
                (call) =>
                    call.method === 'POST' &&
                    call.url === 'https://api.browserbase.com/v1/sessions/bb-session-1',
            ),
        ).toHaveLength(2)
        const releaseAudit = events
            .filter((event) => event.event === 'browser.session_release')
            .map((event) => payloadText(event.payload))
            .join('\n')
        expect(releaseAudit).toContain('"attempt":1')
        expect(releaseAudit).toContain('"attempt":2')
        expect(releaseAudit).toContain('"status":"complete"')
    })

    it('retries runtime shutdown release immediately before closeAll resolves', async () => {
        process.env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY = 'browserbase-secret'
        const { fetchCalls } = installBrowserbaseFakes({
            releaseStatus: 500,
            releaseFailures: 1,
        })
        const { manager, events } = createManager()
        const context = {
            action: 'open' as const,
            toolCallId: 'call-1',
            sessionKey: 'thread-1',
            runId: 'run-1',
        }
        await manager.open(context, {
            url: 'https://93.184.216.34/start',
        })

        await manager.closeAll('runtime_shutdown')

        expect(manager.snapshot()).toMatchObject({
            status: 'closed',
            sessionId: 'bb-session-1',
        })
        expect(
            fetchCalls.filter(
                (call) =>
                    call.method === 'POST' &&
                    call.url === 'https://api.browserbase.com/v1/sessions/bb-session-1',
            ),
        ).toHaveLength(2)
        const releaseAudit = events
            .filter((event) => event.event === 'browser.session_release')
            .map((event) => payloadText(event.payload))
            .join('\n')
        expect(releaseAudit).toContain('"reason":"runtime_shutdown"')
        expect(releaseAudit).toContain('"attempt":1')
        expect(releaseAudit).toContain('"attempt":2')
        expect(releaseAudit).toContain('"status":"complete"')
    })

    it('bounds stalled runtime shutdown release attempts for the active session', async () => {
        process.env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY = 'browserbase-secret'
        const { fetchCalls } = installBrowserbaseFakes({
            releaseStalls: true,
        })
        const { manager, events } = createManager()
        await manager.open(
            {
                action: 'open',
                toolCallId: 'call-1',
                sessionKey: 'thread-1',
                runId: 'run-1',
            },
            {
                url: 'https://93.184.216.34/first',
            },
        )

        vi.useFakeTimers()
        const closed = manager.closeAll('runtime_shutdown')
        await vi.advanceTimersByTimeAsync(0)
        for (let attempt = 0; attempt < 3; attempt += 1) {
            await vi.advanceTimersByTimeAsync(browserbaseRuntimeShutdownReleaseRequestTimeoutMs)
        }
        await closed

        const releaseCalls = fetchCalls.filter(
            (call) => call.method === 'POST' && call.url.includes('/sessions/bb-session-'),
        )
        expect(releaseCalls).toHaveLength(3)
        expect(manager.snapshot('thread-1')).toMatchObject({
            status: 'error',
            sessionId: 'bb-session-1',
            message: 'Browserbase request timed out',
        })
        expect(browserbaseRuntimeShutdownGraceMs).toBeGreaterThan(
            browserbaseRuntimeShutdownReleaseRequestTimeoutMs * 3,
        )
        const releaseAudit = events
            .filter((event) => event.event === 'browser.session_release')
            .map((event) => payloadText(event.payload))
            .join('\n')
        expect(releaseAudit).toContain('"reason":"runtime_shutdown"')
        expect(releaseAudit).toContain('Browserbase release retry limit reached')
    })

    it('closes the active Browserbase session through REQUEST_RELEASE', async () => {
        process.env.AGENT_ROOM_SEARCH_BROWSERBASE_API_KEY = 'browserbase-secret'
        const { fetchCalls, FakeWebSocket } = installBrowserbaseFakes()
        const { manager } = createManager()
        const context = {
            action: 'open' as const,
            toolCallId: 'call-1',
            sessionKey: 'thread-1',
            runId: 'run-1',
        }
        await manager.open(context, {
            url: 'https://93.184.216.34/start',
        })

        await manager.close({
            ...context,
            action: 'close',
            toolCallId: 'call-2',
        })

        expect(fetchCalls.at(-1)).toMatchObject({
            method: 'POST',
            url: 'https://api.browserbase.com/v1/sessions/bb-session-1',
            body: {
                status: 'REQUEST_RELEASE',
            },
        })
        expect(manager.snapshot()).toMatchObject({
            status: 'closed',
            sessionId: 'bb-session-1',
            liveUrl: null,
        })
        expect(FakeWebSocket.instances[0]?.readyState).toBe(3)
    })
})
