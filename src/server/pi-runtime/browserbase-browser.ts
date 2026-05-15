import {
    defineTool,
    type AgentToolResult,
    type ToolDefinition,
} from '@mariozechner/pi-coding-agent'
import { Type } from '@mariozechner/pi-ai'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import type {
    RoomBrowserActionBudgetSnapshot,
    RoomBrowserSessionSnapshot,
} from '../rooms/execution-types'
import { combineAbortSignals, currentToolRunContext } from './tool-run-context'
import { assertSafeUrl, sanitizeUrlForAudit } from './web-url-safety'

const browserbaseApiBaseUrl = 'https://api.browserbase.com/v1'
const defaultBrowserActionBudget = 50
const maxBrowserActionBudget = 200
const maxToolTextChars = 12000
const maxAuditTextChars = 4000
const pageReadyWaitMs = 10000
const pageReadyPollMs = 250
const cdpCommandTimeoutMs = 15000
const cdpHeartbeatMs = 5 * 60 * 1000

type BrowserToolAction =
    | 'open'
    | 'close'
    | 'navigate'
    | 'click'
    | 'type'
    | 'scroll'
    | 'screenshot'
    | 'read_text'

interface BrowserAutomationManagerInput {
    config: PiRuntimeConfig
    audit: (event: string, payload: unknown) => Promise<void>
    broadcast: (sessionKey: string, event: string, payload: unknown) => void
    now?: () => number
}

interface BrowserAutomationToolContext {
    action: BrowserToolAction
    toolCallId: string
    sessionKey: string
    runId: string
    signal?: AbortSignal
}

interface BrowserActionBudgetState {
    used: number
    max: number
    updatedAt: number
}

interface ActiveBrowserSession {
    browserbaseSessionId: string
    cdp: BrowserCdpConnection
    pageSessionId: string
    sessionKey: string
    openedAt: number
}

interface BrowserToolDetails {
    action: BrowserToolAction
    status: RoomBrowserSessionSnapshot['status'] | 'complete'
    sessionId: string | null
    pageUrl: string | null
    pageTitle: string | null
    actionBudget: RoomBrowserActionBudgetSnapshot | null
    liveSessionAvailable: boolean
    textLength?: number
    truncated?: boolean
    imageBytes?: number
}

interface BrowserbaseSessionResponse {
    id: string
    connectUrl: string
}

interface BrowserbaseDebugResponse {
    debuggerFullscreenUrl: string | null
    debuggerUrl: string | null
    pages: BrowserbaseDebugPage[]
}

interface BrowserbaseDebugPage {
    url: string | null
    title: string | null
    debuggerFullscreenUrl: string | null
    debuggerUrl: string | null
}

interface PageMetadata {
    url: string | null
    title: string | null
}

interface ClickTarget {
    x: number
    y: number
    label: string | null
}

interface TypeTarget {
    label: string | null
}

interface TextReadResult {
    text: string
    source: string | null
}

interface ScreenshotResult {
    data: string
    bytes: number
}

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

export class BrowserbaseBrowserAutomationManager {
    private config: PiRuntimeConfig
    private audit: BrowserAutomationManagerInput['audit']
    private broadcast: BrowserAutomationManagerInput['broadcast']
    private now: () => number
    private active: ActiveBrowserSession | null = null
    private snapshotValue: RoomBrowserSessionSnapshot | null = null
    private runBudgets = new Map<string, BrowserActionBudgetState>()
    private idleCloseTimer: ReturnType<typeof setTimeout> | null = null
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null
    private queue = Promise.resolve()

    constructor(input: BrowserAutomationManagerInput) {
        this.config = input.config
        this.audit = input.audit
        this.broadcast = input.broadcast
        this.now = input.now ?? Date.now
    }

    isConfigured(): boolean {
        const envKey = this.config.search.browserbase.envKey
        return this.config.search.browserbase.enabled && Boolean(envKey && process.env[envKey])
    }

    snapshot(): RoomBrowserSessionSnapshot | null {
        return this.snapshotValue
    }

    async open(
        context: BrowserAutomationToolContext,
        input: { url: string },
    ): Promise<AgentToolResult<BrowserToolDetails>> {
        return this.enqueue(async () => {
            const actionBudget = await this.consumeActionBudget(context)
            const requestedUrl = await normalizeBrowserUrl(input.url)
            await this.auditAction(context, 'started', {
                requestedUrl: sanitizeUrlForAudit(requestedUrl),
                actionBudget,
            })
            let createdSession: BrowserbaseSessionResponse | null = null
            let createdCdp: BrowserCdpConnection | null = null

            try {
                await this.releaseActiveSession({
                    reason: 'replaced',
                    context,
                    failOnProviderError: true,
                })
                this.setSnapshot({
                    status: 'opening',
                    sessionId: null,
                    sessionKey: context.sessionKey,
                    pageUrl: null,
                    pageTitle: null,
                    liveUrl: null,
                    openedAt: this.now(),
                    updatedAt: this.now(),
                    actionBudget,
                    message: 'Opening Browserbase session',
                })
                const apiKey = this.apiKey()
                const session = await createBrowserbaseSession({
                    apiKey,
                    timeoutSeconds: browserbaseTimeoutSeconds(this.config),
                    signal: context.signal,
                })
                createdSession = session
                const cdp = await BrowserCdpConnection.connect({
                    url: session.connectUrl,
                    signal: context.signal,
                    commandTimeoutMs: cdpCommandTimeoutMs,
                })
                createdCdp = cdp
                const pageSessionId = await cdp.attachToPage(context.signal)
                const active: ActiveBrowserSession = {
                    browserbaseSessionId: session.id,
                    cdp,
                    pageSessionId,
                    sessionKey: context.sessionKey,
                    openedAt: this.now(),
                }
                this.active = active
                await navigateActivePage(active, requestedUrl, context.signal)
                const metadata = await readPageMetadata(active, context.signal)
                const debug = await getBrowserbaseDebugUrls({
                    apiKey,
                    sessionId: session.id,
                    signal: context.signal,
                })
                this.setSnapshot({
                    status: 'open',
                    sessionId: session.id,
                    sessionKey: context.sessionKey,
                    pageUrl: metadata.url,
                    pageTitle: metadata.title,
                    liveUrl: bestLiveUrl(debug),
                    openedAt: active.openedAt,
                    updatedAt: this.now(),
                    actionBudget,
                    message: null,
                })
                this.scheduleIdleClose()
                this.scheduleHeartbeat()
                await this.auditAction(context, 'complete', {
                    sessionId: session.id,
                    requestedUrl: sanitizeUrlForAudit(requestedUrl),
                    pageUrl: metadata.url ? sanitizeUrlForAudit(metadata.url) : null,
                    pageTitle: metadata.title,
                    actionBudget,
                })
                return textBrowserResult(
                    [
                        'Browserbase session opened',
                        metadata.url ? `URL: ${sanitizeUrlForAudit(metadata.url)}` : null,
                        metadata.title ? `Title: ${metadata.title}` : null,
                        `Action budget: ${actionBudget.used}/${actionBudget.max}`,
                    ],
                    this.details('open', actionBudget),
                )
            } catch (error) {
                if (createdSession && this.active?.browserbaseSessionId !== createdSession.id) {
                    createdCdp?.close()
                    await releaseBrowserbaseSession({
                        apiKey: this.apiKey(),
                        sessionId: createdSession.id,
                    }).catch(() => undefined)
                } else if (createdSession) {
                    await this.releaseActiveSession({
                        reason: 'open_failed',
                        context,
                        actionBudget,
                        failOnProviderError: false,
                    })
                }
                const message = browserErrorMessage(error)
                this.setSnapshot({
                    status: 'error',
                    sessionId: null,
                    sessionKey: context.sessionKey,
                    pageUrl: null,
                    pageTitle: null,
                    liveUrl: null,
                    openedAt: this.snapshotValue?.openedAt ?? this.now(),
                    updatedAt: this.now(),
                    actionBudget,
                    message,
                })
                await this.auditAction(context, 'failed', {
                    requestedUrl: sanitizeUrlForAudit(requestedUrl),
                    error: message,
                    actionBudget,
                })
                throw error
            }
        })
    }

