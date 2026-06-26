import { extractTextFromRuntimeContent } from './runtime-message'
import type {
    RoomExecutionMessagePart,
    RoomToolActivityStatus,
    RoomToolActivityTask,
    RoomWebActivity,
    RoomWebActivityKind,
    RoomWebActivityState,
    RoomWebActivitySource,
} from './room-execution-types'
import { categorizeAgentRoomTool, type AgentRoomToolCategory } from './agent-room-tool-categories'

export type ToolTaskStatus = RoomToolActivityStatus
export type ToolActivityTask = RoomToolActivityTask

interface ToolStepParts {
    id: string
    name: string | null
    call: RoomExecutionMessagePart | null
    result: RoomExecutionMessagePart | null
}

interface ToolProjectionInput {
    id: string
    name: string | null
    status: ToolTaskStatus
    input: unknown
    result: unknown
    text: string | null
}

interface ToolCopy {
    title: string
    action: string
    completeResult: string
}

const TOOL_COPY: Record<Exclude<AgentRoomToolCategory, 'other'>, ToolCopy> = {
    memory_read: {
        title: 'Read memory',
        action: 'read',
        completeResult: 'Room memory was checked',
    },
    memory_write: {
        title: 'Updated memory',
        action: 'edited',
        completeResult: 'Room memory was updated',
    },
    workspace_read: {
        title: 'Checked files',
        action: 'read',
        completeResult: 'Workspace information was provided to the agent',
    },
    workspace_search: {
        title: 'Searched files',
        action: 'searched',
        completeResult: 'Workspace search results were provided to the agent',
    },
    workspace_write: {
        title: 'Updated files',
        action: 'edited',
        completeResult: 'Workspace files were updated',
    },
    artifact: {
        title: 'Moved artifact',
        action: 'updated',
        completeResult: 'Artifact files were moved',
    },
    command: {
        title: 'Ran workspace command',
        action: 'ran',
        completeResult: 'Command state was updated',
    },
    research_search: {
        title: 'Searched the web',
        action: 'searched',
        completeResult: 'Web results were provided to the agent',
    },
    research_fetch: {
        title: 'Fetched a web page',
        action: 'read',
        completeResult: 'Page content was provided to the agent',
    },
    document_pdf: {
        title: 'Prepared a PDF',
        action: 'created',
        completeResult: 'PDF work completed',
    },
    image: {
        title: 'Created an image',
        action: 'created',
        completeResult: 'Image generation completed',
    },
    browser: {
        title: 'Browser activity',
        action: 'browsed',
        completeResult: 'Browser work completed',
    },
    subagent: {
        title: 'Asked another agent',
        action: 'delegated',
        completeResult: 'The agent returned its work',
    },
    deep_work: {
        title: 'Started deep work',
        action: 'delegated',
        completeResult: 'Deep work returned its result',
    },
    mcp: {
        title: 'Used a connected tool',
        action: 'used',
        completeResult: 'The connected tool returned a result',
    },
}

const SENSITIVE_KEY_PATTERN = /(secret|token|password|credential|authorization|api.?key|hash)/i
const workingResultLabel = 'Working'
const waitingResultLabel = 'Waiting'
const stoppedResultLabel = 'Stopped'

export function toolTasksFromParts(parts: RoomExecutionMessagePart[]): ToolActivityTask[] {
    return groupToolSteps(parts).map((step, index) =>
        projectToolTask(
            {
                id: step.id,
                name: step.name,
                status: toolStatusFromStep(step),
                input: step.call?.input ?? null,
                result: step.result?.result ?? null,
                text: step.result?.text ?? step.call?.text ?? null,
            },
            index,
        ),
    )
}

export function toolTaskFromRuntimeEvent(event: Record<string, unknown>): ToolActivityTask | null {
    const toolName = typeof event.toolName === 'string' ? event.toolName : null
    const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : null
    if (!toolName && !toolCallId) return null

    const result = event.type === 'tool_execution_end' ? event.result : event.partialResult
    const resultRecord = isRecord(result) ? result : null
    const isError = event.isError === true || resultRecord?.isError === true

    return projectToolTask({
        id: toolCallId ?? `${toolName ?? 'tool'}-${String(event.type ?? 'event')}`,
        name: toolName,
        status:
            event.type === 'tool_execution_end' ? (isError ? 'error' : 'complete') : 'in_progress',
        input: event.args ?? null,
        result: result ?? null,
        text:
            event.type === 'tool_execution_end'
                ? extractTextFromRuntimeContent(resultRecord?.content ?? result)
                : extractTextFromRuntimeContent(
                      isRecord(event.partialResult)
                          ? event.partialResult.content
                          : event.partialResult,
                  ),
    })
}

