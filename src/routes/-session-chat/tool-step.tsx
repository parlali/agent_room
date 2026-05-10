import { useEffect, useMemo, useState } from 'react'
import { AlertTriangleIcon, CheckIcon, ChevronDownIcon, LoaderIcon, WrenchIcon } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'

import {
    summarizeToolTasks,
    type ToolActivityTask,
    type ToolTaskStatus,
} from './tool-activity-model'

export function ToolActivity({
    id,
    tasks,
    className,
}: {
    id: string
    tasks: ToolActivityTask[]
    className?: string
}) {
    const visibleTasks = useMemo(() => tasks.filter((task) => task.title.trim()), [tasks])
    const status = activityStatus(visibleTasks)
    const [open, setOpen] = useState(status === 'in_progress' || status === 'pending')

    useEffect(() => {
        if (status === 'in_progress' || status === 'pending') {
            setOpen(true)
        } else if (status === 'complete') {
            setOpen(false)
        }
    }, [status])

    if (visibleTasks.length === 0) return null

    const Icon = statusIcon(status)

    return (
        <div
            className={cn(
                'flex w-full max-w-[min(42rem,100%)] flex-col items-start gap-1',
                className,
            )}
        >
            <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setOpen((value) => !value)}
                className={cn(
                    'max-w-full justify-start gap-1.5 px-1.5 text-left text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                    open && 'bg-muted/40 text-foreground',
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
                        status === 'error' && 'text-attention-fg',
                    )}
                />
                <span className="min-w-0 truncate">{summarizeToolTasks(visibleTasks)}</span>
                <span className="shrink-0 text-muted-foreground/70">
                    {activityStatusLabel(status)}
                </span>
                <ChevronDownIcon
                    className={cn('size-3 shrink-0 transition-transform', open && 'rotate-180')}
                />
            </Button>
            {open ? (
                <div
                    id={`${id}-details`}
                    className="ml-5 flex w-[calc(100%-1.25rem)] flex-col gap-1 border-l border-border/70 pl-3"
                >
                    {visibleTasks.map((task) => (
                        <ToolTaskRow key={task.id} task={task} />
                    ))}
                </div>
            ) : null}
        </div>
    )
}

function ToolTaskRow({ task }: { task: ToolActivityTask }) {
    const Icon = statusIcon(task.status)

    return (
        <div className="flex min-w-0 flex-col gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground">
            <div className="flex min-w-0 items-center gap-2">
                <Icon
                    className={cn(
                        'size-3.5 shrink-0',
                        task.status === 'complete' && 'text-ready-fg',
                        task.status === 'in_progress' && 'animate-spin text-working-fg',
                        task.status === 'pending' && 'text-muted-foreground',
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
    return 'complete'
}

function activityStatusLabel(status: ToolTaskStatus): string {
    if (status === 'error') return 'Needs attention'
    if (status === 'complete') return 'Done'
    if (status === 'pending') return 'Waiting'
    return 'Working'
}

function statusIcon(status: ToolTaskStatus) {
    if (status === 'complete') return CheckIcon
    if (status === 'in_progress') return LoaderIcon
    if (status === 'error') return AlertTriangleIcon
    return WrenchIcon
}