    async close(
        context: BrowserAutomationToolContext,
    ): Promise<AgentToolResult<BrowserToolDetails>> {
        return this.enqueue(async () => {
            const actionBudget = await this.consumeActionBudget(context)
            await this.auditAction(context, 'started', {
                actionBudget,
            })
            try {
                const released = await this.releaseActiveSession({
                    reason: 'tool_close',
                    context,
                    actionBudget,
                    failOnProviderError: true,
                })
                await this.auditAction(context, 'complete', {
                    sessionId: released,
                    actionBudget,
                })
                return textBrowserResult(
                    [
                        released
                            ? 'Browserbase session closed'
                            : 'No active Browserbase session was open',
                        `Action budget: ${actionBudget.used}/${actionBudget.max}`,
                    ],
                    this.details('close', actionBudget),
                )
            } catch (error) {
                await this.auditAction(context, 'failed', {
                    error: browserErrorMessage(error),
                    actionBudget,
                })
                throw error
            }
        })
    }

    async navigate(
        context: BrowserAutomationToolContext,
        input: { url: string },
    ): Promise<AgentToolResult<BrowserToolDetails>> {
        return this.enqueue(async () => {
            const actionBudget = await this.consumeActionBudget(context)
            const url = await normalizeBrowserUrl(input.url)
            await this.auditAction(context, 'started', {
                requestedUrl: sanitizeUrlForAudit(url),
                actionBudget,
            })
            try {
                const active = this.requireActiveSession()
                await navigateActivePage(active, url, context.signal)
                const metadata = await this.refreshMetadata(context.signal, actionBudget)
                await this.auditAction(context, 'complete', {
                    sessionId: active.browserbaseSessionId,
                    requestedUrl: sanitizeUrlForAudit(url),
                    pageUrl: metadata.url ? sanitizeUrlForAudit(metadata.url) : null,
                    pageTitle: metadata.title,
                    actionBudget,
                })
                return textBrowserResult(
                    [
                        'Browser page navigated',
                        metadata.url ? `URL: ${sanitizeUrlForAudit(metadata.url)}` : null,
                        metadata.title ? `Title: ${metadata.title}` : null,
                        `Action budget: ${actionBudget.used}/${actionBudget.max}`,
                    ],
                    this.details('navigate', actionBudget),
                )
            } catch (error) {
                await this.auditAction(context, 'failed', {
                    requestedUrl: sanitizeUrlForAudit(url),
                    error: browserErrorMessage(error),
                    actionBudget,
                })
                throw error
            }
        })
    }

    async click(
        context: BrowserAutomationToolContext,
        input: { selector: string },
    ): Promise<AgentToolResult<BrowserToolDetails>> {
        return this.enqueue(async () => {
            const actionBudget = await this.consumeActionBudget(context)
            const selector = normalizeSelector(input.selector)
            await this.auditAction(context, 'started', {
                selector,
                actionBudget,
            })
            try {
                const active = this.requireActiveSession()
                const target = await clickActivePage(active, selector, context.signal)
                const metadata = await this.refreshMetadata(context.signal, actionBudget)
                await this.auditAction(context, 'complete', {
                    sessionId: active.browserbaseSessionId,
                    selector,
                    targetLabel: target.label,
                    pageUrl: metadata.url ? sanitizeUrlForAudit(metadata.url) : null,
                    pageTitle: metadata.title,
                    actionBudget,
                })
                return textBrowserResult(
                    [
                        'Browser click completed',
                        `Selector: ${selector}`,
                        target.label ? `Element: ${target.label}` : null,
                        metadata.url ? `URL: ${sanitizeUrlForAudit(metadata.url)}` : null,
                        `Action budget: ${actionBudget.used}/${actionBudget.max}`,
                    ],
                    this.details('click', actionBudget),
                )
            } catch (error) {
                await this.auditAction(context, 'failed', {
                    selector,
                    error: browserErrorMessage(error),
                    actionBudget,
                })
                throw error
            }
        })
    }

