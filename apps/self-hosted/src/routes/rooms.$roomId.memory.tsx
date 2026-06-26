import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
    BotIcon,
    BrainIcon,
    LockIcon,
    PlusIcon,
    RepeatIcon,
    Trash2Icon,
    UserIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Textarea } from '#/components/ui/textarea'
import { Progress } from '#/components/ui/progress'
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from '#/components/ui/accordion'
import { RoomDashboardLayout } from '#/components/room-dashboard'
import {
    AttentionBanner,
    EmptyState,
    LoadingRows,
    ProvenanceChip,
    SaveBar,
    Section,
} from '#/components/agent-room'
import { cn } from '#/lib/utils'
import { roomQueryKey, roomQueryPolicy } from '#/lib/room-query-keys'
import {
    canonicalMemoryJson,
    maxMemoryBytes,
    maxSectionItems,
    memoryGroups,
    memorySectionPaths,
    nowIso,
    sectionItems,
    setSectionItems,
    timedSections,
    type MemoryItem,
    type MemorySectionMeta,
    type MemorySectionPath,
    type RoomMemory,
    type TimedMemoryItem,
} from '#/domain/room-memory'
import {
    getRoomMemoryServer,
    listRoomsServer,
    updateRoomMemoryServer,
} from '#/routes/-room-runtime-server'
import { IdentitySection } from '#/routes/-room-settings/identity-section'
import { PersonalitySection } from '#/routes/-room-settings/personality-section'

export const Route = createFileRoute('/rooms/$roomId/memory')({
    component: RoomMemoryPage,
})

function RoomMemoryPage() {
    const { roomId } = Route.useParams()
    return (
        <RoomDashboardLayout roomId={roomId} activeTab="memory">
            <IdentityAndMemory roomId={roomId} />
        </RoomDashboardLayout>
    )
}

function cloneMemory(memory: RoomMemory): RoomMemory {
    return structuredClone(memory)
}

function createItem(): MemoryItem {
    return {
        id: crypto.randomUUID(),
        text: '',
        createdAt: nowIso(),
        source: 'operator',
    }
}

function normaliseForSave(memory: RoomMemory): RoomMemory {
    let next: RoomMemory = {
        ...memory,
        identity: { ...memory.identity, role: memory.identity.role.trim() },
    }
    for (const path of memorySectionPaths) {
        const items = sectionItems(next, path)
            .map((item) => ({ ...item, text: item.text.trim() }))
            .filter((item) => item.text.length > 0)
        next = setSectionItems(next, path, items)
    }
    return next
}

function patchItem(
    memory: RoomMemory,
    path: MemorySectionPath,
    id: string,
    patch: Partial<TimedMemoryItem>,
): RoomMemory {
    const items = sectionItems(memory, path).map((item) =>
        item.id === id ? { ...item, ...patch, updatedAt: nowIso() } : item,
    )
    return setSectionItems(memory, path, items)
}

