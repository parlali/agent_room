import type { AgentToolResult } from '@mariozechner/pi-coding-agent'
import type {
    RoomBrowserActionBudgetSnapshot,
    RoomBrowserSessionSnapshot,
} from '../rooms/execution-types'
import type {
    ActiveBrowserSession,
    BrowserActionBudgetState,
    BrowserAutomationManagerInput,
    BrowserAutomationToolContext,
    BrowserToolAction,
    BrowserToolDetails,
    BrowserToolResult,
    PageMetadata,
} from './browserbase-browser-types'
import {
    cdpCommandTimeoutMs,
    cdpHeartbeatMs,
    defaultBrowserActionBudget,
    maxAuditTextChars,
    maxBrowserActionBudget,
    maxToolTextChars,
} from './browserbase-browser-types'
import {
    bestLiveUrl,
    browserbaseTimeoutSeconds,
    createBrowserbaseSession,
    getBrowserbaseDebugUrls,
    releaseBrowserbaseSession,
    type BrowserbaseSessionResponse,
} from './browserbase-client'
import { BrowserCdpConnection } from './browserbase-cdp'
import {
    clickActivePage,
    navigateActivePage,
    normalizeBrowserUrl,
    normalizeScrollAmount,
    normalizeScrollDirection,
    normalizeSelector,
    normalizeTypeText,
    optionalSelector,
    readPageMetadata,
    readTextFromActivePage,
    screenshotActivePage,
    scrollActivePage,
    typeInActivePage,
} from './browserbase-page-actions'
import { browserErrorMessage } from './browserbase-utils'
import { sanitizeUrlForAudit } from './web-url-safety'

export { createBrowserAutomationTools } from './browserbase-tools'