    async type(
        context: BrowserAutomationToolContext,
        input: { selector: string; text: string; clear?: boolean },
    ): Promise<AgentToolResult<BrowserToolDetails>> {
        return this.enqueue(async () => {
            const actionBudget = await this.consumeActionBudget(context)
            const selector = normalizeSelector(input.selector)
            const text = normalizeTypeText(input.text)
            const clear = input.clear === true
            await this.auditAction(context, 'started', {
                selector,
                textLength: text.length,
                clear,
                actionBudget,
            })
            try {
                const active = this.requireActiveSession()
                const target = await typeInActivePage(active, {
                    selector,
                    text,
                    clear,
                    signal: context.signal,
                })
                const metadata = await this.refreshMetadata(context.signal, actionBudget)
                await this.auditAction(context, 'complete', {
                    sessionId: active.browserbaseSessionId,
                    selector,
                    textLength: text.length,
                    clear,
                    targetLabel: target.label,
                    pageUrl: metadata.url ? sanitizeUrlForAudit(metadata.url) : null,
                    pageTitle: metadata.title,
                    actionBudget,
                })
                return textBrowserResult(
                    [
                        'Browser text input completed',
                        `Selector: ${selector}`,
                        `Text length: ${text.length}`,
                        target.label ? `Element: ${target.label}` : null,
                        `Action budget: ${actionBudget.used}/${actionBudget.max}`,
                    ],
                    this.details('type', actionBudget, {
                        textLength: text.length,
                    }),
                )
            } catch (error) {
                await this.auditAction(context, 'failed', {
                    selector,
                    textLength: text.length,
                    clear,
                    error: browserErrorMessage(error),
                    actionBudget,
                })
                throw error
            }
        })
    }

    async scroll(
        context: BrowserAutomationToolContext,
        input: { direction: string; amount?: number },
    ): Promise<AgentToolResult<BrowserToolDetails>> {
        return this.enqueue(async () => {
            const actionBudget = await this.consumeActionBudget(context)
            const direction = normalizeScrollDirection(input.direction)
            const amount = normalizeScrollAmount(input.amount)
            await this.auditAction(context, 'started', {
                direction,
                amount,
                actionBudget,
            })
            try {
                const active = this.requireActiveSession()
                await scrollActivePage(active, {
                    direction,
                    amount,
                    signal: context.signal,
                })
                const metadata = await this.refreshMetadata(context.signal, actionBudget)
                await this.auditAction(context, 'complete', {
                    sessionId: active.browserbaseSessionId,
                    direction,
                    amount,
                    pageUrl: metadata.url ? sanitizeUrlForAudit(metadata.url) : null,
                    pageTitle: metadata.title,
                    actionBudget,
                })
                return textBrowserResult(
                    [
                        'Browser scroll completed',
                        `Direction: ${direction}`,
                        `Amount: ${amount}`,
                        `Action budget: ${actionBudget.used}/${actionBudget.max}`,
                    ],
                    this.details('scroll', actionBudget),
                )
            } catch (error) {
                await this.auditAction(context, 'failed', {
                    direction,
                    amount,
                    error: browserErrorMessage(error),
                    actionBudget,
                })
                throw error
            }
        })
    }

    async screenshot(
        context: BrowserAutomationToolContext,
    ): Promise<AgentToolResult<BrowserToolDetails>> {
        return this.enqueue(async () => {
            const actionBudget = await this.consumeActionBudget(context)
            await this.auditAction(context, 'started', {
                actionBudget,
            })
            try {
                const active = this.requireActiveSession()
                const screenshot = await screenshotActivePage(active, context.signal)
                const metadata = await this.refreshMetadata(context.signal, actionBudget)
                await this.auditAction(context, 'complete', {
                    sessionId: active.browserbaseSessionId,
                    pageUrl: metadata.url ? sanitizeUrlForAudit(metadata.url) : null,
                    pageTitle: metadata.title,
                    imageBytes: screenshot.bytes,
                    actionBudget,
                })
                return imageBrowserResult(
                    [
                        'Browser screenshot captured',
                        metadata.url ? `URL: ${sanitizeUrlForAudit(metadata.url)}` : null,
                        metadata.title ? `Title: ${metadata.title}` : null,
                        `Image bytes: ${screenshot.bytes}`,
                        `Action budget: ${actionBudget.used}/${actionBudget.max}`,
                    ],
                    screenshot.data,
                    this.details('screenshot', actionBudget, {
                        imageBytes: screenshot.bytes,
                    }),
                )
            } catch (error) {
                await this.auditAction(context, 'failed', {
                    error: browserErrorMessage(error),
                    actionBudget,
                })
                throw error
            }
        })
    }

    async readText(
        context: BrowserAutomationToolContext,
        input: { selector?: string },
    ): Promise<AgentToolResult<BrowserToolDetails>> {
        return this.enqueue(async () => {
            const actionBudget = await this.consumeActionBudget(context)
            const selector = optionalSelector(input.selector)
            await this.auditAction(context, 'started', {
                selector,
                actionBudget,
            })
            try {
                const active = this.requireActiveSession()
                const result = await readTextFromActivePage(active, selector, context.signal)
                const metadata = await this.refreshMetadata(context.signal, actionBudget)
                const bounded = boundText(result.text, maxToolTextChars)
                const auditText = boundText(result.text, maxAuditTextChars)
                await this.auditAction(context, 'complete', {
                    sessionId: active.browserbaseSessionId,
                    selector,
                    source: result.source,
                    pageUrl: metadata.url ? sanitizeUrlForAudit(metadata.url) : null,
                    pageTitle: metadata.title,
                    textLength: result.text.length,
                    truncated: bounded.truncated,
                    text: auditText.text,
                    actionBudget,
                })
                return textBrowserResult(
                    [
                        metadata.url ? `URL: ${sanitizeUrlForAudit(metadata.url)}` : null,
                        metadata.title ? `Title: ${metadata.title}` : null,
                        result.source ? `Source: ${result.source}` : null,
                        `Text length: ${result.text.length}`,
                        `Truncated: ${bounded.truncated}`,
                        '',
                        bounded.text,
                    ],
                    this.details('read_text', actionBudget, {
                        textLength: result.text.length,
                        truncated: bounded.truncated,
                    }),
                )
            } catch (error) {
                await this.auditAction(context, 'failed', {
                    selector,
                    error: browserErrorMessage(error),
                    actionBudget,
                })
                throw error
            }
        })
    }

    async closeAll(reason = 'runtime_shutdown'): Promise<void> {
        await this.enqueue(async () => {
            await this.releaseActiveSession({
                reason,
                failOnProviderError: false,
            })
        })
    }

    private async enqueue<T>(work: () => Promise<T>): Promise<T> {
        const run = this.queue.then(work, work)
        this.queue = run.then(
            () => undefined,
            () => undefined,
        )
        return run
    }

