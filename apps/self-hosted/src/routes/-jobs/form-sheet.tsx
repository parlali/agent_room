import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronDownIcon, ClockIcon, Loader2Icon, PlusIcon, XIcon } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { ButtonGroup } from '#/components/ui/button-group'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '#/components/ui/collapsible'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '#/components/ui/select'
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from '#/components/ui/sheet'
import { Textarea } from '#/components/ui/textarea'
import {
    defaultJobSchedule,
    describeJobSchedule,
    normalizeJobSchedule,
    weekDays,
    type JobSchedule,
} from '#/domain/job-schedule'
import type { JobFormState } from './model'

const scheduleTypes = [
    { value: 'interval', label: 'Interval' },
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
] as const

const intervalUnits = [
    { value: 'minutes', label: 'Minutes' },
    { value: 'hours', label: 'Hours' },
    { value: 'days', label: 'Days' },
    { value: 'weeks', label: 'Weeks' },
] as const

type IntervalUnit = Extract<JobSchedule, { type: 'interval' }>['unit']

const groupedOptionClass =
    'relative h-8 rounded-md text-sm after:absolute after:inset-x-2 after:bottom-1 after:h-0.5 after:rounded-full after:bg-primary after:opacity-0 after:transition-opacity data-[active=true]:bg-background data-[active=true]:text-foreground data-[active=true]:shadow-sm data-[active=true]:after:opacity-100 dark:data-[active=true]:bg-input/50'

export function JobFormSheet({
    mode,
    open,
    roomId,
    timezone,
    onOpenChange,
    initial,
    pending,
    onSubmit,
}: {
    mode: 'create' | 'edit'
    open: boolean
    roomId: string
    timezone: string
    onOpenChange: (open: boolean) => void
    initial: JobFormState
    pending: boolean
    onSubmit: (form: JobFormState) => void
}) {
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="flex w-full flex-col gap-0 sm:max-w-xl">
                <SheetHeader>
                    <SheetTitle>
                        {mode === 'create' ? 'New scheduled task' : 'Edit scheduled task'}
                    </SheetTitle>
                    <SheetDescription>
                        {mode === 'create'
                            ? 'Schedule recurring work this room should do on its own.'
                            : 'Update what this task does and when it runs.'}
                    </SheetDescription>
                </SheetHeader>
                <JobForm
                    key={`${mode}-${open ? 'open' : 'closed'}-${initial.name}`}
                    initial={initial}
                    roomId={roomId}
                    timezone={timezone}
                    pending={pending}
                    submitLabel={mode === 'create' ? 'Create task' : 'Save changes'}
                    onCancel={() => onOpenChange(false)}
                    onSubmit={onSubmit}
                />
            </SheetContent>
        </Sheet>
    )
}

