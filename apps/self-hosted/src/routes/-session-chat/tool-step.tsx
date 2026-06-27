import { useEffect, useMemo, useState } from 'react'
import {
    AlertTriangleIcon,
    CheckIcon,
    ChevronDownIcon,
    ExternalLinkIcon,
    GlobeIcon,
    LinkIcon,
    LoaderIcon,
    MonitorIcon,
    SquareIcon,
    WrenchIcon,
} from 'lucide-react'

import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'
import { WEB_ACCESS_CAPABILITY_LABEL } from '#/domain/capability-labels'
import type { RoomWebActivity, RoomWebActivityState } from '#/domain/room-execution-types'

import {
    summarizeToolTasks,
    type ToolActivityTask,
    type ToolTaskStatus,
} from '#/domain/tool-activity'

type OrderedToolActivity =
    | { kind: 'web'; task: ToolActivityTask & { web: RoomWebActivity } }
    | { kind: 'tools'; tasks: ToolActivityTask[] }

export function ToolActivity({
    id,
    tasks,
    className,
    onLayoutChange,
}: {
    id: string
    tasks: ToolActivityTask[]
    className?: string
    onLayoutChange?: () => void
}) {
    const visibleTasks = useMemo(() => tasks.filter((task) => task.title.trim()), [tasks])
    const orderedActivity = useMemo(() => orderedToolActivity(visibleTasks), [visibleTasks])

    if (visibleTasks.length === 0) return null

    return (
        <div
            className={cn(
                'flex w-full max-w-[min(42rem,100%)] flex-col items-start gap-2 text-muted-foreground',
                className,
            )}
        >
            {orderedActivity.map((item, index) =>
                item.kind === 'web' ? (
                    <WebActivityCard
                        key={item.task.id}
                        task={item.task}
                        onLayoutChange={onLayoutChange}
                    />
                ) : (
                    <ToolDisclosure
                        key={`${id}-tools-${index}`}
                        id={`${id}-tools-${index}`}
                        tasks={item.tasks}
                        onLayoutChange={onLayoutChange}
                    />
                ),
            )}
        </div>
    )
}

function orderedToolActivity(tasks: ToolActivityTask[]): OrderedToolActivity[] {
    const ordered: OrderedToolActivity[] = []
    let pendingTools: ToolActivityTask[] = []

    const flushTools = () => {
        if (pendingTools.length === 0) return
        ordered.push({ kind: 'tools', tasks: pendingTools })
        pendingTools = []
    }

    for (const task of tasks) {
        if (task.web) {
            flushTools()
            ordered.push({ kind: 'web', task: task as ToolActivityTask & { web: RoomWebActivity } })
        } else {
            pendingTools.push(task)
        }
    }
    flushTools()
    return ordered
}

function ToolDisclosure({
    id,
    tasks,
    onLayoutChange,
}: {
    id: string
    tasks: ToolActivityTask[]
    onLayoutChange?: () => void
}) {
    const status = activityStatus(tasks)
    const [open, setOpen] = useState(false)

    useEffect(() => {
        onLayoutChange?.()
    }, [onLayoutChange, open, status, tasks])

    const Icon = statusIcon(status)

    return (
        <div className="flex w-full flex-col items-start gap-1">
            <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => {
                    setOpen((value) => !value)
                    onLayoutChange?.()
                }}
                className={cn(
                    'h-auto max-w-full justify-start gap-1.5 px-1 py-0.5 text-left text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                    open && 'text-foreground',
                )}
                aria-expanded={open}
                aria-controls={`${id}-details`}
            >
                <Icon
                    className={cn(
                        'size-3.5 shrink-0',
                        status === 'complete' && 'text-ready-fg',
                        status === 'in_progress' && 'animate-spin text-working-fg',
                        status === 'pending' && 'text-muted-foreground',
                        status === 'stopped' && 'text-muted-foreground',
                        status === 'error' && 'text-attention-fg',
                    )}
                />
                <span className="min-w-0 truncate">{summarizeToolTasks(tasks)}</span>
                <span className="shrink-0 text-muted-foreground/70">
                    {activityStatusLabel(status)}
                </span>
                <ChevronDownIcon
                    className={cn('size-3 shrink-0 transition-transform', open && 'rotate-180')}
                />
            </Button>
            {open ? (
                <div id={`${id}-details`} className="flex w-full max-w-full flex-col gap-1 pl-5">
                    {tasks.map((task) => (
                        <ToolTaskRow key={task.id} task={task} />
                    ))}
                </div>
            ) : null}
        </div>
    )
}

function WebActivityCard({
    task,
    onLayoutChange,
}: {
    task: ToolActivityTask & { web: RoomWebActivity }
    onLayoutChange?: () => void
}) {
    const { web } = task
    const Icon = web.kind === 'browser' ? MonitorIcon : web.kind === 'fetch' ? LinkIcon : GlobeIcon

    useEffect(() => {
        onLayoutChange?.()
    }, [onLayoutChange, web])

    return (
        <div className="flex w-full max-w-full flex-col gap-1.5 rounded-lg border border-border/60 bg-card/60 px-3 py-2 text-xs">
            <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                <Icon className="size-3.5 shrink-0" />
                <span className="font-medium text-foreground">{WEB_ACCESS_CAPABILITY_LABEL}</span>
                <span className="text-muted-foreground/70">{webActionLabel(web)}</span>
            </div>
            {web.kind === 'search' ? <WebSearchBody web={web} /> : null}
            {web.kind === 'fetch' ? <WebFetchBody web={web} /> : null}
            {web.kind === 'browser' ? <WebBrowserBody web={web} /> : null}
            {web.state !== 'ok' ? <WebStateNote state={web.state} /> : null}
        </div>
    )
}