export class BrowserbaseBrowserAutomationManager {
    private config: BrowserAutomationManagerInput['config']
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
    ): Promise<BrowserToolResult> {
        return this.enqueue(async () => {
            const actionBudget = await this.consumeActionBudget(context)
            let requestedUrl: string | null = null
            let createdSession: BrowserbaseSessionResponse | null = null
            let createdCdp: BrowserCdpConnection | null = null
            let lifecycleTouched = false

            try {
                requestedUrl = await normalizeBrowserUrl(input.url)
                await this.auditAction(context, 'started', {
                    requestedUrl: sanitizeUrlForAudit(requestedUrl),
                    actionBudget,
                })
                lifecycleTouched = true
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
                    timeoutSeconds: browserbaseTimeoutSeconds(this.config.budgets.idleTimeoutMs),
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
                const message = browserErrorMessage(error, [createdSession?.connectUrl])
                if (createdSession && this.active?.browserbaseSessionId !== createdSession.id) {
                    createdCdp?.close()
                    await this.releaseCreatedSessionAfterOpenFailure({
                        context,
                        sessionId: createdSession.id,
                        actionBudget,
                    })
                } else if (createdSession) {
                    await this.releaseActiveSession({
                        reason: 'open_failed',
                        context,
                        actionBudget,
                        failOnProviderError: false,
                    })
                }
                if (lifecycleTouched || createdSession) {
                    const active = this.active
                    this.setSnapshot({
                        status: 'error',
                        sessionId: active?.browserbaseSessionId ?? null,
                        sessionKey: active?.sessionKey ?? context.sessionKey,
                        pageUrl: this.snapshotValue?.pageUrl ?? null,
                        pageTitle: this.snapshotValue?.pageTitle ?? null,
                        liveUrl: active ? (this.snapshotValue?.liveUrl ?? null) : null,
                        openedAt: this.snapshotValue?.openedAt ?? this.now(),
                        updatedAt: this.now(),
                        actionBudget,
                        message,
                    })
                }
                await this.auditAction(context, 'failed', {
                    requestedUrl: requestedUrl ? sanitizeUrlForAudit(requestedUrl) : null,
                    error: message,
                    actionBudget,
                })
                throw new Error(message)
            }
        })
    }

    async close(context: BrowserAutomationToolContext): Promise<BrowserToolResult> {
        return this.enqueue(async () => {
            const actionBudget = this.currentActionBudget(context)
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
                const message = browserErrorMessage(error)
                await this.auditAction(context, 'failed', {
                    error: message,
                    actionBudget,
                })
                throw new Error(message)
            }
        })
    }

    async navigate(
        context: BrowserAutomationToolContext,
        input: { url: string },
    ): Promise<BrowserToolResult> {
        return this.enqueue(async () => {
            const actionBudget = await this.consumeActionBudget(context)
            let url: string | null = null
            try {
                url = await normalizeBrowserUrl(input.url)
                await this.auditAction(context, 'started', {
                    requestedUrl: sanitizeUrlForAudit(url),
                    actionBudget,
                })
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
                const message = browserErrorMessage(error)
                await this.auditAction(context, 'failed', {
                    requestedUrl: url ? sanitizeUrlForAudit(url) : null,
                    error: message,
                    actionBudget,
                })
                throw new Error(message)
            }
        })
    }

    async click(
        context: BrowserAutomationToolContext,
        input: { selector: string },
    ): Promise<BrowserToolResult> {
        return this.enqueue(async () => {
            const actionBudget = await this.consumeActionBudget(context)
            let selector: string | null = null
            try {
                selector = normalizeSelector(input.selector)
                await this.auditAction(context, 'started', {
                    selector,
                    actionBudget,
                })
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
                const message = browserErrorMessage(error)
                await this.auditAction(context, 'failed', {
                    selector,
                    selectorLength:
                        typeof input.selector === 'string' ? input.selector.length : null,
                    error: message,
                    actionBudget,
                })
                throw new Error(message)
            }
        })
    }

    async type(
        context: BrowserAutomationToolContext,
        input: { selector: string; text: string; clear?: boolean },
    ): Promise<BrowserToolResult> {
        return this.enqueue(async () => {
            const actionBudget = await this.consumeActionBudget(context)
            let selector: string | null = null
            let textLength: number | null = null
            const clear = input.clear === true
            try {
                selector = normalizeSelector(input.selector)
                const text = normalizeTypeText(input.text)
                textLength = text.length
                await this.auditAction(context, 'started', {
                    selector,
                    textLength,
                    clear,
                    actionBudget,
                })
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
                    textLength,
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
                        `Text length: ${textLength}`,
                        target.label ? `Element: ${target.label}` : null,
                        `Action budget: ${actionBudget.used}/${actionBudget.max}`,
                    ],
                    this.details('type', actionBudget, {
                        textLength,
                    }),
                )
            } catch (error) {
                const message = browserErrorMessage(error)
                await this.auditAction(context, 'failed', {
                    selector,
                    textLength,
                    clear,
                    error: message,
                    actionBudget,
                })
                throw new Error(message)
            }
        })
    }

    async scroll(
        context: BrowserAutomationToolContext,
        input: { direction: string; amount?: number },
    ): Promise<BrowserToolResult> {
        return this.enqueue(async () => {
            const actionBudget = await this.consumeActionBudget(context)
            let direction: 'up' | 'down' | 'left' | 'right' | null = null
            let amount: number | null = null
            try {
                direction = normalizeScrollDirection(input.direction)
                amount = normalizeScrollAmount(input.amount)
                await this.auditAction(context, 'started', {
                    direction,
                    amount,
                    actionBudget,
                })
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
                const message = browserErrorMessage(error)
                await this.auditAction(context, 'failed', {
                    direction,
                    amount,
                    error: message,
                    actionBudget,
                })
                throw new Error(message)
            }
        })
    }

    async screenshot(context: BrowserAutomationToolContext): Promise<BrowserToolResult> {
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
                const message = browserErrorMessage(error)
                await this.auditAction(context, 'failed', {
                    error: message,
                    actionBudget,
                })
                throw new Error(message)
            }
        })
    }

    async readText(
        context: BrowserAutomationToolContext,
        input: { selector?: string },
    ): Promise<BrowserToolResult> {
        return this.enqueue(async () => {
            const actionBudget = await this.consumeActionBudget(context)
            let selector: string | null = null
            try {
                selector = optionalSelector(input.selector)
                await this.auditAction(context, 'started', {
                    selector,
                    actionBudget,
                })
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
                const message = browserErrorMessage(error)
                await this.auditAction(context, 'failed', {
                    selector,
                    error: message,
                    actionBudget,
                })
                throw new Error(message)
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
        const budget = this.currentActionBudget(context)
        if (budget.used >= budget.max) {
            await this.auditAction(context, 'failed', {
                error: 'Browser action budget exceeded',
                actionBudget: budget,
            })
            throw new Error(
                `Browser action budget exhausted for this run (${budget.used}/${budget.max})`,
            )
        }
        const next = {
            runId: context.runId,
            used: budget.used + 1,
            max: budget.max,
        }
        this.runBudgets.set(this.budgetKey(context), {
            used: next.used,
            max: next.max,
            updatedAt: this.now(),
        })
        return next
    }

    private currentActionBudget(
        context: Pick<BrowserAutomationToolContext, 'sessionKey' | 'runId'>,
    ): RoomBrowserActionBudgetSnapshot {
        this.pruneRunBudgets()
        const max = normalizedBrowserActionBudget(this.config)
        const current = this.runBudgets.get(this.budgetKey(context))
        return {
            runId: context.runId,
            used: current?.used ?? 0,
            max,
        }
    }

    private budgetKey(context: Pick<BrowserAutomationToolContext, 'sessionKey' | 'runId'>): string {
        return `${context.sessionKey}:${context.runId}`
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

    private async auditSessionRelease(
        status: 'complete' | 'failed',
        payload: Record<string, unknown>,
    ): Promise<void> {
        await this.audit('browser.session_release', {
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
            void readPageMetadata(active, undefined).catch(() => undefined)
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

    private async releaseCreatedSessionAfterOpenFailure(input: {
        context: Pick<BrowserAutomationToolContext, 'sessionKey' | 'runId'>
        sessionId: string
        actionBudget: RoomBrowserActionBudgetSnapshot
    }): Promise<void> {
        try {
            await releaseBrowserbaseSession({
                apiKey: this.apiKey(),
                sessionId: input.sessionId,
            })
            await this.auditSessionRelease('complete', {
                sessionKey: input.context.sessionKey,
                runId: input.context.runId,
                sessionId: input.sessionId,
                reason: 'open_failed',
                actionBudget: input.actionBudget,
            })
        } catch (error) {
            await this.auditSessionRelease('failed', {
                sessionKey: input.context.sessionKey,
                runId: input.context.runId,
                sessionId: input.sessionId,
                reason: 'open_failed',
                error: browserErrorMessage(error),
                actionBudget: input.actionBudget,
            })
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
        const auditLifecycle = input.reason !== 'tool_close'
        try {
            await releaseBrowserbaseSession({
                apiKey: this.apiKey(),
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
            if (auditLifecycle) {
                await this.auditSessionRelease('failed', {
                    sessionKey: input.context?.sessionKey ?? active.sessionKey,
                    runId: input.context?.runId ?? null,
                    sessionId: active.browserbaseSessionId,
                    reason: input.reason,
                    error: message,
                    actionBudget: input.actionBudget ?? null,
                })
            }
            if (input.failOnProviderError) {
                throw new Error(message)
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
        if (auditLifecycle) {
            await this.auditSessionRelease('complete', {
                sessionKey: input.context?.sessionKey ?? active.sessionKey,
                runId: input.context?.runId ?? null,
                sessionId: active.browserbaseSessionId,
                reason: input.reason,
                actionBudget: input.actionBudget ?? null,
            })
        }
        return active.browserbaseSessionId
    }
}

function normalizedBrowserActionBudget(config: BrowserAutomationManagerInput['config']): number {
    const value = config.budgets.browserActionsPerTurn
    if (!Number.isFinite(value)) {
        return defaultBrowserActionBudget
    }
    return Math.min(maxBrowserActionBudget, Math.max(1, Math.floor(value)))
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