function JobForm({
    initial,
    roomId,
    timezone,
    pending,
    submitLabel,
    onSubmit,
    onCancel,
}: {
    initial: JobFormState
    roomId: string
    timezone: string
    pending: boolean
    submitLabel: string
    onSubmit: (form: JobFormState) => void
    onCancel: () => void
}) {
    const [name, setName] = useState(initial.name)
    const [message, setMessage] = useState(initial.message)
    const [schedule, setSchedule] = useState<JobSchedule>(initial.schedule)
    const [advancedOpen, setAdvancedOpen] = useState(false)

    const normalizedSchedule = normalizeJobSchedule(schedule)
    const valid =
        name.trim().length > 0 && message.trim().length > 0 && jobScheduleValid(normalizedSchedule)

    return (
        <form
            onSubmit={(e) => {
                e.preventDefault()
                if (!valid || pending) return
                onSubmit({
                    name: name.trim(),
                    message: message.trim(),
                    schedule: normalizedSchedule,
                })
            }}
            className="flex min-h-0 flex-1 flex-col"
        >
            <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
                <div className="space-y-1.5">
                    <Label htmlFor="job-name">Name</Label>
                    <Input
                        id="job-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Daily inbox sweep"
                        required
                    />
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="job-message">Instruction</Label>
                    <Textarea
                        id="job-message"
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="Check for new tickets and summarize what changed."
                        rows={5}
                        required
                    />
                    <p className="text-xs text-muted-foreground">
                        Sent to the room as the first message when this job runs.
                    </p>
                </div>
                <div className="space-y-3">
                    <div className="space-y-1.5">
                        <Label>Schedule</Label>
                        <ButtonGroup className="w-full" aria-label="Schedule type">
                            {scheduleTypes.map((option) => (
                                <Button
                                    key={option.value}
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    data-active={schedule.type === option.value}
                                    aria-pressed={schedule.type === option.value}
                                    className={groupedOptionClass}
                                    onClick={() =>
                                        setSchedule(
                                            scheduleForType(option.value as JobSchedule['type']),
                                        )
                                    }
                                >
                                    {option.label}
                                </Button>
                            ))}
                        </ButtonGroup>
                    </div>

                    <ScheduleEditor schedule={schedule} onChange={setSchedule} />

                    <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
                        <p className="font-medium text-foreground">
                            {describeJobSchedule(normalizedSchedule)}
                            {scheduleUsesTimezone(normalizedSchedule) ? `, ${timezone}` : ''}
                        </p>
                        <p className="mt-1">
                            Each run starts a fresh session in this room with the instruction above.
                        </p>
                    </div>
                </div>

                <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                    <CollapsibleTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="-ml-2 text-muted-foreground"
                        >
                            <ChevronDownIcon
                                className={
                                    advancedOpen
                                        ? 'rotate-180 transition-transform'
                                        : 'transition-transform'
                                }
                            />
                            Advanced
                        </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-1.5 pt-2">
                        <Label className="flex items-center gap-1.5">
                            <ClockIcon className="size-3.5" />
                            Time zone
                        </Label>
                        <div className="rounded-md border border-border/60 p-3 text-sm">
                            <p className="font-medium text-foreground">{timezone}</p>
                            <p className="mt-1 text-muted-foreground">
                                Times above run in this room&apos;s time zone. Change it in{' '}
                                <Link
                                    to="/rooms/$roomId/settings"
                                    params={{ roomId }}
                                    className="font-medium text-foreground underline underline-offset-2"
                                >
                                    room settings
                                </Link>
                                .
                            </p>
                        </div>
                    </CollapsibleContent>
                </Collapsible>
            </div>
            <SheetFooter className="border-t border-border/60">
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
                        Cancel
                    </Button>
                    <Button type="submit" disabled={!valid || pending}>
                        {pending ? <Loader2Icon className="animate-spin" /> : null}
                        {submitLabel}
                    </Button>
                </div>
            </SheetFooter>
        </form>
    )
}

function scheduleForType(type: JobSchedule['type']): JobSchedule {
    if (type === 'interval') {
        return {
            type: 'interval',
            every: 1,
            unit: 'hours',
        }
    }
    if (type === 'weekly') {
        return {
            type: 'weekly',
            weekdays: [1],
            time: '09:00',
        }
    }
    if (type === 'monthly') {
        return {
            type: 'monthly',
            day: 1,
            time: '09:00',
        }
    }
    return defaultJobSchedule
}

function scheduleUsesTimezone(schedule: JobSchedule): boolean {
    return schedule.type !== 'interval'
}

function jobScheduleValid(schedule: JobSchedule): boolean {
    const normalized = normalizeJobSchedule(schedule)
    if (normalized.type === 'interval') return normalized.every > 0
    if (normalized.type === 'daily') return normalized.times.length > 0
    if (normalized.type === 'weekly') return normalized.weekdays.length > 0
    return normalized.day > 0
}