    private apiKey(): string {
        const envKey = this.config.search.browserbase.envKey
        const apiKey = envKey ? process.env[envKey] : null
        if (!apiKey) {
            throw new Error('Browserbase API key is not materialized')
        }
        return apiKey
    }

    private requireActiveSession(): ActiveBrowserSession {
        if (!this.active || this.snapshotValue?.status !== 'open') {
            throw new Error('No active Browserbase session is open')
        }
        return this.active
    }

    private async consumeActionBudget(
        context: BrowserAutomationToolContext,
    ): Promise<RoomBrowserActionBudgetSnapshot> {
        this.pruneRunBudgets()
        const key = `${context.sessionKey}:${context.runId}`
        const max = normalizedBrowserActionBudget(this.config)
        const current = this.runBudgets.get(key) ?? {
            used: 0,
            max,
            updatedAt: this.now(),
        }
        const budget = {
            runId: context.runId,
            used: current.used,
            max,
        }
        if (current.used >= max) {
            await this.auditAction(context, 'failed', {
                error: 'Browser action budget exceeded',
                actionBudget: budget,
            })
            throw new Error(`Browser action budget exhausted for this run (${current.used}/${max})`)
        }
        const next = {
            runId: context.runId,
            used: current.used + 1,
            max,
        }
        this.runBudgets.set(key, {
            used: next.used,
            max,
            updatedAt: this.now(),
        })
        return next
    }

    private pruneRunBudgets(): void {
        const cutoff = this.now() - 2 * 60 * 60 * 1000
        for (const [key, budget] of this.runBudgets) {
            if (budget.updatedAt < cutoff) {
                this.runBudgets.delete(key)
            }
        }
    }

    private setSnapshot(next: RoomBrowserSessionSnapshot): void {
        this.snapshotValue = next
        this.notifySnapshot(next)
    }

    private notifySnapshot(snapshot: RoomBrowserSessionSnapshot | null): void {
        const sessionKey = snapshot?.sessionKey ?? this.active?.sessionKey ?? '__room__'
        this.broadcast(sessionKey, 'browser.session_changed', {
            sessionKey: snapshot?.sessionKey ?? null,
            status: snapshot?.status ?? 'closed',
            browserSession: snapshot
                ? {
                      ...snapshot,
                      liveUrl: snapshot.liveUrl ? '[available]' : null,
                  }
                : null,
        })
    }

    private async auditAction(
        context: Pick<BrowserAutomationToolContext, 'action' | 'sessionKey' | 'runId'>,
        status: 'started' | 'complete' | 'failed',
        payload: Record<string, unknown>,
    ): Promise<void> {
        await this.audit(`tool.browser_${context.action}`, {
            sessionKey: context.sessionKey,
            runId: context.runId,
            action: context.action,
            status,
            ...payload,
        })
    }

    private async refreshMetadata(
        signal: AbortSignal | undefined,
        actionBudget: RoomBrowserActionBudgetSnapshot,
    ): Promise<PageMetadata> {
        const active = this.requireActiveSession()
        const metadata = await readPageMetadata(active, signal)
        const current = this.snapshotValue
        this.setSnapshot({
            status: 'open',
            sessionId: active.browserbaseSessionId,
            sessionKey: active.sessionKey,
            pageUrl: metadata.url,
            pageTitle: metadata.title,
            liveUrl: current?.liveUrl ?? null,
            openedAt: active.openedAt,
            updatedAt: this.now(),
            actionBudget,
            message: null,
        })
        this.scheduleIdleClose()
        return metadata
    }

    private details(
        action: BrowserToolAction,
        actionBudget: RoomBrowserActionBudgetSnapshot | null,
        extra: Partial<BrowserToolDetails> = {},
    ): BrowserToolDetails {
        const snapshot = this.snapshotValue
        return {
            action,
            status: snapshot?.status ?? 'closed',
            sessionId: snapshot?.sessionId ?? null,
            pageUrl: snapshot?.pageUrl ?? null,
            pageTitle: snapshot?.pageTitle ?? null,
            actionBudget,
            liveSessionAvailable: Boolean(snapshot?.liveUrl),
            ...extra,
        }
    }

    private scheduleIdleClose(): void {
        if (this.idleCloseTimer) {
            clearTimeout(this.idleCloseTimer)
        }
        this.idleCloseTimer = setTimeout(() => {
            void this.enqueue(() =>
                this.releaseActiveSession({
                    reason: 'idle_timeout',
                    failOnProviderError: false,
                }),
            )
        }, this.config.budgets.idleTimeoutMs)
        this.idleCloseTimer.unref?.()
    }

    private scheduleHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer)
        }
        this.heartbeatTimer = setInterval(() => {
            const active = this.active
            if (!active) return
            void evaluateInPage(active, '(() => undefined)()', undefined).catch(() => undefined)
        }, cdpHeartbeatMs)
        this.heartbeatTimer.unref?.()
    }

    private clearTimers(): void {
        if (this.idleCloseTimer) {
            clearTimeout(this.idleCloseTimer)
            this.idleCloseTimer = null
        }
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer)
            this.heartbeatTimer = null
        }
    }

    private async releaseActiveSession(input: {
        reason: string
        context?: Pick<BrowserAutomationToolContext, 'action' | 'sessionKey' | 'runId'>
        actionBudget?: RoomBrowserActionBudgetSnapshot | null
        failOnProviderError: boolean
    }): Promise<string | null> {
        const active = this.active
        if (!active) {
            this.clearTimers()
            return null
        }
        const apiKey = this.apiKey()
        try {
            await releaseBrowserbaseSession({
                apiKey,
                sessionId: active.browserbaseSessionId,
            })
        } catch (error) {
            const message = browserErrorMessage(error)
            this.setSnapshot({
                status: 'error',
                sessionId: active.browserbaseSessionId,
                sessionKey: active.sessionKey,
                pageUrl: this.snapshotValue?.pageUrl ?? null,
                pageTitle: this.snapshotValue?.pageTitle ?? null,
                liveUrl: this.snapshotValue?.liveUrl ?? null,
                openedAt: active.openedAt,
                updatedAt: this.now(),
                actionBudget: input.actionBudget ?? this.snapshotValue?.actionBudget ?? null,
                message,
            })
            if (input.context) {
                await this.auditAction(input.context, 'failed', {
                    sessionId: active.browserbaseSessionId,
                    reason: input.reason,
                    error: message,
                    actionBudget: input.actionBudget ?? null,
                })
            }
            if (input.failOnProviderError) {
                throw error
            }
            return active.browserbaseSessionId
        }
        active.cdp.close()
        this.active = null
        this.clearTimers()
        this.setSnapshot({
            status: 'closed',
            sessionId: active.browserbaseSessionId,
            sessionKey: active.sessionKey,
            pageUrl: this.snapshotValue?.pageUrl ?? null,
            pageTitle: this.snapshotValue?.pageTitle ?? null,
            liveUrl: null,
            openedAt: active.openedAt,
            updatedAt: this.now(),
            actionBudget: input.actionBudget ?? this.snapshotValue?.actionBudget ?? null,
            message: input.reason,
        })
        return active.browserbaseSessionId
    }
}