export function summarizeToolTasks(tasks: ToolActivityTask[]): string {
    if (tasks.length === 0) return 'Working'
    if (tasks.length === 1) return tasks[0]!.title

    const exploredCounts = new Map<string, number>()
    const actionCounts = new Map<string, number>()
    for (const task of tasks) {
        const summary = toolTaskSummary(task)
        if (summary.kind === 'explored') {
            exploredCounts.set(summary.noun, (exploredCounts.get(summary.noun) ?? 0) + 1)
        } else {
            const key = `${summary.verb}:${summary.noun}`
            actionCounts.set(key, (actionCounts.get(key) ?? 0) + 1)
        }
    }

    const parts: string[] = []
    if (exploredCounts.size > 0) {
        parts.push(`Explored ${formatSummaryCounts(exploredCounts).join(', ')}`)
    }

    for (const [key, count] of actionCounts.entries()) {
        const [verb = 'used', noun = 'tool'] = key.split(':')
        parts.push(`${parts.length === 0 ? capitalize(verb) : verb} ${formatCount(count, noun)}`)
    }

    return parts.join(', ')
}

function toolTaskSummary(task: ToolActivityTask):
    | {
          kind: 'explored'
          noun: string
      }
    | {
          kind: 'action'
          verb: string
          noun: string
      } {
    if (task.action === 'read') {
        return {
            kind: 'explored',
            noun: detailNoun(task.detail, 'file'),
        }
    }
    if (task.action === 'searched') {
        return {
            kind: 'explored',
            noun: 'search',
        }
    }
    if (task.action === 'ran') {
        return {
            kind: 'action',
            verb: 'ran',
            noun: 'command',
        }
    }
    if (task.action === 'edited') {
        return {
            kind: 'action',
            verb: 'edited',
            noun: detailNoun(task.detail, 'file'),
        }
    }
    if (task.action === 'created') {
        return {
            kind: 'action',
            verb: 'created',
            noun: 'item',
        }
    }
    if (task.action === 'delegated') {
        return {
            kind: 'action',
            verb: 'asked',
            noun: 'agent',
        }
    }
    return {
        kind: 'action',
        verb: task.action || 'used',
        noun: 'tool',
    }
}

function detailNoun(detail: string | null, fallback: string): string {
    if (!detail) return fallback
    if (detail.startsWith('Folder:')) return 'folder'
    if (detail.startsWith('Site:')) return 'page'
    if (detail.startsWith('Query:') || detail.startsWith('Reference:')) return 'search'
    return fallback
}

function formatSummaryCounts(counts: Map<string, number>): string[] {
    return [...counts.entries()].map(([noun, count]) => formatCount(count, noun))
}

function formatCount(count: number, noun: string): string {
    return `${count} ${count === 1 ? noun : pluralize(noun)}`
}

function pluralize(noun: string): string {
    if (noun.endsWith('s')) return noun
    if (noun.endsWith('ch') || noun.endsWith('sh')) return `${noun}es`
    return `${noun}s`
}

function capitalize(value: string): string {
    return value.length === 0 ? value : `${value[0]!.toUpperCase()}${value.slice(1)}`
}

function groupToolSteps(parts: RoomExecutionMessagePart[]): ToolStepParts[] {
    const byId = new Map<string, ToolStepParts>()
    const ordered: ToolStepParts[] = []

    parts.forEach((part, index) => {
        if (part.type !== 'tool_call' && part.type !== 'tool_result') return
        const id = part.toolCallId ?? `${part.toolName ?? 'tool'}-${index}`
        const existing =
            byId.get(id) ??
            ({
                id,
                name: part.toolName,
                call: null,
                result: null,
            } satisfies ToolStepParts)
        existing.name = existing.name ?? part.toolName
        if (part.type === 'tool_call') {
            existing.call = part
        } else {
            existing.result = part
        }
        if (!byId.has(id)) {
            byId.set(id, existing)
            ordered.push(existing)
        }
    })

    return ordered
}

function toolStatusFromStep(step: ToolStepParts): ToolTaskStatus {
    const status = `${step.call?.status ?? ''} ${step.result?.status ?? ''}`.toLowerCase()
    if (status.includes('error') || status.includes('fail')) return 'error'
    if (step.result) return 'complete'
    if (status.includes('complete') || status.includes('done') || status.includes('success')) {
        return 'complete'
    }
    if (status.includes('pending')) return 'pending'
    return 'in_progress'
}

function projectToolTask(input: ToolProjectionInput, index = 0): ToolActivityTask {
    const copy = toolCopy(input.name)
    const errorText = input.status === 'error' ? safeErrorText(input.text, input.result) : null
    return {
        id: input.id || `${input.name ?? 'tool'}-${index}`,
        title: copy.title,
        action: copy.action,
        status: input.status,
        detail: safeInputDetail(input.name, input.input),
        result: errorText ?? safeResultText(input.status, copy),
        web: projectWebActivity(input),
    }
}