function WebSearchBody({ web }: { web: RoomWebActivity }) {
    return (
        <div className="flex min-w-0 flex-col gap-1.5">
            {web.query ? (
                <p className="min-w-0 break-words text-foreground">
                    Searched for <span className="font-medium">{web.query}</span>
                </p>
            ) : null}
            {web.sources.length > 0 ? (
                <ul className="flex min-w-0 flex-col gap-1">
                    {web.sources.map((source) => (
                        <li key={source.url} className="min-w-0">
                            <WebSourceLink
                                title={source.title}
                                url={source.url}
                                host={source.host}
                            />
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    )
}

function WebFetchBody({ web }: { web: RoomWebActivity }) {
    if (!web.page) {
        return <p className="text-muted-foreground">Read a web page.</p>
    }
    return <WebSourceLink title={web.page.title} url={web.page.url} host={web.page.host} />
}

function WebBrowserBody({ web }: { web: RoomWebActivity }) {
    return (
        <div className="flex min-w-0 flex-col gap-1">
            <p className="min-w-0 break-words text-foreground">
                {web.summary ?? 'Browsed the web.'}
            </p>
            {web.page ? (
                <WebSourceLink title={web.page.title} url={web.page.url} host={web.page.host} />
            ) : null}
        </div>
    )
}

function WebSourceLink({ title, url, host }: { title: string; url: string; host: string }) {
    return (
        <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="group/source flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-muted/60"
        >
            <span className="min-w-0 flex-1 truncate text-foreground group-hover/source:underline">
                {title}
            </span>
            <span className="shrink-0 text-muted-foreground/70">{host}</span>
            <ExternalLinkIcon className="size-3 shrink-0 text-muted-foreground/70" />
        </a>
    )
}

function WebStateNote({ state }: { state: RoomWebActivityState }) {
    return (
        <p className="flex items-center gap-1.5 text-attention-fg">
            <AlertTriangleIcon className="size-3.5 shrink-0" />
            {webStateMessage(state)}
        </p>
    )
}

function webStateMessage(state: RoomWebActivityState): string {
    if (state === 'setup_required') return 'Web access needs to finish setup before this can run.'
    if (state === 'unavailable') return 'Web access is unavailable right now.'
    if (state === 'rate_limited') return 'Web access is busy. Try again in a moment.'
    if (state === 'degraded') return 'Web access could not complete this.'
    return ''
}

function webActionLabel(web: RoomWebActivity): string {
    if (web.kind === 'search') return 'searched the web'
    if (web.kind === 'fetch') return 'read a page'
    return 'used the browser'
}

function ToolTaskRow({ task }: { task: ToolActivityTask }) {
    const Icon = statusIcon(task.status)

    return (
        <div className="flex min-w-0 flex-col gap-1 py-1 text-xs text-muted-foreground">
            <div className="flex min-w-0 items-center gap-2">
                <Icon
                    className={cn(
                        'size-3.5 shrink-0',
                        task.status === 'complete' && 'text-ready-fg',
                        task.status === 'in_progress' && 'animate-spin text-working-fg',
                        task.status === 'pending' && 'text-muted-foreground',
                        task.status === 'stopped' && 'text-muted-foreground',
                        task.status === 'error' && 'text-attention-fg',
                    )}
                />
                <span className="min-w-0 truncate font-medium text-foreground">{task.title}</span>
                <span className="ml-auto shrink-0 text-[0.6875rem]">
                    {activityStatusLabel(task.status)}
                </span>
            </div>
            {task.detail || task.result ? (
                <div className="ml-5 flex min-w-0 flex-col gap-0.5">
                    {task.detail ? <span className="truncate">{task.detail}</span> : null}
                    {task.result ? (
                        <span
                            className={cn(
                                'truncate',
                                task.status === 'error' && 'text-attention-fg',
                            )}
                        >
                            {task.result}
                        </span>
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}

function activityStatus(tasks: ToolActivityTask[]): ToolTaskStatus {
    if (tasks.some((task) => task.status === 'error')) return 'error'
    if (tasks.some((task) => task.status === 'in_progress')) return 'in_progress'
    if (tasks.some((task) => task.status === 'pending')) return 'pending'
    if (tasks.some((task) => task.status === 'stopped')) return 'stopped'
    return 'complete'
}

function activityStatusLabel(status: ToolTaskStatus): string {
    if (status === 'error') return 'Needs attention'
    if (status === 'stopped') return 'Stopped'
    if (status === 'complete') return 'Done'
    if (status === 'pending') return 'Waiting'
    return 'Working'
}

function statusIcon(status: ToolTaskStatus) {
    if (status === 'complete') return CheckIcon
    if (status === 'in_progress') return LoaderIcon
    if (status === 'stopped') return SquareIcon
    if (status === 'error') return AlertTriangleIcon
    return WrenchIcon
}
