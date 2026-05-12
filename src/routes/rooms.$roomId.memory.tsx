import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { BrainIcon, PlusIcon, SaveIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'
import { RoomDashboardLayout } from '#/components/room-dashboard'
import { EmptyState, LoadingRows, Section } from '#/components/agent-room'
import { getRoomMemoryServer, updateRoomMemoryServer } from '#/routes/-room-runtime-server'

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

type MemorySectionKey =
    | 'identity.responsibilities'
    | 'identity.boundaries'
    | 'operator.facts'
    | 'operator.preferences'
    | 'behavior.rules'
    | 'behavior.communication'
    | 'currentWork.goals'
    | 'currentWork.projects'
    | 'currentWork.context'
    | 'schedule.reminders'
    | 'schedule.deadlines'
    | 'schedule.recurring'
    | 'decisions'
    | 'doNotForget'

type MemorySectionDefinition = {
    key: MemorySectionKey
    title: string
    description: string
    placeholder: string
}

const memorySections: MemorySectionDefinition[] = [
    {
        key: 'identity.responsibilities',
        title: 'Responsibilities',
        description: 'What this room should take care of.',
        placeholder: 'Remember what this room is responsible for...',
    },
    {
        key: 'identity.boundaries',
        title: 'Boundaries',
        description: 'Limits the room should respect.',
        placeholder: 'Add a boundary this room should not cross...',
    },
    {
        key: 'operator.facts',
        title: 'Operator facts',
        description: 'Stable facts about the person using this room.',
        placeholder: 'Add a stable fact about the operator...',
    },
    {
        key: 'operator.preferences',
        title: 'Operator preferences',
        description: 'How the operator likes work to be handled.',
        placeholder: 'Add a preference to remember...',
    },
    {
        key: 'behavior.rules',
        title: 'Behavior rules',
        description: 'Standing instructions for the room.',
        placeholder: 'Add a behavior rule...',
    },
    {
        key: 'behavior.communication',
        title: 'Communication',
        description: 'How the room should communicate.',
        placeholder: 'Add a communication preference...',
    },
    {
        key: 'currentWork.goals',
        title: 'Current goals',
        description: 'Outcomes currently in progress.',
        placeholder: 'Add a current goal...',
    },
    {
        key: 'currentWork.projects',
        title: 'Projects',
        description: 'Active project context.',
        placeholder: 'Add project context...',
    },
    {
        key: 'currentWork.context',
        title: 'Context',
        description: 'Short-lived context that still matters.',
        placeholder: 'Add current context...',
    },
    {
        key: 'schedule.reminders',
        title: 'Reminders',
        description: 'Things the room should bring back later.',
        placeholder: 'Add a reminder...',
    },
    {
        key: 'schedule.deadlines',
        title: 'Deadlines',
        description: 'Important dates and time-bound commitments.',
        placeholder: 'Add a deadline...',
    },
    {
        key: 'schedule.recurring',
        title: 'Recurring',
        description: 'Repeated routines or recurring work.',
        placeholder: 'Add recurring work...',
    },
    {
        key: 'decisions',
        title: 'Decisions',
        description: 'Decisions that should not need to be re-made.',
        placeholder: 'Add a decision...',
    },
    {
        key: 'doNotForget',
        title: 'Do not forget',
        description: 'Important memory that should stay visible.',
        placeholder: 'Add something important...',
    },
]

export const Route = createFileRoute('/rooms/$roomId/memory')({
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

function cloneMemory(memory: RoomMemory): RoomMemory {
    return JSON.parse(JSON.stringify(memory)) as RoomMemory
}

function getSectionItems(memory: RoomMemory, key: MemorySectionKey): MemoryItem[] {
    switch (key) {
        case 'identity.responsibilities':
            return memory.identity.responsibilities
        case 'identity.boundaries':
            return memory.identity.boundaries
        case 'operator.facts':
            return memory.operator.facts
        case 'operator.preferences':
            return memory.operator.preferences
        case 'behavior.rules':
            return memory.behavior.rules
        case 'behavior.communication':
            return memory.behavior.communication
        case 'currentWork.goals':
            return memory.currentWork.goals
        case 'currentWork.projects':
            return memory.currentWork.projects
        case 'currentWork.context':
            return memory.currentWork.context
        case 'schedule.reminders':
            return memory.schedule.reminders
        case 'schedule.deadlines':
            return memory.schedule.deadlines
        case 'schedule.recurring':
            return memory.schedule.recurring
        case 'decisions':
            return memory.decisions
        case 'doNotForget':
            return memory.doNotForget
    }
}

function withSectionItems(
    memory: RoomMemory,
    key: MemorySectionKey,
    items: MemoryItem[],
): RoomMemory {
    const next = cloneMemory(memory)
    switch (key) {
        case 'identity.responsibilities':
            next.identity.responsibilities = items
            break
        case 'identity.boundaries':
            next.identity.boundaries = items
            break
        case 'operator.facts':
            next.operator.facts = items
            break
        case 'operator.preferences':
            next.operator.preferences = items
            break
        case 'behavior.rules':
            next.behavior.rules = items
            break
        case 'behavior.communication':
            next.behavior.communication = items
            break
        case 'currentWork.goals':
            next.currentWork.goals = items
            break
        case 'currentWork.projects':
            next.currentWork.projects = items
            break
        case 'currentWork.context':
            next.currentWork.context = items
            break
        case 'schedule.reminders':
            next.schedule.reminders = items
            break
        case 'schedule.deadlines':
            next.schedule.deadlines = items
            break
        case 'schedule.recurring':
            next.schedule.recurring = items
            break
        case 'decisions':
            next.decisions = items
            break
        case 'doNotForget':
            next.doNotForget = items
            break
    }
    return next
}

function createMemoryItem(): MemoryItem {
    return {
        id: crypto.randomUUID(),
        text: '',
        createdAt: new Date().toISOString(),
        source: 'operator',
    }
}

function normaliseMemoryForSave(memory: RoomMemory): RoomMemory {
    let next = cloneMemory(memory)
    next.identity.role = next.identity.role.trim()
    for (const section of memorySections) {
        next = withSectionItems(
            next,
            section.key,
            getSectionItems(next, section.key)
                .map((item) => ({
                    ...item,
                    text: item.text.trim(),
                }))
                .filter((item) => item.text.length > 0),
        )
    }
    return next
}

function updateItemText(
    memory: RoomMemory,
    key: MemorySectionKey,
    itemId: string,
    text: string,
): RoomMemory {
    const items = getSectionItems(memory, key).map((item) =>
        item.id === itemId ? { ...item, text, updatedAt: new Date().toISOString() } : item,
    )
    return withSectionItems(memory, key, items)
}

function addItem(memory: RoomMemory, key: MemorySectionKey): RoomMemory {
    return withSectionItems(memory, key, [...getSectionItems(memory, key), createMemoryItem()])
}

function deleteItem(memory: RoomMemory, key: MemorySectionKey, itemId: string): RoomMemory {
    return withSectionItems(
        memory,
        key,
        getSectionItems(memory, key).filter((item) => item.id !== itemId),
    )
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
    const [draftMemory, setDraftMemory] = useState<RoomMemory | null>(null)

    useEffect(() => {
        if (memory) {
            setDraftMemory(cloneMemory(memory))
        }
    }, [memory])

    const dirty = useMemo(() => {
        if (!memory || !draftMemory) return false
        return (
            JSON.stringify(normaliseMemoryForSave(draftMemory)) !==
            JSON.stringify(normaliseMemoryForSave(memory))
        )
    }, [memory, draftMemory])

    const saveMutation = useMutation({
        mutationFn: () => {
            if (!draftMemory) {
                throw new Error('Memory is not loaded yet')
            }
            return updateRoomMemoryServer({
                data: {
                    roomId,
                    memory: normaliseMemoryForSave(draftMemory),
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

    if (memoryQuery.isError || !memory || !draftMemory) {
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
        <div className="mx-auto w-full max-w-6xl">
            <Section
                title="Memory"
                description="Edit what this room remembers as plain-language entries."
                actions={
                    <Button
                        size="sm"
                        onClick={() => saveMutation.mutate()}
                        disabled={!dirty || saveMutation.isPending}
                    >
                        <SaveIcon />
                        Save memory
                    </Button>
                }
            >
                <div className="grid gap-4">
                    <RoleEditor
                        value={draftMemory.identity.role}
                        onChange={(role) =>
                            setDraftMemory((current) =>
                                current
                                    ? {
                                          ...current,
                                          identity: {
                                              ...current.identity,
                                              role,
                                          },
                                      }
                                    : current,
                            )
                        }
                    />
                    <div className="grid gap-3 md:grid-cols-2">
                        {memorySections.map((section) => (
                            <EditableMemorySection
                                key={section.key}
                                section={section}
                                items={getSectionItems(draftMemory, section.key)}
                                onAdd={() =>
                                    setDraftMemory((current) =>
                                        current ? addItem(current, section.key) : current,
                                    )
                                }
                                onDelete={(itemId) =>
                                    setDraftMemory((current) =>
                                        current
                                            ? deleteItem(current, section.key, itemId)
                                            : current,
                                    )
                                }
                                onChange={(itemId, text) =>
                                    setDraftMemory((current) =>
                                        current
                                            ? updateItemText(current, section.key, itemId, text)
                                            : current,
                                    )
                                }
                            />
                        ))}
                    </div>
                </div>
            </Section>
        </div>
    )
}

function RoleEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    return (
        <div className="rounded-lg border border-border/60 bg-card p-4">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h2 className="text-sm font-semibold text-foreground">Room identity</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                        The short role description used to introduce this room to the agent.
                    </p>
                </div>
            </div>
            <Textarea
                value={value}
                onChange={(event) => onChange(event.target.value)}
                className="mt-3 min-h-20 resize-y"
                placeholder="Describe who this room is and what it should generally do..."
            />
        </div>
    )
}

function EditableMemorySection({
    section,
    items,
    onAdd,
    onDelete,
    onChange,
}: {
    section: MemorySectionDefinition
    items: MemoryItem[]
    onAdd: () => void
    onDelete: (itemId: string) => void
    onChange: (itemId: string, text: string) => void
}) {
    return (
        <div className="rounded-lg border border-border/60 bg-card p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-foreground">{section.title}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">{section.description}</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={onAdd}>
                    <PlusIcon />
                    Add
                </Button>
            </div>
            {items.length === 0 ? (
                <p className="mt-4 rounded-md border border-dashed border-border/70 px-3 py-4 text-sm text-muted-foreground">
                    No entries yet.
                </p>
            ) : (
                <ul className="mt-4 space-y-3">
                    {items.map((item) => (
                        <li key={item.id} className="flex items-start gap-2">
                            <Textarea
                                value={item.text}
                                onChange={(event) => onChange(item.id, event.target.value)}
                                className="min-h-16 flex-1 resize-y"
                                placeholder={section.placeholder}
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Delete ${section.title} memory`}
                                onClick={() => onDelete(item.id)}
                            >
                                <Trash2Icon />
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}