function projectWebActivity(input: ToolProjectionInput): RoomWebActivity | null {
    const category = categorizeAgentRoomTool(input.name)
    if (category === 'research_search') {
        return buildWebActivity('search', input, {
            query: webQuery(input.input),
            sources: parseSearchSources(input.text),
        })
    }
    if (category === 'research_fetch') {
        return buildWebActivity('fetch', input, {
            page: webPageFromFetch(input.input, input.text),
        })
    }
    if (category === 'browser') {
        return buildWebActivity('browser', input, {
            summary: browserSummary(input.name, input.input),
            page: webSourceFromUrl(firstSafeString(asRecord(input.input), ['url']), null),
        })
    }
    return null
}

function buildWebActivity(
    kind: RoomWebActivityKind,
    input: ToolProjectionInput,
    partial: {
        query?: string | null
        summary?: string | null
        sources?: RoomWebActivitySource[]
        page?: RoomWebActivitySource | null
    },
): RoomWebActivity {
    return {
        kind,
        state: webActivityState(input),
        query: partial.query ?? null,
        summary: partial.summary ?? null,
        sources: partial.sources ?? [],
        page: partial.page ?? null,
    }
}

function webActivityState(input: ToolProjectionInput): RoomWebActivityState {
    if (input.status !== 'error') return 'ok'
    const message = safeErrorText(input.text, input.result).toLowerCase()
    if (/rate.?limit|too many request|quota|429/.test(message)) return 'rate_limited'
    if (/not configured|not materialized|missing .*key|no .*provider|set up|setup|not enabled/.test(message)) {
        return 'setup_required'
    }
    if (/unavailable|disabled|not available|turned off/.test(message)) return 'unavailable'
    return 'degraded'
}

function webQuery(input: unknown): string | null {
    return firstSafeString(asRecord(input), ['query', 'q'])
}

function parseSearchSources(text: string | null): RoomWebActivitySource[] {
    if (!text) return []
    const sources: RoomWebActivitySource[] = []
    const seen = new Set<string>()
    for (const block of text.split(/\n\s*\n/)) {
        const lines = block.split('\n')
        const urlLine = lines.find((line) => /^\s*URL:\s*/i.test(line))
        if (!urlLine) continue
        const url = urlLine.replace(/^\s*URL:\s*/i, '').trim()
        const source = webSourceFromUrl(url, searchResultTitle(lines))
        if (!source || seen.has(source.url)) continue
        seen.add(source.url)
        sources.push(source)
        if (sources.length >= 6) break
    }
    return sources
}

function searchResultTitle(lines: string[]): string | null {
    for (const line of lines) {
        const match = line.match(/^\s*\d+\.\s+(.*\S)\s*$/)
        if (match && match[1]) return truncateDisplay(match[1], 120)
    }
    return null
}

function webPageFromFetch(input: unknown, text: string | null): RoomWebActivitySource | null {
    const url = firstSafeString(asRecord(input), ['url'])
    const title = fetchTitle(text)
    return webSourceFromUrl(url, title)
}

function fetchTitle(text: string | null): string | null {
    if (!text) return null
    for (const line of text.split('\n').slice(0, 12)) {
        const match = line.match(/^\s*Title:\s*(.*\S)\s*$/i)
        if (match && match[1]) return truncateDisplay(match[1], 120)
    }
    return null
}

function browserSummary(name: string | null, input: unknown): string {
    const action = browserActionFromName(name)
    const host = webSourceFromUrl(firstSafeString(asRecord(input), ['url']), null)?.host ?? null
    if (action === 'navigate') return host ? `Opened ${host}` : 'Opened a web page'
    if (action === 'open') return 'Started a browser session'
    if (action === 'close') return 'Closed the browser session'
    if (action === 'click') return 'Clicked on the page'
    if (action === 'type') return 'Typed into the page'
    if (action === 'scroll') return 'Scrolled the page'
    if (action === 'screenshot') return 'Captured the page'
    if (action === 'read_text') return 'Read the page'
    return host ? `Browsed ${host}` : 'Browsed the web'
}

function browserActionFromName(name: string | null): string {
    if (!name) return ''
    const match = name.match(/browser_(.+)$/)
    return match?.[1] ?? ''
}

function webSourceFromUrl(value: string | null, title: string | null): RoomWebActivitySource | null {
    if (!value) return null
    try {
        const url = new URL(value)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
        const host = url.hostname.replace(/^www\./, '')
        return {
            title: title?.trim() || host,
            url: url.toString(),
            host,
        }
    } catch {
        return null
    }
}

function asRecord(value: unknown): Record<string, unknown> {
    return isRecord(value) ? value : {}
}