export function createBrowserAutomationTools(input: {
    config: PiRuntimeConfig
    record: { key: string }
    browserAutomation: BrowserbaseBrowserAutomationManager
}): ToolDefinition[] {
    if (!input.browserAutomation.isConfigured()) {
        return []
    }

    const toolContext = (
        action: BrowserToolAction,
        toolCallId: string,
        signal?: AbortSignal,
    ): { context: BrowserAutomationToolContext; dispose: () => void } => {
        const runContext = currentToolRunContext()
        const combined = combineAbortSignals([signal, runContext?.signal])
        return {
            context: {
                action,
                toolCallId,
                sessionKey: runContext?.sessionKey ?? input.record.key,
                runId: runContext?.runId ?? toolCallId,
                signal: combined.signal,
            },
            dispose: combined.dispose,
        }
    }

    const runTool = async <T>(
        action: BrowserToolAction,
        toolCallId: string,
        signal: AbortSignal | undefined,
        run: (context: BrowserAutomationToolContext) => Promise<T>,
    ): Promise<T> => {
        const scoped = toolContext(action, toolCallId, signal)
        try {
            return await run(scoped.context)
        } finally {
            scoped.dispose()
        }
    }

    return [
        defineTool({
            name: 'agent_room_browser_open',
            label: 'Open Browser',
            description:
                'Open one Browserbase browser session for this room and navigate to a URL.',
            promptSnippet:
                'agent_room_browser_open opens the room browser through Browserbase and navigates to a safe public URL.',
            parameters: Type.Object({
                url: Type.String(),
            }),
            executionMode: 'sequential',
            execute: (toolCallId, params, signal) =>
                runTool('open', toolCallId, signal, (context) =>
                    input.browserAutomation.open(context, params),
                ),
        }),
        defineTool({
            name: 'agent_room_browser_close',
            label: 'Close Browser',
            description: 'Close the active Browserbase browser session for this room.',
            promptSnippet:
                'agent_room_browser_close releases the active Browserbase browser session.',
            parameters: Type.Object({}),
            executionMode: 'sequential',
            execute: (toolCallId, _params, signal) =>
                runTool('close', toolCallId, signal, (context) =>
                    input.browserAutomation.close(context),
                ),
        }),
        defineTool({
            name: 'agent_room_browser_navigate',
            label: 'Browser Navigate',
            description: 'Navigate the active Browserbase browser session to a safe public URL.',
            promptSnippet:
                'agent_room_browser_navigate changes the current page in the active room browser.',
            parameters: Type.Object({
                url: Type.String(),
            }),
            executionMode: 'sequential',
            execute: (toolCallId, params, signal) =>
                runTool('navigate', toolCallId, signal, (context) =>
                    input.browserAutomation.navigate(context, params),
                ),
        }),
        defineTool({
            name: 'agent_room_browser_click',
            label: 'Browser Click',
            description:
                'Click an element in the active Browserbase browser session by CSS selector.',
            promptSnippet:
                'agent_room_browser_click clicks a CSS selector in the active room browser.',
            parameters: Type.Object({
                selector: Type.String(),
            }),
            executionMode: 'sequential',
            execute: (toolCallId, params, signal) =>
                runTool('click', toolCallId, signal, (context) =>
                    input.browserAutomation.click(context, params),
                ),
        }),
        defineTool({
            name: 'agent_room_browser_type',
            label: 'Browser Type',
            description: 'Type text into an element in the active Browserbase browser session.',
            promptSnippet:
                'agent_room_browser_type focuses a CSS selector and types text in the active room browser.',
            parameters: Type.Object({
                selector: Type.String(),
                text: Type.String(),
                clear: Type.Optional(Type.Boolean()),
            }),
            executionMode: 'sequential',
            execute: (toolCallId, params, signal) =>
                runTool('type', toolCallId, signal, (context) =>
                    input.browserAutomation.type(context, params),
                ),
        }),
        defineTool({
            name: 'agent_room_browser_scroll',
            label: 'Browser Scroll',
            description: 'Scroll the active Browserbase browser session.',
            promptSnippet:
                'agent_room_browser_scroll scrolls the active room browser up, down, left, or right.',
            parameters: Type.Object({
                direction: Type.String(),
                amount: Type.Optional(Type.Number()),
            }),
            executionMode: 'sequential',
            execute: (toolCallId, params, signal) =>
                runTool('scroll', toolCallId, signal, (context) =>
                    input.browserAutomation.scroll(context, params),
                ),
        }),
        defineTool({
            name: 'agent_room_browser_screenshot',
            label: 'Browser Screenshot',
            description: 'Capture a screenshot from the active Browserbase browser session.',
            promptSnippet:
                'agent_room_browser_screenshot returns a screenshot from the active room browser.',
            parameters: Type.Object({}),
            executionMode: 'sequential',
            execute: (toolCallId, _params, signal) =>
                runTool('screenshot', toolCallId, signal, (context) =>
                    input.browserAutomation.screenshot(context),
                ),
        }),
        defineTool({
            name: 'agent_room_browser_read_text',
            label: 'Browser Read Text',
            description: 'Read bounded visible text from the active Browserbase browser session.',
            promptSnippet:
                'agent_room_browser_read_text reads bounded visible text from the active room browser page or selector.',
            parameters: Type.Object({
                selector: Type.Optional(Type.String()),
            }),
            executionMode: 'sequential',
            execute: (toolCallId, params, signal) =>
                runTool('read_text', toolCallId, signal, (context) =>
                    input.browserAutomation.readText(context, params),
                ),
        }),
    ]
}

