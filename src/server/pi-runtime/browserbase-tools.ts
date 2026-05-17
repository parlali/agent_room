import { Type } from '@mariozechner/pi-ai'
import { defineTool, type ToolDefinition } from '@mariozechner/pi-coding-agent'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import type { BrowserbaseBrowserAutomationManager } from './browserbase-browser'
import type { BrowserAutomationToolContext, BrowserToolAction } from './browserbase-browser-types'
import { combineAbortSignals, currentToolRunContext } from './tool-run-context'

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
            name: 'browser_open',
            label: 'Open Browser',
            description: 'Open one Browserbase browser session and navigate to a URL.',
            promptSnippet:
                'browser_open opens the browser through Browserbase and navigates to a safe public URL.',
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
            name: 'browser_close',
            label: 'Close Browser',
            description: 'Close the active Browserbase browser session.',
            promptSnippet: 'browser_close releases the active Browserbase browser session.',
            parameters: Type.Object({}),
            executionMode: 'sequential',
            execute: (toolCallId, _params, signal) =>
                runTool('close', toolCallId, signal, (context) =>
                    input.browserAutomation.close(context),
                ),
        }),
        defineTool({
            name: 'browser_navigate',
            label: 'Browser Navigate',
            description: 'Navigate the active Browserbase browser session to a safe public URL.',
            promptSnippet: 'browser_navigate changes the current page in the active browser.',
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
            name: 'browser_click',
            label: 'Browser Click',
            description:
                'Click an element in the active Browserbase browser session by CSS selector.',
            promptSnippet: 'browser_click clicks a CSS selector in the active browser.',
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
            name: 'browser_type',
            label: 'Browser Type',
            description: 'Type text into an element in the active Browserbase browser session.',
            promptSnippet:
                'browser_type focuses a CSS selector and types text in the active browser.',
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
            name: 'browser_scroll',
            label: 'Browser Scroll',
            description: 'Scroll the active Browserbase browser session.',
            promptSnippet: 'browser_scroll scrolls the active browser up, down, left, or right.',
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
            name: 'browser_screenshot',
            label: 'Browser Screenshot',
            description: 'Capture a screenshot from the active Browserbase browser session.',
            promptSnippet: 'browser_screenshot returns a screenshot from the active browser.',
            parameters: Type.Object({}),
            executionMode: 'sequential',
            execute: (toolCallId, _params, signal) =>
                runTool('screenshot', toolCallId, signal, (context) =>
                    input.browserAutomation.screenshot(context),
                ),
        }),
        defineTool({
            name: 'browser_read_text',
            label: 'Browser Read Text',
            description: 'Read bounded visible text from the active Browserbase browser session.',
            promptSnippet:
                'browser_read_text reads bounded visible text from the active browser page or selector.',
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
