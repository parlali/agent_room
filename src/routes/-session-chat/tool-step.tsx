import { useState } from 'react'
import { AlertTriangleIcon, CheckIcon, ClockIcon, LoaderIcon } from 'lucide-react'

import { StatusDot } from '#/components/agent-room'
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '#/components/ui/sheet'
import { cn } from '#/lib/utils'
import type { RoomExecutionMessagePart } from '#/server/rooms/execution-types'

type StepTone = 'ready' | 'working' | 'attention' | 'muted'

interface StepDescriptor {
    title: string
    tone: StepTone
    summary: string
}

interface DetailEntry {
    label: string
    value: string
    tone?: 'muted' | 'danger'
}

const TOOL_VERB_TABLE: Array<[RegExp, string]> = [
    [/(read|open|view|get|fetch|cat|inspect)/i, 'Reading'],
    [/(search|grep|find|lookup|query)/i, 'Searching'],
    [/(write|save|persist|create|store)/i, 'Saving'],
    [/(edit|update|patch|modify|replace)/i, 'Editing'],
    [/(delete|remove|rm)/i, 'Removing'],
    [/(upload|attach)/i, 'Uploading'],
    [/(download)/i, 'Downloading'],
    [/(run|exec|shell|bash|cmd|spawn)/i, 'Running'],
    [/(plan|outline|draft|compose|generate)/i, 'Drafting'],
    [/(review|analyze|evaluate)/i, 'Reviewing'],
    [/(send|email|notify|message)/i, 'Sending'],
    [/(schedule|cron|wake)/i, 'Scheduling'],
    [/(browse|web|http|url)/i, 'Browsing'],
    [/(mcp)/i, 'Using a connected tool'],
    [/(file)/i, 'Working with files'],
]

export function ToolStep({ part, index }: { part: RoomExecutionMessagePart; index: number }) {
    const [open, setOpen] = useState(false)
    const descriptor = describeToolStep(part, index)
    const Icon = stepIcon(descriptor.tone)
    const detailEntries = collectDetailEntries(part)

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="flex w-full items-center gap-2 rounded-lg border border-border/60 bg-card px-3 py-2 text-left text-sm shadow-sm transition-colors hover:bg-muted/40"
            >
                <span className="flex size-6 shrink-0 items-center justify-center">
                    <Icon
                        className={cn(
                            'size-4',
                            descriptor.tone === 'ready' && 'text-ready-fg',
                            descriptor.tone === 'working' && 'text-working-fg animate-pulse',
                            descriptor.tone === 'attention' && 'text-attention-fg',
                            descriptor.tone === 'muted' && 'text-muted-foreground',
                        )}
                    />
                </span>
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate font-medium text-foreground">{descriptor.title}</span>
                    <span className="truncate text-xs text-muted-foreground">
                        {descriptor.summary}
                    </span>
                </span>
                <StatusDot tone={descriptor.tone} pulse={descriptor.tone === 'working'} />
            </button>
            <Sheet open={open} onOpenChange={setOpen}>
                <SheetContent side="right" className="w-full sm:max-w-md">
                    <SheetHeader>
                        <SheetTitle>{descriptor.title}</SheetTitle>
                        <SheetDescription>{descriptor.summary}</SheetDescription>
                    </SheetHeader>
                    <div className="flex flex-col gap-4 px-4 pb-6">
                        {detailEntries.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                No further details were captured for this step.
                            </p>
                        ) : (
                            detailEntries.map((entry) => (
                                <div key={entry.label} className="flex flex-col gap-1.5">
                                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                        {entry.label}
                                    </span>
                                    <pre
                                        className={cn(
                                            'overflow-x-auto rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words',
                                            entry.tone === 'danger' &&
                                                'border-destructive/40 bg-destructive/5 text-destructive',
                                        )}
                                    >
                                        {entry.value}
                                    </pre>
                                </div>
                            ))
                        )}
                    </div>
                </SheetContent>
            </Sheet>
        </>
    )
}