async function createBrowserbaseSession(input: {
    apiKey: string
    timeoutSeconds: number
    signal?: AbortSignal
}): Promise<BrowserbaseSessionResponse> {
    const json = await browserbaseJsonRequest({
        apiKey: input.apiKey,
        url: `${browserbaseApiBaseUrl}/sessions`,
        method: 'POST',
        body: {
            keepAlive: true,
            browserSettings: {
                timeout: input.timeoutSeconds,
            },
        },
        signal: input.signal,
    })
    const record = asRecord(json)
    const id = typeof record?.id === 'string' ? record.id : null
    const connectUrl = typeof record?.connectUrl === 'string' ? record.connectUrl : null
    if (!id || !connectUrl) {
        throw new Error('Browserbase session response did not include an id and connectUrl')
    }
    return {
        id,
        connectUrl,
    }
}

async function getBrowserbaseDebugUrls(input: {
    apiKey: string
    sessionId: string
    signal?: AbortSignal
}): Promise<BrowserbaseDebugResponse> {
    const json = await browserbaseJsonRequest({
        apiKey: input.apiKey,
        url: `${browserbaseApiBaseUrl}/sessions/${encodeURIComponent(input.sessionId)}/debug`,
        method: 'GET',
        signal: input.signal,
    })
    const record = asRecord(json)
    return {
        debuggerFullscreenUrl:
            typeof record?.debuggerFullscreenUrl === 'string' ? record.debuggerFullscreenUrl : null,
        debuggerUrl: typeof record?.debuggerUrl === 'string' ? record.debuggerUrl : null,
        pages: Array.isArray(record?.pages)
            ? record.pages
                  .map(parseDebugPage)
                  .filter((page): page is BrowserbaseDebugPage => page !== null)
            : [],
    }
}

async function releaseBrowserbaseSession(input: {
    apiKey: string
    sessionId: string
    signal?: AbortSignal
}): Promise<void> {
    await browserbaseJsonRequest({
        apiKey: input.apiKey,
        url: `${browserbaseApiBaseUrl}/sessions/${encodeURIComponent(input.sessionId)}`,
        method: 'POST',
        body: {
            status: 'REQUEST_RELEASE',
        },
        signal: input.signal,
    })
}

async function browserbaseJsonRequest(input: {
    apiKey: string
    url: string
    method: 'GET' | 'POST'
    body?: unknown
    signal?: AbortSignal
}): Promise<unknown> {
    const response = await fetchWithAbort({
        url: input.url,
        signal: input.signal,
        init: {
            method: input.method,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                'user-agent': 'AgentRoom/1.0',
                'x-bb-api-key': input.apiKey,
            },
            body: input.body === undefined ? undefined : JSON.stringify(input.body),
        },
    })
    if (!response.ok) {
        throw new Error(browserbaseHttpErrorMessage(response.status))
    }
    const text = await readBrowserbaseResponseTextWithAbort({
        response,
        signal: input.signal,
    })
    if (!text.trim()) {
        return null
    }
    try {
        return JSON.parse(text)
    } catch {
        throw new Error('Browserbase returned invalid JSON')
    }
}

async function readBrowserbaseResponseTextWithAbort(input: {
    response: Response
    signal?: AbortSignal
}): Promise<string> {
    const body = input.response.body
    if (!body) {
        return ''
    }
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let timedOut = false
    let interrupted = false
    let rejectRead: ((error: Error) => void) | null = null
    const abortPromise = new Promise<never>((_resolve, reject) => {
        rejectRead = reject
    })
    const interruptRead = (message: string, timeout: boolean) => {
        if (interrupted) return
        interrupted = true
        timedOut = timeout
        reader.cancel().catch(() => undefined)
        rejectRead?.(new Error(message))
    }
    const timeout = setTimeout(() => {
        interruptRead('Browserbase response body timed out', true)
    }, cdpCommandTimeoutMs)
    timeout.unref?.()
    const abort = () => {
        interruptRead('Browser action was cancelled', false)
    }
    input.signal?.addEventListener('abort', abort, { once: true })
    if (input.signal?.aborted) {
        abort()
    }

    try {
        let text = ''
        while (true) {
            const chunk = await Promise.race([reader.read(), abortPromise])
            if (chunk.done) {
                break
            }
            text += decoder.decode(chunk.value, { stream: true })
        }
        text += decoder.decode()
        interrupted = true
        return text
    } catch (error) {
        if (error instanceof Error) {
            if (
                error.message === 'Browser action was cancelled' ||
                error.message === 'Browserbase response body timed out'
            ) {
                throw error
            }
        }
        throw new Error(
            timedOut ? 'Browserbase response body timed out' : 'Browserbase response body failed',
        )
    } finally {
        input.signal?.removeEventListener('abort', abort)
        clearTimeout(timeout)
        try {
            reader.releaseLock()
        } catch {}
    }
}

async function fetchWithAbort(input: {
    url: string
    init: RequestInit
    signal?: AbortSignal
}): Promise<Response> {
    const controller = new AbortController()
    let timedOut = false
    const timeout = setTimeout(() => {
        timedOut = true
        controller.abort()
    }, cdpCommandTimeoutMs)
    timeout.unref?.()
    const abort = () => controller.abort()
    input.signal?.addEventListener('abort', abort, { once: true })
    if (input.signal?.aborted) {
        abort()
    }
    try {
        return await fetch(input.url, {
            ...input.init,
            signal: controller.signal,
        })
    } catch (error) {
        if (controller.signal.aborted) {
            throw new Error(
                timedOut ? 'Browserbase request timed out' : 'Browser action was cancelled',
            )
        }
        throw error
    } finally {
        input.signal?.removeEventListener('abort', abort)
        clearTimeout(timeout)
    }
}

function browserbaseHttpErrorMessage(status: number): string {
    if (status === 401) {
        return 'Browserbase authentication failed'
    }
    if (status === 402 || status === 403) {
        return 'Browserbase rejected the session request for this account'
    }
    if (status === 408 || status === 504) {
        return 'Browserbase request timed out'
    }
    if (status === 429) {
        return 'Browserbase session limit or rate limit was reached'
    }
    return `Browserbase API request failed with status ${status}`
}

async function normalizeBrowserUrl(value: string): Promise<string> {
    const trimmed = value.trim()
    if (!trimmed) {
        throw new Error('Browser URL is required')
    }
    let url: URL
    try {
        url = new URL(trimmed)
    } catch {
        throw new Error('Browser URL must be an absolute http or https URL')
    }
    await assertSafeUrl(url)
    return url.toString()
}

