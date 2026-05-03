import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { BrainIcon, SaveIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'
import { RoomDashboardLayout } from '#/components/room-dashboard'
import { EmptyState, LoadingRows, Section } from '#/components/agent-room'
import { getRoomMemoryServer, updateRoomMemoryServer } from '#/routes/-room-runtime-server'
import { requireRouteUser } from '#/routes/-route-auth'

type MemoryItem = {
    id: string
    text: string
    createdAt: string
    updatedAt?: string
    source?: string
    priority?: number
    tags?: string[]
    dueAt?: string
    expiresAt?: string
    completedAt?: string
}

type RoomMemory = {
    version: 1
    identity: {
        role: string
        responsibilities: MemoryItem[]
        boundaries: MemoryItem[]
    }
    operator: {
        facts: MemoryItem[]
        preferences: MemoryItem[]
    }
    behavior: {
        rules: MemoryItem[]
        communication: MemoryItem[]
    }
    currentWork: {
        goals: MemoryItem[]
        projects: MemoryItem[]
        context: MemoryItem[]
    }
    schedule: {
        reminders: MemoryItem[]
        deadlines: MemoryItem[]
        recurring: MemoryItem[]
    }
    decisions: MemoryItem[]
    doNotForget: MemoryItem[]
}

export const Route = createFileRoute('/rooms/$roomId/memory')({
    beforeLoad: requireRouteUser,
    component: RoomMemoryPage,
})

function RoomMemoryPage() {
    const { roomId } = Route.useParams()
    return (
        <RoomDashboardLayout roomId={roomId} activeTab="memory">
            <MemoryContent roomId={roomId} />
        </RoomDashboardLayout>
    )
}

function sectionRows(memory: RoomMemory | null): Array<{
    title: string
    items: MemoryItem[]
}> {
    if (!memory) return []
    return [
        { title: 'Responsibilities', items: memory.identity.responsibilities },
        { title: 'Boundaries', items: memory.identity.boundaries },
        { title: 'Operator Facts', items: memory.operator.facts },
        { title: 'Operator Preferences', items: memory.operator.preferences },
        { title: 'Behavior Rules', items: memory.behavior.rules },
        { title: 'Communication', items: memory.behavior.communication },
        { title: 'Current Goals', items: memory.currentWork.goals },
        { title: 'Projects', items: memory.currentWork.projects },
        { title: 'Context', items: memory.currentWork.context },
        { title: 'Reminders', items: memory.schedule.reminders },
        { title: 'Deadlines', items: memory.schedule.deadlines },
        { title: 'Recurring', items: memory.schedule.recurring },
        { title: 'Decisions', items: memory.decisions },
        { title: 'Do Not Forget', items: memory.doNotForget },
    ]
}

function MemoryContent({ roomId }: { roomId: string }) {
    const queryClient = useQueryClient()
    const memoryQuery = useQuery({
        queryKey: ['room-memory', roomId],
        queryFn: () => getRoomMemoryServer({ data: { roomId } }),
        staleTime: 5_000,
    })
    const memory = memoryQuery.data?.memory as RoomMemory | undefined
    const memoryHash = typeof memoryQuery.data?.hash === 'string' ? memoryQuery.data.hash : null
    const [jsonText, setJsonText] = useState('')
    const [jsonError, setJsonError] = useState<string | null>(null)

    useEffect(() => {
        if (memory) {
            setJsonText(JSON.stringify(memory, null, 4))
            setJsonError(null)
        }
    }, [memory])

    const rows = useMemo(() => sectionRows(memory ?? null), [memory])
    const saveMutation = useMutation({
        mutationFn: () => {
            let parsed: unknown
            try {
                parsed = JSON.parse(jsonText)
                setJsonError(null)
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Invalid JSON'
                setJsonError(message)
                throw new Error(message)
            }
            return updateRoomMemoryServer({
                data: {
                    roomId,
                    memory: parsed,
                    expectedHash: memoryHash,
                },
            })
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['room-memory', roomId] })
            toast.success('Memory updated')
        },
        onError: (error: unknown) => {
            toast.error('Could not update memory', {
                description: error instanceof Error ? error.message : 'Unexpected error',
            })
        },
    })

    if (memoryQuery.isLoading) {
        return (
            <div className="mx-auto w-full max-w-5xl">
                <Section title="Memory" description="Room-local persistent memory.">
                    <LoadingRows count={5} />
                </Section>
            </div>
        )
    }

    if (memoryQuery.isError || !memory) {
        return (
            <div className="mx-auto w-full max-w-5xl">
                <Section title="Memory" description="Room-local persistent memory.">
                    <EmptyState
                        icon={BrainIcon}
                        title="Could not load memory"
                        description={
                            memoryQuery.error instanceof Error
                                ? memoryQuery.error.message
                                : 'Unexpected memory error.'
                        }
                    />
                </Section>
            </div>
        )
    }

    return (
        <div className="mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-[1fr_28rem]">
            <Section
                title="Memory"
                description="Canonical room memory rendered as user-facing sections."
            >
                <div className="grid gap-3 md:grid-cols-2">
                    <MemorySection
                        title="Role"
                        items={[{ id: 'role', text: memory.identity.role, createdAt: '' }]}
                    />
                    {rows.map((row) => (
                        <MemorySection key={row.title} title={row.title} items={row.items} />
                    ))}
                </div>
            </Section>
            <Section
                title="Direct Edit"
                description="Strict JSON memory source used by the runtime prompt brief."
                actions={
                    <Button
                        size="sm"
                        onClick={() => saveMutation.mutate()}
                        disabled={saveMutation.isPending}
                    >
                        <SaveIcon />
                        Save
                    </Button>
                }
            >
                <Textarea
                    value={jsonText}
                    onChange={(event) => setJsonText(event.target.value)}
                    spellCheck={false}
                    className="min-h-[34rem] font-mono text-xs"
                />
                {jsonError ? <p className="mt-2 text-xs text-danger-fg">{jsonError}</p> : null}
            </Section>
        </div>
    )
}

function MemorySection({ title, items }: { title: string; items: MemoryItem[] }) {
    return (
        <div className="rounded-md border border-border/60 bg-card p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {title}
            </div>
            {items.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No entries.</p>
            ) : (
                <ul className="mt-2 space-y-2">
                    {items.map((item) => (
                        <li key={item.id} className="text-sm text-foreground">
                            <p>{item.text}</p>
                            <div className="mt-1 flex flex-wrap gap-1 text-[11px] text-muted-foreground">
                                {item.source ? <span>{item.source}</span> : null}
                                {typeof item.priority === 'number' ? (
                                    <span>Priority {item.priority}</span>
                                ) : null}
                                {item.dueAt ? <span>Due {item.dueAt}</span> : null}
                                {item.completedAt ? <span>Completed</span> : null}
                                {item.tags?.map((tag) => (
                                    <span key={tag}>{tag}</span>
                                ))}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}
