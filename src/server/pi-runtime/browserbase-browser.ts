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
    BrowserAutomationController,
} from './browserbase-browser-types'
import {
    cdpCommandTimeoutMs,
    cdpHeartbeatMs,
    defaultBrowserActionBudget,
    maxAuditTextChars,
    maxBrowserActionBudget,
    maxToolTextChars,
} from './browserbase-browser-types'
import { boundTextByChars } from './bounded-text'
import {
    browserbaseTimeoutSeconds,
    createBrowserbaseSession,
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

const automaticReleaseRetryDelayMs = 30000
const maxAutomaticReleaseAttempts = 3
export const browserbaseRuntimeShutdownReleaseRequestTimeoutMs = 3000
export const browserbaseRuntimeShutdownGraceMs =
    maxAutomaticReleaseAttempts * browserbaseRuntimeShutdownReleaseRequestTimeoutMs + 10000

type AutomaticReleaseRetryMode = 'scheduled' | 'immediate'

export class BrowserbaseBrowserAutomationManager implements BrowserAutomationController {
    private config: BrowserAutomationManagerInput['config']
    private audit: BrowserAutomationManagerInput['audit']
    private broadcast: BrowserAutomationManagerInput['broadcast']
    private now: () => number
    private activeBySession = new Map<string, ActiveBrowserSession>()
    private snapshotsBySession = new Map<string, RoomBrowserSessionSnapshot>()
    private runBudgets = new Map<string, BrowserActionBudgetState>()
    private idleCloseTimers = new Map<string, ReturnType<typeof setTimeout>>()
    private heartbeatTimers = new Map<string, ReturnType<typeof setInterval>>()
    private releaseRetryTimers = new Map<string, ReturnType<typeof setTimeout>>()
    private latestSnapshotSessionKey: string | null = null
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

    snapshot(sessionKey?: string | null): RoomBrowserSessionSnapshot | null {
        if (sessionKey) {
            return this.snapshotsBySession.get(sessionKey) ?? null
        }
        return this.latestSnapshotSessionKey
            ? (this.snapshotsBySession.get(this.latestSnapshotSessionKey) ?? null)
            : null
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
                await this.releaseRoomSessionsForReplacement(context, actionBudget)
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
                    runId: context.runId,
                    openedAt: this.now(),
                }
                this.activeBySession.set(context.sessionKey, active)
                await navigateActivePage(active, requestedUrl, context.signal)
                const metadata = await readPageMetadata(active, context.signal)
                this.setSnapshot({
                    status: 'open',
                    sessionId: session.id,
                    sessionKey: context.sessionKey,
                    pageUrl: metadata.url,
                    pageTitle: metadata.title,
                    liveUrl: null,
                    openedAt: active.openedAt,
                    updatedAt: this.now(),
                    actionBudget,
                    message: null,
                })
                this.scheduleIdleClose(context.sessionKey)
                this.scheduleHeartbeat(context.sessionKey)
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
                    this.details(context.sessionKey, 'open', actionBudget),
                )
            } catch (error) {
                const message = browserErrorMessage(error, [createdSession?.connectUrl])
                const activeForSession = this.activeBySession.get(context.sessionKey)
                if (
                    createdSession &&
                    activeForSession?.browserbaseSessionId !== createdSession.id
                ) {
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
                    const active = this.activeBySession.get(context.sessionKey)
                    const current = this.snapshotsBySession.get(context.sessionKey)
                    this.setSnapshot({
                        status: 'error',
                        sessionId: active?.browserbaseSessionId ?? null,
                        sessionKey: active?.sessionKey ?? context.sessionKey,
                        pageUrl: current?.pageUrl ?? null,
                        pageTitle: current?.pageTitle ?? null,
                        liveUrl: active ? (current?.liveUrl ?? null) : null,
                        openedAt: current?.openedAt ?? this.now(),
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
                    this.details(context.sessionKey, 'close', actionBudget),
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
                const active = this.requireActiveSession(context)
                await navigateActivePage(active, url, context.signal)
                const metadata = await this.refreshMetadata(context.signal, actionBudget, context)
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
                    this.details(context.sessionKey, 'navigate', actionBudget),
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
                const active = this.requireActiveSession(context)
                const target = await clickActivePage(active, selector, context.signal)
                const metadata = await this.refreshMetadata(context.signal, actionBudget, context)
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
                    this.details(context.sessionKey, 'click', actionBudget),
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
                const active = this.requireActiveSession(context)
                const target = await typeInActivePage(active, {
                    selector,
                    text,
                    clear,
                    signal: context.signal,
                })
                const metadata = await this.refreshMetadata(context.signal, actionBudget, context)
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
                    this.details(context.sessionKey, 'type', actionBudget, {
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
                const active = this.requireActiveSession(context)
                await scrollActivePage(active, {
                    direction,
                    amount,
                    signal: context.signal,
                })
                const metadata = await this.refreshMetadata(context.signal, actionBudget, context)
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
                    this.details(context.sessionKey, 'scroll', actionBudget),
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
                const active = this.requireActiveSession(context)
                const screenshot = await screenshotActivePage(active, context.signal)
                const metadata = await this.refreshMetadata(context.signal, actionBudget, context)
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
                    this.details(context.sessionKey, 'screenshot', actionBudget, {
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
                const active = this.requireActiveSession(context)
                const result = await readTextFromActivePage(active, selector, context.signal)
                const metadata = await this.refreshMetadata(context.signal, actionBudget, context)
                const bounded = boundTextByChars(result.text, maxToolTextChars)
                const auditText = boundTextByChars(result.text, maxAuditTextChars)
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
                    this.details(context.sessionKey, 'read_text', actionBudget, {
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
            const runtimeShutdown = reason === 'runtime_shutdown'
            await Promise.all(
                [...this.activeBySession.keys()].map((sessionKey) =>
                    this.releaseActiveSession({
                        reason,
                        sessionKey,
                        failOnProviderError: false,
                        retryMode: runtimeShutdown ? 'immediate' : 'scheduled',
                        releaseRequestTimeoutMs: runtimeShutdown
                            ? browserbaseRuntimeShutdownReleaseRequestTimeoutMs
                            : undefined,
                    }),
                ),
            )
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

    private requireActiveSession(
        context?: Pick<BrowserAutomationToolContext, 'sessionKey'>,
    ): ActiveBrowserSession {
        const active = context ? this.activeBySession.get(context.sessionKey) : null
        const snapshot = context ? this.snapshotsBySession.get(context.sessionKey) : null
        if (!active || snapshot?.status !== 'open') {
            throw new Error('No active Browserbase session is open')
        }
        return active
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
        if (next.sessionKey) {
            this.snapshotsBySession.set(next.sessionKey, next)
            this.latestSnapshotSessionKey = next.sessionKey
        }
        this.notifySnapshot(next)
    }

    private notifySnapshot(snapshot: RoomBrowserSessionSnapshot | null): void {
        const sessionKey = snapshot?.sessionKey ?? '__room__'
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
        context: Pick<BrowserAutomationToolContext, 'sessionKey'>,
    ): Promise<PageMetadata> {
        const active = this.requireActiveSession(context)
        const metadata = await readPageMetadata(active, signal)
        const current = this.snapshotsBySession.get(context.sessionKey)
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
        this.scheduleIdleClose(context.sessionKey)
        return metadata
    }

    private details(
        sessionKey: string,
        action: BrowserToolAction,
        actionBudget: RoomBrowserActionBudgetSnapshot | null,
        extra: Partial<BrowserToolDetails> = {},
    ): BrowserToolDetails {
        const snapshot = this.snapshot(sessionKey)
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

    private scheduleIdleClose(sessionKey: string): void {
        const existing = this.idleCloseTimers.get(sessionKey)
        if (existing) {
            clearTimeout(existing)
        }
        const timer = setTimeout(() => {
            void this.enqueue(() =>
                this.releaseActiveSession({
                    reason: 'idle_timeout',
                    sessionKey,
                    failOnProviderError: false,
                }),
            )
        }, this.config.budgets.idleTimeoutMs)
        timer.unref?.()
        this.idleCloseTimers.set(sessionKey, timer)
    }

    private scheduleHeartbeat(sessionKey: string): void {
        const existing = this.heartbeatTimers.get(sessionKey)
        if (existing) {
            clearInterval(existing)
        }
        const timer = setInterval(() => {
            const active = this.activeBySession.get(sessionKey)
            if (!active) return
            void readPageMetadata(active, undefined).catch(() => undefined)
        }, cdpHeartbeatMs)
        timer.unref?.()
        this.heartbeatTimers.set(sessionKey, timer)
    }

    private clearTimers(sessionKey?: string): void {
        if (!sessionKey) {
            for (const key of new Set([
                ...this.idleCloseTimers.keys(),
                ...this.heartbeatTimers.keys(),
                ...this.releaseRetryTimers.keys(),
            ])) {
                this.clearTimers(key)
            }
            return
        }
        const idle = this.idleCloseTimers.get(sessionKey)
        if (idle) {
            clearTimeout(idle)
            this.idleCloseTimers.delete(sessionKey)
        }
        const heartbeat = this.heartbeatTimers.get(sessionKey)
        if (heartbeat) {
            clearInterval(heartbeat)
            this.heartbeatTimers.delete(sessionKey)
        }
        const releaseRetry = this.releaseRetryTimers.get(sessionKey)
        if (releaseRetry) {
            clearTimeout(releaseRetry)
            this.releaseRetryTimers.delete(sessionKey)
        }
    }

    private async releaseCreatedSessionAfterOpenFailure(input: {
        context: Pick<BrowserAutomationToolContext, 'sessionKey' | 'runId'>
        sessionId: string
        actionBudget: RoomBrowserActionBudgetSnapshot
    }): Promise<void> {
        for (let attempt = 1; attempt <= maxAutomaticReleaseAttempts; attempt += 1) {
            const released = await this.releaseBrowserbaseProviderSession({
                sessionId: input.sessionId,
                sessionKey: input.context.sessionKey,
                runId: input.context.runId,
                reason: 'open_failed',
                actionBudget: input.actionBudget,
                attempt,
                auditLifecycle: true,
            })
            if (released.ok) {
                return
            }
        }
        await this.auditSessionRelease('failed', {
            sessionKey: input.context.sessionKey,
            runId: input.context.runId,
            sessionId: input.sessionId,
            reason: 'open_failed',
            attempt: maxAutomaticReleaseAttempts,
            error: 'Browserbase release retry limit reached',
            actionBudget: input.actionBudget,
        })
    }

    private async releaseBrowserbaseProviderSession(input: {
        sessionId: string
        sessionKey: string | null
        runId: string | null
        reason: string
        actionBudget?: RoomBrowserActionBudgetSnapshot | null
        attempt: number
        auditLifecycle: boolean
        releaseRequestTimeoutMs?: number
    }): Promise<{ ok: true } | { ok: false; message: string }> {
        try {
            await releaseBrowserbaseSession({
                apiKey: this.apiKey(),
                sessionId: input.sessionId,
                requestTimeoutMs: input.releaseRequestTimeoutMs,
            })
        } catch (error) {
            const message = browserErrorMessage(error)
            if (input.auditLifecycle) {
                await this.auditSessionRelease('failed', {
                    sessionKey: input.sessionKey,
                    runId: input.runId,
                    sessionId: input.sessionId,
                    reason: input.reason,
                    attempt: input.attempt,
                    error: message,
                    actionBudget: input.actionBudget ?? null,
                })
            }
            return {
                ok: false,
                message,
            }
        }
        if (input.auditLifecycle) {
            await this.auditSessionRelease('complete', {
                sessionKey: input.sessionKey,
                runId: input.runId,
                sessionId: input.sessionId,
                reason: input.reason,
                attempt: input.attempt,
                actionBudget: input.actionBudget ?? null,
            })
        }
        return {
            ok: true,
        }
    }

    private async releaseActiveSession(input: {
        reason: string
        context?: Pick<BrowserAutomationToolContext, 'action' | 'sessionKey' | 'runId'>
        sessionKey?: string
        actionBudget?: RoomBrowserActionBudgetSnapshot | null
        failOnProviderError: boolean
        attempt?: number
        retryMode?: AutomaticReleaseRetryMode
        releaseRequestTimeoutMs?: number
    }): Promise<string | null> {
        const sessionKey = input.context?.sessionKey ?? input.sessionKey
        if (!sessionKey) {
            return null
        }
        const active = this.activeBySession.get(sessionKey)
        if (!active) {
            this.clearTimers(sessionKey)
            return null
        }
        const auditLifecycle = input.reason !== 'tool_close'
        const attempt = input.attempt ?? 1
        const released = await this.releaseBrowserbaseProviderSession({
            sessionId: active.browserbaseSessionId,
            sessionKey: active.sessionKey,
            runId: active.runId,
            reason: input.reason,
            actionBudget: input.actionBudget ?? null,
            attempt,
            auditLifecycle,
            releaseRequestTimeoutMs: input.releaseRequestTimeoutMs,
        })
        if (!released.ok) {
            const current = this.snapshotsBySession.get(sessionKey)
            this.setSnapshot({
                status: 'error',
                sessionId: active.browserbaseSessionId,
                sessionKey: active.sessionKey,
                pageUrl: current?.pageUrl ?? null,
                pageTitle: current?.pageTitle ?? null,
                liveUrl: current?.liveUrl ?? null,
                openedAt: active.openedAt,
                updatedAt: this.now(),
                actionBudget: input.actionBudget ?? current?.actionBudget ?? null,
                message: released.message,
            })
            if (input.failOnProviderError) {
                throw new Error(released.message)
            }
            if ((input.retryMode ?? 'scheduled') === 'immediate') {
                if (attempt < maxAutomaticReleaseAttempts) {
                    return this.releaseActiveSession({
                        ...input,
                        attempt: attempt + 1,
                    })
                }
                await this.auditSessionRelease('failed', {
                    sessionKey: active.sessionKey,
                    runId: active.runId,
                    sessionId: active.browserbaseSessionId,
                    reason: input.reason,
                    attempt,
                    error: 'Browserbase release retry limit reached',
                    actionBudget: input.actionBudget ?? null,
                })
                return active.browserbaseSessionId
            }
            this.scheduleAutomaticReleaseRetry({
                ...input,
                attempt: attempt + 1,
                sessionId: active.browserbaseSessionId,
                sessionKey: active.sessionKey,
                runId: active.runId,
            })
            return active.browserbaseSessionId
        }
        active.cdp.close()
        this.activeBySession.delete(sessionKey)
        this.clearTimers(sessionKey)
        const current = this.snapshotsBySession.get(sessionKey)
        this.setSnapshot({
            status: 'closed',
            sessionId: active.browserbaseSessionId,
            sessionKey: active.sessionKey,
            pageUrl: current?.pageUrl ?? null,
            pageTitle: current?.pageTitle ?? null,
            liveUrl: null,
            openedAt: active.openedAt,
            updatedAt: this.now(),
            actionBudget: input.actionBudget ?? current?.actionBudget ?? null,
            message: input.reason,
        })
        return active.browserbaseSessionId
    }

    private async releaseRoomSessionsForReplacement(
        context: Pick<BrowserAutomationToolContext, 'action' | 'sessionKey' | 'runId'>,
        actionBudget: RoomBrowserActionBudgetSnapshot,
    ): Promise<void> {
        for (const sessionKey of [...this.activeBySession.keys()]) {
            await this.releaseActiveSession({
                reason: 'replaced',
                context: sessionKey === context.sessionKey ? context : undefined,
                sessionKey,
                actionBudget,
                failOnProviderError: true,
            })
        }
    }

    private scheduleAutomaticReleaseRetry(input: {
        reason: string
        context?: Pick<BrowserAutomationToolContext, 'action' | 'sessionKey' | 'runId'>
        actionBudget?: RoomBrowserActionBudgetSnapshot | null
        failOnProviderError: boolean
        attempt: number
        sessionId: string
        sessionKey: string | null
        runId: string | null
        retryMode?: AutomaticReleaseRetryMode
        releaseRequestTimeoutMs?: number
    }): void {
        if (input.failOnProviderError) {
            return
        }
        if (input.attempt > maxAutomaticReleaseAttempts) {
            void this.auditSessionRelease('failed', {
                sessionKey: input.sessionKey,
                runId: input.runId,
                sessionId: input.sessionId,
                reason: input.reason,
                attempt: input.attempt - 1,
                error: 'Browserbase release retry limit reached',
                actionBudget: input.actionBudget ?? null,
            })
            return
        }
        const sessionKey = input.sessionKey
        if (!sessionKey) {
            return
        }
        const existing = this.releaseRetryTimers.get(sessionKey)
        if (existing) {
            clearTimeout(existing)
        }
        const timer = setTimeout(() => {
            this.releaseRetryTimers.delete(sessionKey)
            void this.enqueue(async () => {
                if (
                    this.activeBySession.get(sessionKey)?.browserbaseSessionId !== input.sessionId
                ) {
                    return
                }
                await this.releaseActiveSession({
                    ...input,
                    sessionKey,
                })
            })
        }, automaticReleaseRetryDelayMs)
        timer.unref?.()
        this.releaseRetryTimers.set(sessionKey, timer)
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