function isoToLocalInput(iso?: string): string {
    if (!iso) return ''
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return ''
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
        date.getHours(),
    )}:${pad(date.getMinutes())}`
}

function localInputToIso(value: string): string | undefined {
    if (!value) return undefined
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return undefined
    return date.toISOString()
}

type Provenance = { label: string; icon: typeof UserIcon; locked: boolean }

function provenanceFor(source: string | undefined): Provenance {
    if (source === 'system') return { label: 'System', icon: LockIcon, locked: true }
    if (source === 'agent') return { label: 'From this room', icon: BotIcon, locked: false }
    return { label: 'You', icon: UserIcon, locked: false }
}

function IdentityAndMemory({ roomId }: { roomId: string }) {
    const roomsQuery = useQuery({
        queryKey: roomQueryKey.roomsList,
        queryFn: () => listRoomsServer(),
        staleTime: roomQueryPolicy.warmStaleMs,
    })
    const queryClient = useQueryClient()
    const room = roomsQuery.data?.find((entry) => entry.roomId === roomId) ?? null

    return (
        <div className="flex w-full flex-col gap-6">
            <Section
                title="Identity and memory"
                description="Shape who this room is and what it remembers. Think of it as a brief for a coworker who keeps notes of their own."
            >
                <p className="text-sm text-muted-foreground">
                    This room also updates its own memory as it works. Your edits and its notes
                    share the same brief.
                </p>
            </Section>

            <IdentitySection
                roomId={roomId}
                loading={roomsQuery.isLoading}
                defaultDisplayName={room?.displayName ?? ''}
                defaultSlug={room?.slug ?? ''}
                onSaved={async () => {
                    await queryClient.invalidateQueries({ queryKey: roomQueryKey.roomsList })
                }}
            />

            <PersonalitySection roomId={roomId} />

            <MemoryEditor roomId={roomId} />
        </div>
    )
}

function MemoryEditor({ roomId }: { roomId: string }) {
    const queryClient = useQueryClient()
    const memoryQuery = useQuery({
        queryKey: roomQueryKey.roomMemory(roomId),
        queryFn: () => getRoomMemoryServer({ data: { roomId } }),
        staleTime: roomQueryPolicy.hotStaleMs,
    })
    const serverMemory = (memoryQuery.data?.memory as RoomMemory | undefined) ?? null
    const serverHash = typeof memoryQuery.data?.hash === 'string' ? memoryQuery.data.hash : null

    const [draft, setDraft] = useState<RoomMemory | null>(null)
    const [baseline, setBaseline] = useState<RoomMemory | null>(null)
    const [baselineHash, setBaselineHash] = useState<string | null>(null)
    const [conflict, setConflict] = useState<{ memory: RoomMemory; hash: string } | null>(null)

    const adopt = useCallback((memory: RoomMemory, hash: string) => {
        setDraft(cloneMemory(memory))
        setBaseline(cloneMemory(memory))
        setBaselineHash(hash)
        setConflict(null)
    }, [])

    const normalisedDraft = useMemo(() => (draft ? normaliseForSave(draft) : null), [draft])
    const normalisedBaseline = useMemo(
        () => (baseline ? normaliseForSave(baseline) : null),
        [baseline],
    )
    const dirty = useMemo(() => {
        if (!normalisedDraft || !normalisedBaseline) return false
        return JSON.stringify(normalisedDraft) !== JSON.stringify(normalisedBaseline)
    }, [normalisedDraft, normalisedBaseline])

    useEffect(() => {
        if (!serverMemory || !serverHash) return
        if (serverHash === baselineHash) return
        if (!draft || !dirty) {
            adopt(serverMemory, serverHash)
            return
        }
        setConflict({ memory: serverMemory, hash: serverHash })
    }, [serverMemory, serverHash, baselineHash, draft, dirty, adopt])

    const saveMutation = useMutation({
        mutationFn: () => {
            if (!draft) throw new Error('Memory is not loaded yet')
            return updateRoomMemoryServer({
                data: {
                    roomId,
                    memory: normaliseForSave(draft),
                    expectedHash: baselineHash,
                },
            })
        },
        onSuccess: async (result) => {
            adopt(result.memory as RoomMemory, result.hash)
            await queryClient.invalidateQueries({ queryKey: roomQueryKey.roomMemory(roomId) })
            toast.success('Memory saved')
        },
        onError: async (error: unknown) => {
            const message = error instanceof Error ? error.message : 'Unexpected error'
            if (message.includes('changed before update')) {
                await queryClient.invalidateQueries({ queryKey: roomQueryKey.roomMemory(roomId) })
                return
            }
            toast.error('Could not save memory', { description: message })
        },
    })

    const bytes = useMemo(
        () =>
            normalisedDraft
                ? new TextEncoder().encode(canonicalMemoryJson(normalisedDraft)).length
                : 0,
        [normalisedDraft],
    )
    const overBudget = bytes > maxMemoryBytes
    const oversizeSections = useMemo(() => {
        if (!normalisedDraft) return []
        return memorySectionPaths.filter(
            (path) => sectionItems(normalisedDraft, path).length > maxSectionItems,
        )
    }, [normalisedDraft])

    if (memoryQuery.isLoading || !draft) {
        if (memoryQuery.isError) {
            return (
                <Section title="Memory">
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
            )
        }
        return (
            <Section title="Memory">
                <LoadingRows count={5} />
            </Section>
        )
    }

    const updateItems = (mutate: (memory: RoomMemory) => RoomMemory) => {
        setDraft((current) => (current ? mutate(current) : current))
    }

    return (
        <Section
            title="Memory"
            description="Plain-language notes this room keeps across sessions and scheduled tasks."
            bodyClassName="space-y-5 p-4"
        >
            {conflict ? (
                <AttentionBanner
                    tone="attention"
                    title="This room updated its own memory"
                    description="It saved new notes while you were editing. Load the latest brief to keep working from the current version. This discards your unsaved edits."
                    action={
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => adopt(conflict.memory, conflict.hash)}
                        >
                            Load latest
                        </Button>
                    }
                />
            ) : null}

            <RoleEditor
                value={draft.identity.role}
                onChange={(role) =>
                    setDraft((current) =>
                        current ? { ...current, identity: { ...current.identity, role } } : current,
                    )
                }
            />

            <BudgetMeter
                bytes={bytes}
                overBudget={overBudget}
                oversizeSections={oversizeSections}
            />

            <Accordion type="multiple" className="gap-2">
                {memoryGroups.map((group) => {
                    const count = group.sections.reduce(
                        (total, meta) => total + sectionItems(draft, meta.path).length,
                        0,
                    )
                    return (
                        <AccordionItem
                            key={group.id}
                            value={group.id}
                            className="rounded-lg border border-border/60 not-last:border-b"
                        >
                            <AccordionTrigger className="px-3">
                                <span className="flex min-w-0 flex-col gap-0.5">
                                    <span className="truncate">{group.title}</span>
                                    <span className="text-xs font-normal text-muted-foreground">
                                        {group.description}
                                    </span>
                                </span>
                                <span className="mr-2 shrink-0 self-center text-xs font-normal text-muted-foreground">
                                    {count}
                                </span>
                            </AccordionTrigger>
                            <AccordionContent className="space-y-4 px-3">
                                {group.sections.map((meta) => (
                                    <MemorySectionEditor
                                        key={meta.path}
                                        meta={meta}
                                        items={sectionItems(draft, meta.path)}
                                        onAdd={() =>
                                            updateItems((memory) =>
                                                setSectionItems(memory, meta.path, [
                                                    ...sectionItems(memory, meta.path),
                                                    createItem(),
                                                ]),
                                            )
                                        }
                                        onPatch={(id, patch) =>
                                            updateItems((memory) =>
                                                patchItem(memory, meta.path, id, patch),
                                            )
                                        }
                                        onDelete={(id) =>
                                            updateItems((memory) =>
                                                setSectionItems(
                                                    memory,
                                                    meta.path,
                                                    sectionItems(memory, meta.path).filter(
                                                        (item) => item.id !== id,
                                                    ),
                                                ),
                                            )
                                        }
                                    />
                                ))}
                            </AccordionContent>
                        </AccordionItem>
                    )
                })}
            </Accordion>

            <SaveBar
                className="mx-0 sm:mx-0"
                dirty={dirty}
                saving={saveMutation.isPending}
                onSave={() => {
                    if (overBudget) {
                        toast.error('Memory is over the size limit', {
                            description: 'Remove some entries before saving to avoid losing notes.',
                        })
                        return
                    }
                    saveMutation.mutate()
                }}
                onRevert={() => {
                    if (baseline && baselineHash) adopt(baseline, baselineHash)
                }}
                saveLabel="Save memory"
            />
        </Section>
    )
}

function RoleEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    return (
        <div className="space-y-1.5">
            <Label htmlFor="memory-role">One-line role</Label>
            <Textarea
                id="memory-role"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                className="min-h-20 resize-y"
                placeholder="Describe who this room is and what it should generally do..."
            />
            <p className="text-xs text-muted-foreground">
                The short introduction this room leads with.
            </p>
        </div>
    )
}

function BudgetMeter({
    bytes,
    overBudget,
    oversizeSections,
}: {
    bytes: number
    overBudget: boolean
    oversizeSections: MemorySectionPath[]
}) {
    const percent = Math.min(100, Math.round((bytes / maxMemoryBytes) * 100))
    const near = !overBudget && percent >= 85
    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Memory size</span>
                <span>
                    {Math.round(bytes / 1000)}k / {Math.round(maxMemoryBytes / 1000)}k
                </span>
            </div>
            <Progress
                value={percent}
                className={cn(overBudget && '[&>[data-slot=progress-indicator]]:bg-danger')}
            />
            {overBudget ? (
                <AttentionBanner
                    tone="danger"
                    title="Memory is over the size limit"
                    description="Saving now would let maintenance drop the lowest-priority notes. Remove some entries first."
                />
            ) : null}
            {near ? (
                <p className="text-xs text-attention-fg">
                    Memory is close to its size limit. Keep notes concise.
                </p>
            ) : null}
            {oversizeSections.length > 0 ? (
                <p className="text-xs text-attention-fg">
                    Some sections have more than {maxSectionItems} entries and may be trimmed.
                </p>
            ) : null}
        </div>
    )
}

function MemorySectionEditor({
    meta,
    items,
    onAdd,
    onPatch,
    onDelete,
}: {
    meta: MemorySectionMeta
    items: Array<MemoryItem | TimedMemoryItem>
    onAdd: () => void
    onPatch: (id: string, patch: Partial<TimedMemoryItem>) => void
    onDelete: (id: string) => void
}) {
    const timed = timedSections.has(meta.path)
    const recurring = meta.path === 'schedule.recurring'
    return (
        <div className="rounded-lg border border-border/50 bg-background/40 p-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-sm font-medium text-foreground">{meta.title}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">{meta.description}</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={onAdd}>
                    <PlusIcon />
                    Add
                </Button>
            </div>
            {items.length === 0 ? (
                <p className="mt-3 text-xs text-muted-foreground">
                    Nothing here yet. This room fills it in as it works, or you can add a note.
                </p>
            ) : (
                <ul className="mt-3 space-y-3">
                    {items.map((item) => (
                        <MemoryItemRow
                            key={item.id}
                            item={item}
                            placeholder={meta.placeholder}
                            timed={timed}
                            recurring={recurring}
                            onPatch={(patch) => onPatch(item.id, patch)}
                            onDelete={() => onDelete(item.id)}
                        />
                    ))}
                </ul>
            )}
        </div>
    )
}

function MemoryItemRow({
    item,
    placeholder,
    timed,
    recurring,
    onPatch,
    onDelete,
}: {
    item: MemoryItem | TimedMemoryItem
    placeholder: string
    timed: boolean
    recurring: boolean
    onPatch: (patch: Partial<TimedMemoryItem>) => void
    onDelete: () => void
}) {
    const provenance = provenanceFor(item.source)
    const ProvenanceIcon = provenance.icon
    const dueAt = 'dueAt' in item ? item.dueAt : undefined
    const recurrenceRule = 'recurrence' in item ? item.recurrence?.rule : undefined
    return (
        <li className="rounded-md border border-border/50 bg-card p-2.5">
            <div className="flex items-start gap-2">
                <Textarea
                    value={item.text}
                    onChange={(event) => onPatch({ text: event.target.value })}
                    className="min-h-16 flex-1 resize-y"
                    placeholder={placeholder}
                    disabled={provenance.locked}
                />
                {provenance.locked ? null : (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Delete memory entry"
                        onClick={onDelete}
                    >
                        <Trash2Icon />
                    </Button>
                )}
            </div>
            {timed ? (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                        <Label className="text-xs" htmlFor={`due-${item.id}`}>
                            Due
                        </Label>
                        <Input
                            id={`due-${item.id}`}
                            type="datetime-local"
                            value={isoToLocalInput(dueAt)}
                            disabled={provenance.locked}
                            onChange={(event) =>
                                onPatch({ dueAt: localInputToIso(event.target.value) })
                            }
                        />
                    </div>
                    {recurring ? (
                        <div className="space-y-1">
                            <Label className="text-xs" htmlFor={`recurrence-${item.id}`}>
                                Repeats
                            </Label>
                            <Input
                                id={`recurrence-${item.id}`}
                                value={recurrenceRule ?? ''}
                                disabled={provenance.locked}
                                placeholder="e.g. every Monday 9am"
                                onChange={(event) =>
                                    onPatch({
                                        recurrence: event.target.value
                                            ? { rule: event.target.value }
                                            : undefined,
                                    })
                                }
                            />
                        </div>
                    ) : null}
                </div>
            ) : null}
            <div className="mt-2 flex items-center gap-2">
                <ProvenanceChip icon={<ProvenanceIcon />}>{provenance.label}</ProvenanceChip>
                {recurring && recurrenceRule ? (
                    <ProvenanceChip icon={<RepeatIcon />}>Recurring</ProvenanceChip>
                ) : null}
                {provenance.locked ? (
                    <span className="text-xs text-muted-foreground">
                        Safety note. Protected from edits.
                    </span>
                ) : null}
            </div>
        </li>
    )
}