function ScheduleEditor({
    schedule,
    onChange,
}: {
    schedule: JobSchedule
    onChange: (schedule: JobSchedule) => void
}) {
    if (schedule.type === 'interval') {
        return (
            <div className="grid grid-cols-[minmax(0,1fr)_9rem] gap-2">
                <div className="space-y-1.5">
                    <Label htmlFor="job-interval-every">Every</Label>
                    <Input
                        id="job-interval-every"
                        type="number"
                        min={1}
                        value={schedule.every}
                        onChange={(e) =>
                            onChange({
                                ...schedule,
                                every: Math.max(1, Number(e.target.value) || 1),
                            })
                        }
                    />
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="job-interval-unit">Unit</Label>
                    <Select
                        value={schedule.unit}
                        onValueChange={(unit) =>
                            onChange({
                                ...schedule,
                                unit: unit as IntervalUnit,
                            })
                        }
                    >
                        <SelectTrigger id="job-interval-unit" className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {intervalUnits.map((unit) => (
                                <SelectItem key={unit.value} value={unit.value}>
                                    {unit.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>
        )
    }

    if (schedule.type === 'daily') {
        return (
            <div className="space-y-2">
                <Label>Times</Label>
                <div className="space-y-2">
                    {schedule.times.map((time, index) => (
                        <div key={`${time}-${index}`} className="flex items-center gap-2">
                            <Input
                                type="time"
                                value={time}
                                onChange={(e) => {
                                    const times = [...schedule.times]
                                    times[index] = e.target.value
                                    onChange({ ...schedule, times })
                                }}
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                disabled={schedule.times.length === 1}
                                onClick={() =>
                                    onChange({
                                        ...schedule,
                                        times: schedule.times.filter(
                                            (_, itemIndex) => itemIndex !== index,
                                        ),
                                    })
                                }
                                aria-label="Remove time"
                            >
                                <XIcon />
                            </Button>
                        </div>
                    ))}
                </div>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={schedule.times.length >= 8}
                    onClick={() => onChange({ ...schedule, times: [...schedule.times, '09:00'] })}
                >
                    <PlusIcon />
                    Add time
                </Button>
            </div>
        )
    }

    if (schedule.type === 'weekly') {
        return (
            <div className="space-y-3">
                <div className="space-y-1.5">
                    <Label>Days</Label>
                    <ButtonGroup className="w-full" aria-label="Weekdays">
                        {weekDays.map((day) => (
                            <Button
                                key={day.value}
                                type="button"
                                variant="ghost"
                                size="sm"
                                data-active={schedule.weekdays.includes(day.value)}
                                aria-pressed={schedule.weekdays.includes(day.value)}
                                className={groupedOptionClass}
                                onClick={() => {
                                    const selected = schedule.weekdays.includes(day.value)
                                    if (selected && schedule.weekdays.length === 1) return
                                    onChange({
                                        ...schedule,
                                        weekdays: selected
                                            ? schedule.weekdays.filter(
                                                  (value) => value !== day.value,
                                              )
                                            : [...schedule.weekdays, day.value],
                                    })
                                }}
                            >
                                {day.short}
                            </Button>
                        ))}
                    </ButtonGroup>
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="job-weekly-time">Time</Label>
                    <Input
                        id="job-weekly-time"
                        type="time"
                        value={schedule.time}
                        onChange={(e) => onChange({ ...schedule, time: e.target.value })}
                    />
                </div>
            </div>
        )
    }

    return (
        <div className="grid grid-cols-[minmax(0,1fr)_9rem] gap-2">
            <div className="space-y-1.5">
                <Label htmlFor="job-monthly-day">Day of month</Label>
                <Input
                    id="job-monthly-day"
                    type="number"
                    min={1}
                    max={31}
                    value={schedule.day}
                    onChange={(e) =>
                        onChange({
                            ...schedule,
                            day: Math.min(31, Math.max(1, Number(e.target.value) || 1)),
                        })
                    }
                />
            </div>
            <div className="space-y-1.5">
                <Label htmlFor="job-monthly-time">Time</Label>
                <Input
                    id="job-monthly-time"
                    type="time"
                    value={schedule.time}
                    onChange={(e) => onChange({ ...schedule, time: e.target.value })}
                />
            </div>
        </div>
    )
}