function normalizeSelector(value: string): string {
    const selector = value.trim()
    if (!selector) {
        throw new Error('CSS selector is required')
    }
    if (selector.length > 1000) {
        throw new Error('CSS selector is too long')
    }
    return selector
}

function optionalSelector(value: string | undefined): string | null {
    if (value === undefined || value === null) {
        return null
    }
    return normalizeSelector(value)
}

function normalizeTypeText(value: string): string {
    if (value.length > 20000) {
        throw new Error('Browser typed text is too long')
    }
    return value
}

function normalizeScrollDirection(value: string): 'up' | 'down' | 'left' | 'right' {
    const normalized = value.trim().toLowerCase()
    if (
        normalized === 'up' ||
        normalized === 'down' ||
        normalized === 'left' ||
        normalized === 'right'
    ) {
        return normalized
    }
    throw new Error('Scroll direction must be up, down, left, or right')
}

function normalizeScrollAmount(value: number | undefined): number {
    const amount = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 800
    return Math.min(5000, Math.max(1, amount))
}

function normalizedBrowserActionBudget(config: PiRuntimeConfig): number {
    const value = config.budgets.browserActionsPerTurn
    if (!Number.isFinite(value)) {
        return defaultBrowserActionBudget
    }
    return Math.min(maxBrowserActionBudget, Math.max(1, Math.floor(value)))
}

function browserbaseTimeoutSeconds(config: PiRuntimeConfig): number {
    return Math.min(21600, Math.max(60, Math.ceil(config.budgets.idleTimeoutMs / 1000) + 60))
}

function bestLiveUrl(debug: BrowserbaseDebugResponse): string | null {
    return (
        debug.debuggerFullscreenUrl ??
        debug.pages.find((page) => page.debuggerFullscreenUrl)?.debuggerFullscreenUrl ??
        debug.debuggerUrl ??
        debug.pages.find((page) => page.debuggerUrl)?.debuggerUrl ??
        null
    )
}

function parseDebugPage(value: unknown): BrowserbaseDebugPage | null {
    const record = asRecord(value)
    if (!record) {
        return null
    }
    return {
        url: typeof record.url === 'string' ? record.url : null,
        title: typeof record.title === 'string' ? record.title : null,
        debuggerFullscreenUrl:
            typeof record.debuggerFullscreenUrl === 'string' ? record.debuggerFullscreenUrl : null,
        debuggerUrl: typeof record.debuggerUrl === 'string' ? record.debuggerUrl : null,
    }
}

async function navigateActivePage(
    active: ActiveBrowserSession,
    url: string,
    signal?: AbortSignal,
): Promise<void> {
    await active.cdp.command(
        'Page.navigate',
        {
            url,
        },
        active.pageSessionId,
        signal,
    )
    await waitForPageReady(active, signal)
}

async function waitForPageReady(active: ActiveBrowserSession, signal?: AbortSignal): Promise<void> {
    const deadline = Date.now() + pageReadyWaitMs
    while (Date.now() < deadline) {
        const ready = await evaluateInPage<boolean>(
            active,
            '(() => document.readyState === "interactive" || document.readyState === "complete")()',
            signal,
        )
        if (ready) {
            return
        }
        await delay(pageReadyPollMs, signal)
    }
}

async function readPageMetadata(
    active: ActiveBrowserSession,
    signal?: AbortSignal,
): Promise<PageMetadata> {
    const value = await evaluateInPage<unknown>(
        active,
        [
            '(() => ({',
            '    url: window.location.href || null,',
            '    title: document.title || null',
            '}))()',
        ].join('\n'),
        signal,
    )
    const record = asRecord(value)
    return {
        url: typeof record?.url === 'string' ? record.url : null,
        title: typeof record?.title === 'string' ? record.title : null,
    }
}

async function clickActivePage(
    active: ActiveBrowserSession,
    selector: string,
    signal?: AbortSignal,
): Promise<ClickTarget> {
    const value = await evaluateInPage<unknown>(
        active,
        [
            '(() => {',
            `    const element = document.querySelector(${JSON.stringify(selector)})`,
            '    if (!element) throw new Error("Element not found")',
            '    element.scrollIntoView({ block: "center", inline: "center" })',
            '    const rect = element.getBoundingClientRect()',
            '    if (!rect.width || !rect.height) throw new Error("Element has no clickable area")',
            '    const label = (element.innerText || element.textContent || element.getAttribute("aria-label") || element.getAttribute("title") || "").trim().slice(0, 120)',
            '    return {',
            '        x: rect.left + rect.width / 2,',
            '        y: rect.top + rect.height / 2,',
            '        label: label || null',
            '    }',
            '})()',
        ].join('\n'),
        signal,
    )
    const target = asRecord(value)
    const x = typeof target?.x === 'number' ? target.x : null
    const y = typeof target?.y === 'number' ? target.y : null
    if (x === null || y === null) {
        throw new Error('Browser click target could not be resolved')
    }
    await active.cdp.command(
        'Input.dispatchMouseEvent',
        {
            type: 'mouseMoved',
            x,
            y,
        },
        active.pageSessionId,
        signal,
    )
    await active.cdp.command(
        'Input.dispatchMouseEvent',
        {
            type: 'mousePressed',
            x,
            y,
            button: 'left',
            clickCount: 1,
        },
        active.pageSessionId,
        signal,
    )
    await active.cdp.command(
        'Input.dispatchMouseEvent',
        {
            type: 'mouseReleased',
            x,
            y,
            button: 'left',
            clickCount: 1,
        },
        active.pageSessionId,
        signal,
    )
    await delay(150, signal)
    return {
        x,
        y,
        label: typeof target?.label === 'string' ? target.label : null,
    }
}