function describeToolStep(part: RoomExecutionMessagePart, index: number): StepDescriptor {
    const tone = stepTone(part)
    return {
        title: friendlyToolTitle(part, index),
        tone,
        summary: stepStatusLabel(tone, part),
    }
}

function friendlyToolTitle(part: RoomExecutionMessagePart, index: number): string {
    const name = part.toolName ?? ''
    if (!name) return `Step ${index + 1}`
    for (const [pattern, verb] of TOOL_VERB_TABLE) {
        if (pattern.test(name)) return verb
    }
    return `Working with ${name}`
}

function stepTone(part: RoomExecutionMessagePart): StepTone {
    const status = part.status?.toLowerCase() ?? ''
    if (status.includes('error') || status.includes('fail')) return 'attention'
    if (status.includes('approval') || status.includes('pending') || status.includes('wait')) {
        return 'attention'
    }
    if (status.includes('done') || status.includes('complete') || status.includes('ok')) {
        return 'ready'
    }
    if (status.includes('running') || status.includes('progress') || status.includes('working')) {
        return 'working'
    }
    if (part.type === 'tool_result') return 'ready'
    if (part.type === 'tool_call') return 'working'
    return 'muted'
}

function stepStatusLabel(tone: StepTone, part: RoomExecutionMessagePart): string {
    const lower = part.status?.toLowerCase() ?? ''
    if (lower.includes('approval') || lower.includes('wait')) return 'Waiting for approval'
    if (tone === 'attention') return 'Needs attention'
    if (tone === 'ready') return 'Done'
    if (tone === 'working') return 'Working'
    return part.status ?? 'Pending'
}

function stepIcon(tone: StepTone) {
    if (tone === 'ready') return CheckIcon
    if (tone === 'working') return LoaderIcon
    if (tone === 'attention') return AlertTriangleIcon
    return ClockIcon
}

function collectDetailEntries(part: RoomExecutionMessagePart): DetailEntry[] {
    const entries: DetailEntry[] = []
    const status = part.status?.toLowerCase() ?? ''
    entries.push({ label: 'Status', value: part.status ?? defaultStatusLabel(part) })
    if (status.includes('error') || status.includes('fail')) {
        const message = errorTextFromPart(part)
        if (message) entries.push({ label: 'What went wrong', value: message, tone: 'danger' })
    }
    const requested = humanReadable(part.input)
    if (requested) entries.push({ label: 'What was requested', value: requested })
    const happened = humanReadable(part.result)
    if (happened) entries.push({ label: 'What happened', value: happened })
    return entries
}

function defaultStatusLabel(part: RoomExecutionMessagePart): string {
    if (part.type === 'tool_call') return 'Running'
    if (part.type === 'tool_result') return 'Completed'
    return 'Unknown'
}

function errorTextFromPart(part: RoomExecutionMessagePart): string | null {
    const result = part.result
    if (typeof result === 'string' && result.trim()) return result.trim()
    if (result && typeof result === 'object' && !Array.isArray(result)) {
        const record = result as Record<string, unknown>
        for (const key of ['error', 'message', 'reason']) {
            const value = record[key]
            if (typeof value === 'string' && value.trim()) return value.trim()
        }
    }
    return part.text || null
}

function humanReadable(value: unknown): string | null {
    if (value === null || value === undefined) return null
    if (typeof value === 'string') return value.trim() || null
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (Array.isArray(value)) {
        if (value.length === 0) return null
        if (value.every((entry) => typeof entry === 'string')) return (value as string[]).join('\n')
        return null
    }
    if (typeof value === 'object') {
        const record = value as Record<string, unknown>
        for (const key of ['summary', 'message', 'description', 'content', 'text', 'output']) {
            const entry = record[key]
            if (typeof entry === 'string' && entry.trim()) return entry.trim()
        }
        const pairs = Object.entries(record)
            .filter(([, entry]) => typeof entry === 'string' || typeof entry === 'number')
            .slice(0, 6)
        if (pairs.length === 0) return null
        return pairs.map(([key, entry]) => `${key}: ${entry}`).join('\n')
    }
    return null
}