function toolCopy(name: string | null): ToolCopy {
    const category = categorizeAgentRoomTool(name)
    if (category !== 'other') {
        return TOOL_COPY[category]
    }
    return {
        title: 'Used a tool',
        action: 'used',
        completeResult: 'The tool returned a result',
    }
}

export function isTerminalToolStatus(
    status: ToolTaskStatus,
): status is 'stopped' | 'complete' | 'error' {
    return status === 'stopped' || status === 'complete' || status === 'error'
}

export function settleToolTaskForDisplay(
    task: ToolActivityTask,
    status: 'stopped' | 'complete' | 'error',
): ToolActivityTask {
    return {
        ...task,
        status,
        result: terminalToolResult(task, status),
    }
}

function safeResultText(status: ToolTaskStatus, copy: ToolCopy): string | null {
    if (status === 'complete') return copy.completeResult
    if (status === 'in_progress') return workingResultLabel
    if (status === 'pending') return waitingResultLabel
    if (status === 'stopped') return stoppedResultLabel
    return null
}

function terminalToolResult(
    task: ToolActivityTask,
    status: 'stopped' | 'complete' | 'error',
): string {
    const current = task.result && !isNonTerminalResult(task.result) ? task.result : null
    if (status === 'error') return current ?? 'The tool did not finish'
    if (status === 'stopped') return current ?? 'The tool was stopped'
    return current ?? completeResultForProjectedTask(task)
}

function completeResultForProjectedTask(task: ToolActivityTask): string {
    const copy = Object.values(TOOL_COPY).find((candidate) => {
        return candidate.title === task.title && candidate.action === task.action
    })
    return copy?.completeResult ?? 'The tool finished'
}

function isNonTerminalResult(value: string): boolean {
    return (
        value === workingResultLabel || value === waitingResultLabel || value === stoppedResultLabel
    )
}

export function isNonTerminalToolResult(value: string | null): boolean {
    return value !== null && isNonTerminalResult(value)
}

function safeInputDetail(name: string | null, input: unknown): string | null {
    if (!isRecord(input)) return null

    if (name === 'web_search' || name === 'agent_room_web_search') {
        return safeNamedValue(input, ['query', 'q'], 'Query')
    }

    if (name === 'fetch_url' || name === 'agent_room_fetch_url') {
        return safeUrlValue(input, ['url'], 'Site')
    }

    if (name && (name.startsWith('agent_room_') || categorizeAgentRoomTool(name) !== 'other')) {
        return (
            safePathValue(input, ['path', 'filePath', 'inputPath', 'outputPath'], 'File') ??
            safePathValue(input, ['directory', 'dir'], 'Folder') ??
            safeNamedValue(input, ['pattern', 'oldText', 'query'], 'Reference')
        )
    }

    return null
}

function safeNamedValue(
    input: Record<string, unknown>,
    keys: string[],
    label: string,
): string | null {
    const value = firstSafeString(input, keys)
    return value ? `${label}: ${truncateDisplay(value, 90)}` : null
}

function safePathValue(
    input: Record<string, unknown>,
    keys: string[],
    label: string,
): string | null {
    const value = firstSafeString(input, keys)
    if (!value) return null
    return `${label}: ${safePathLabel(value)}`
}

function safeUrlValue(
    input: Record<string, unknown>,
    keys: string[],
    label: string,
): string | null {
    const value = firstSafeString(input, keys)
    if (!value) return null
    try {
        const url = new URL(value)
        return `${label}: ${url.hostname}`
    } catch {
        return `${label}: ${truncateDisplay(value, 90)}`
    }
}

function firstSafeString(input: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
        if (SENSITIVE_KEY_PATTERN.test(key)) continue
        const value = input[key]
        if (typeof value === 'string' && value.trim()) return value.trim()
        if (Array.isArray(value)) {
            const first = value.find((entry) => typeof entry === 'string' && entry.trim())
            if (typeof first === 'string') return first.trim()
        }
    }
    return null
}

function safeErrorText(text: string | null, result: unknown): string {
    const message =
        (text?.trim() ? text : null) ??
        (isRecord(result) && typeof result.error === 'string' ? result.error : null) ??
        (isRecord(result) && typeof result.message === 'string' ? result.message : null) ??
        'The tool reported a problem'

    return truncateDisplay(message.replace(/\s+/g, ' '), 180)
}

function safePathLabel(value: string): string {
    const parts = value.split(/[\\/]+/).filter(Boolean)
    if (parts.length === 0) return truncateDisplay(value, 90)
    return parts.slice(-2).join('/')
}

function truncateDisplay(value: string, length: number): string {
    const trimmed = value.trim()
    return trimmed.length > length ? `${trimmed.slice(0, length - 3).trimEnd()}...` : trimmed
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
