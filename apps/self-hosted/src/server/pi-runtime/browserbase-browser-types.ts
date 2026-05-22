import type { AgentToolResult } from '@mariozechner/pi-coding-agent'
import type {
    RoomBrowserActionBudgetSnapshot,
    RoomBrowserSessionSnapshot,
} from '../rooms/execution-types'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import type { BrowserCdpConnection } from './browserbase-cdp'

export const defaultBrowserActionBudget = 50
export const maxBrowserActionBudget = 200
export const maxToolTextChars = 12000
export const maxAuditTextChars = 4000
export const cdpCommandTimeoutMs = 15000
export const cdpHeartbeatMs = 5 * 60 * 1000

export type BrowserToolAction =
    | 'open'
    | 'close'
    | 'navigate'
    | 'click'
    | 'type'
    | 'scroll'
    | 'screenshot'
    | 'read_text'

export interface BrowserAutomationManagerInput {
    config: PiRuntimeConfig
    audit: (event: string, payload: unknown) => Promise<void>
    broadcast: (sessionKey: string, event: string, payload: unknown) => void
    now?: () => number
}

export interface BrowserAutomationToolContext {
    action: BrowserToolAction
    toolCallId: string
    sessionKey: string
    runId: string
    signal?: AbortSignal
}

export interface BrowserAutomationController {
    isConfigured: () => boolean
    open: (
        context: BrowserAutomationToolContext,
        input: { url: string },
    ) => Promise<BrowserToolResult>
    close: (context: BrowserAutomationToolContext) => Promise<BrowserToolResult>
    navigate: (
        context: BrowserAutomationToolContext,
        input: { url: string },
    ) => Promise<BrowserToolResult>
    click: (
        context: BrowserAutomationToolContext,
        input: { selector: string },
    ) => Promise<BrowserToolResult>
    type: (
        context: BrowserAutomationToolContext,
        input: { selector: string; text: string; clear?: boolean },
    ) => Promise<BrowserToolResult>
    scroll: (
        context: BrowserAutomationToolContext,
        input: { direction: string; amount?: number },
    ) => Promise<BrowserToolResult>
    screenshot: (context: BrowserAutomationToolContext) => Promise<BrowserToolResult>
    readText: (
        context: BrowserAutomationToolContext,
        input: { selector?: string },
    ) => Promise<BrowserToolResult>
}

export interface BrowserActionBudgetState {
    used: number
    max: number
    updatedAt: number
}

export interface ActiveBrowserSession {
    browserbaseSessionId: string
    cdp: BrowserCdpConnection
    pageSessionId: string
    sessionKey: string
    runId: string
    openedAt: number
}

export interface BrowserToolDetails {
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

export type BrowserToolResult = AgentToolResult<BrowserToolDetails>

export interface PageMetadata {
    url: string | null
    title: string | null
}

export interface ClickTarget {
    x: number
    y: number
    label: string | null
}

export interface TypeTarget {
    label: string | null
}

export interface TextReadResult {
    text: string
    source: string | null
}

export interface ScreenshotResult {
    data: string
    bytes: number
}
