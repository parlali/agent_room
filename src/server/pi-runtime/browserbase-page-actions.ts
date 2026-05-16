import type {
    ActiveBrowserSession,
    ClickTarget,
    PageMetadata,
    ScreenshotResult,
    TextReadResult,
    TypeTarget,
} from './browserbase-browser-types'
import { asRecord, delay } from './browserbase-utils'
import { assertSafeUrl } from './web-url-safety'

const pageReadyWaitMs = 10000
const pageReadyPollMs = 250

export async function normalizeBrowserUrl(value: string): Promise<string> {
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

export function normalizeSelector(value: string): string {
    const selector = value.trim()
    if (!selector) {
        throw new Error('CSS selector is required')
    }
    if (selector.length > 1000) {
        throw new Error('CSS selector is too long')
    }
    return selector
}

export function optionalSelector(value: string | undefined): string | null {
    if (value === undefined || value === null) {
        return null
    }
    return normalizeSelector(value)
}

export function normalizeTypeText(value: string): string {
    if (value.length > 20000) {
        throw new Error('Browser typed text is too long')
    }
    return value
}

export function normalizeScrollDirection(value: string): 'up' | 'down' | 'left' | 'right' {
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

export function normalizeScrollAmount(value: number | undefined): number {
    const amount = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 800
    return Math.min(5000, Math.max(1, amount))
}

export async function navigateActivePage(
    active: ActiveBrowserSession,
    url: string,
    signal?: AbortSignal,
): Promise<void> {
    const response = await active.cdp.command(
        'Page.navigate',
        {
            url,
        },
        active.pageSessionId,
        signal,
    )
    const result = asRecord(response)
    if (typeof result?.errorText === 'string' && result.errorText) {
        throw new Error(`Browser navigation failed for ${url}: ${result.errorText}`)
    }
    if (result?.isDownload === true) {
        throw new Error(`Browser navigation started a download instead of loading ${url}`)
    }
    await waitForPageReady(active, signal)
}

export async function readPageMetadata(
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

export async function clickActivePage(
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

export async function typeInActivePage(
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

export async function scrollActivePage(
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

export async function screenshotActivePage(
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

export async function readTextFromActivePage(
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
        const remainingMs = deadline - Date.now()
        if (remainingMs <= 0) {
            break
        }
        await delay(Math.min(pageReadyPollMs, remainingMs), signal)
    }
    throw new Error('Browser page did not become ready before timeout')
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