async function typeInActivePage(
    active: ActiveBrowserSession,
    input: { selector: string; text: string; clear: boolean; signal?: AbortSignal },
): Promise<TypeTarget> {
    const value = await evaluateInPage<unknown>(
        active,
        [
            '(() => {',
            `    const element = document.querySelector(${JSON.stringify(input.selector)})`,
            '    if (!element) throw new Error("Element not found")',
            '    element.scrollIntoView({ block: "center", inline: "center" })',
            '    element.focus()',
            input.clear
                ? [
                      '    if ("value" in element) {',
                      '        element.value = ""',
                      '        element.dispatchEvent(new Event("input", { bubbles: true }))',
                      '    } else {',
                      '        element.textContent = ""',
                      '    }',
                  ].join('\n')
                : '',
            '    const label = (element.getAttribute("aria-label") || element.getAttribute("placeholder") || element.getAttribute("name") || "").trim().slice(0, 120)',
            '    return { label: label || null }',
            '})()',
        ]
            .filter(Boolean)
            .join('\n'),
        input.signal,
    )
    await active.cdp.command(
        'Input.insertText',
        {
            text: input.text,
        },
        active.pageSessionId,
        input.signal,
    )
    const target = asRecord(value)
    return {
        label: typeof target?.label === 'string' ? target.label : null,
    }
}

async function scrollActivePage(
    active: ActiveBrowserSession,
    input: {
        direction: 'up' | 'down' | 'left' | 'right'
        amount: number
        signal?: AbortSignal
    },
): Promise<void> {
    const deltaX =
        input.direction === 'left' ? -input.amount : input.direction === 'right' ? input.amount : 0
    const deltaY =
        input.direction === 'up' ? -input.amount : input.direction === 'down' ? input.amount : 0
    await active.cdp.command(
        'Input.dispatchMouseEvent',
        {
            type: 'mouseWheel',
            x: 400,
            y: 300,
            deltaX,
            deltaY,
        },
        active.pageSessionId,
        input.signal,
    )
    await delay(150, input.signal)
}

async function screenshotActivePage(
    active: ActiveBrowserSession,
    signal?: AbortSignal,
): Promise<ScreenshotResult> {
    const response = await active.cdp.command(
        'Page.captureScreenshot',
        {
            format: 'png',
            fromSurface: true,
        },
        active.pageSessionId,
        signal,
    )
    const record = asRecord(response)
    const data = typeof record?.data === 'string' ? record.data : null
    if (!data) {
        throw new Error('Browser screenshot response did not include image data')
    }
    return {
        data,
        bytes: Math.floor((data.length * 3) / 4),
    }
}

async function readTextFromActivePage(
    active: ActiveBrowserSession,
    selector: string | null,
    signal?: AbortSignal,
): Promise<TextReadResult> {
    const value = await evaluateInPage<unknown>(
        active,
        [
            '(() => {',
            selector
                ? `    const root = document.querySelector(${JSON.stringify(selector)})`
                : '    const root = document.body',
            '    if (!root) throw new Error("Text source not found")',
            '    const text = (root.innerText || root.textContent || "").replace(/\\s+/g, " ").trim()',
            '    return {',
            '        text,',
            selector ? `        source: ${JSON.stringify(selector)}` : '        source: "body"',
            '    }',
            '})()',
        ].join('\n'),
        signal,
    )
    const record = asRecord(value)
    return {
        text: typeof record?.text === 'string' ? record.text : '',
        source: typeof record?.source === 'string' ? record.source : null,
    }
}

async function evaluateInPage<T>(
    active: ActiveBrowserSession,
    expression: string,
    signal?: AbortSignal,
): Promise<T> {
    const response = await active.cdp.command(
        'Runtime.evaluate',
        {
            expression,
            awaitPromise: true,
            returnByValue: true,
        },
        active.pageSessionId,
        signal,
    )
    const record = asRecord(response)
    if (record?.exceptionDetails) {
        const details = asRecord(record.exceptionDetails)
        const text = typeof details?.text === 'string' ? details.text : 'Browser script failed'
        throw new Error(text)
    }
    const result = asRecord(record?.result)
    return result?.value as T
}

class BrowserCdpConnection {
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
        const socket = new WebSocketConstructor(input.url)
        const connection = new BrowserCdpConnection(socket, input.commandTimeoutMs)
        await connection.waitForOpen(input.signal)
        return connection
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
            } catch (error) {
                cleanup()
                reject(error instanceof Error ? error : new Error('Browser CDP send failed'))
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

    private waitForOpen(signal?: AbortSignal): Promise<void> {
        if (this.socket.readyState === 1) {
            return Promise.resolve()
        }
        return new Promise((resolve, reject) => {
            const cleanup = () => {
                this.socket.removeEventListener('open', open)
                this.socket.removeEventListener('close', close)
                this.socket.removeEventListener('error', close)
                signal?.removeEventListener('abort', abort)
            }
            const open = () => {
                cleanup()
                resolve()
            }
            const close = () => {
                cleanup()
                reject(new Error('Browser CDP connection failed'))
            }
            const abort = () => {
                cleanup()
                reject(new Error('Browser action was cancelled'))
            }
            this.socket.addEventListener('open', open, { once: true })
            this.socket.addEventListener('close', close, { once: true })
            this.socket.addEventListener('error', close, { once: true })
            signal?.addEventListener('abort', abort, { once: true })
            if (signal?.aborted) {
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
            pending.reject(new Error(message.error.message ?? 'Browser CDP command failed'))
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

function textBrowserResult(
    lines: Array<string | null>,
    details: BrowserToolDetails,
): AgentToolResult<BrowserToolDetails> {
    return {
        content: [
            {
                type: 'text',
                text: lines.filter((line): line is string => line !== null).join('\n'),
            },
        ],
        details,
    }
}

function imageBrowserResult(
    lines: Array<string | null>,
    data: string,
    details: BrowserToolDetails,
): AgentToolResult<BrowserToolDetails> {
    return {
        content: [
            {
                type: 'text',
                text: lines.filter((line): line is string => line !== null).join('\n'),
            },
            {
                type: 'image',
                data,
                mimeType: 'image/png',
            },
        ],
        details,
    }
}

function boundText(value: string, maxChars: number): { text: string; truncated: boolean } {
    if (value.length <= maxChars) {
        return {
            text: value,
            truncated: false,
        }
    }
    return {
        text: `${value.slice(0, maxChars)}...[truncated]`,
        truncated: true,
    }
}

function browserErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown browser automation error'
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
        throw new Error('Browser action was cancelled')
    }
    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            cleanup()
            resolve()
        }, ms)
        timeout.unref?.()
        signal?.addEventListener('abort', abort, { once: true })

        function cleanup() {
            clearTimeout(timeout)
            signal?.removeEventListener('abort', abort)
        }

        function abort() {
            cleanup()
            reject(new Error('Browser action was cancelled'))
        }
    })
}
