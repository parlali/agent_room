import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { BrainIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '#/components/ui/button'
import { AttentionBanner, EmptyState, LoadingRows, SaveBar, Section } from '#/components/agent-room'
import { roomQueryKey, roomQueryPolicy } from '#/lib/room-query-keys'
import { sanitizeRuntimeError } from '#/domain/runtime-error'
import {
    canonicalMemoryJson,
    maxMemoryBytes,
    maxSectionItems,
    memorySectionPaths,
    sectionItems,
    type RoomMemory,
} from '#/domain/room-memory'
import type { PersonalityForm } from '#/server/rooms/personality/form'
import type { RoomConfigSnapshot } from '#/server/configuration/operator-configuration'
import {
    getRoomMemoryServer,
    getRoomPersonalityServer,
    listRoomsServer,
    updateRoomIdentityServer,
    updateRoomMemoryServer,
} from '#/routes/-room-runtime-server'
import { getRoomConfigServer, saveRoomConfigServer } from '#/routes/-operator-config-server'
import {
    buildRoomConfigPayload,
    cloneMemory,
    identityEquals,
    identityVersion,
    memoryEquals,
    normaliseMemoryForSave,
    personalityEquals,
    personalityVersion,
    useDomainDraft,
    type IdentityFields,
} from './-room-memory/draft'
import {
    BudgetMeter,
    InstructionsSection,
    MemorySectionsEditor,
    PersonalityPicker,
    WhoSection,
} from './-room-memory/sections'

export const Route = createFileRoute('/rooms/$roomId/memory')({
    component: RoomMemoryPage,
})

function isMemoryConflict(message: string): boolean {
    return /changed before (update|save)/i.test(message)
}

function RoomMemoryPage() {
    const { roomId } = Route.useParams()
    return <CoworkerBrief roomId={roomId} />
}

function CoworkerBrief({ roomId }: { roomId: string }) {
    const queryClient = useQueryClient()

    const roomsQuery = useQuery({
        queryKey: roomQueryKey.roomsList,
        queryFn: () => listRoomsServer(),
        staleTime: roomQueryPolicy.warmStaleMs,
    })
    const memoryQuery = useQuery({
        queryKey: roomQueryKey.roomMemory(roomId),
        queryFn: () => getRoomMemoryServer({ data: { roomId } }),
        staleTime: roomQueryPolicy.hotStaleMs,
    })
    const personalityQuery = useQuery({
        queryKey: roomQueryKey.roomPersonality(roomId),
        queryFn: () => getRoomPersonalityServer({ data: { roomId } }),
        staleTime: roomQueryPolicy.warmStaleMs,
    })
    const configQuery = useQuery({
        queryKey: roomQueryKey.roomConfig(roomId),
        queryFn: () => getRoomConfigServer({ data: { roomId } }),
        staleTime: roomQueryPolicy.hotStaleMs,
    })

    const room = roomsQuery.data?.find((entry) => entry.roomId === roomId)
    const serverIdentity: IdentityFields | undefined = room
        ? { displayName: room.displayName, slug: room.slug ?? '' }
        : undefined
    const serverMemory = (memoryQuery.data?.memory as RoomMemory | undefined) ?? undefined
    const serverMemoryHash =
        typeof memoryQuery.data?.hash === 'string' ? memoryQuery.data.hash : null
    const serverPersonality = personalityQuery.data?.form
    const configSnapshot = (configQuery.data as RoomConfigSnapshot | undefined) ?? undefined
    const serverInstructions = configSnapshot?.config.instructions

    const identity = useDomainDraft<IdentityFields>({
        server: serverIdentity,
        version: serverIdentity ? identityVersion(serverIdentity) : null,
        clone: (value) => ({ ...value }),
        equals: identityEquals,
    })
    const memory = useDomainDraft<RoomMemory>({
        server: serverMemory,
        version: serverMemoryHash,
        clone: cloneMemory,
        equals: memoryEquals,
    })
    const personality = useDomainDraft<PersonalityForm>({
        server: serverPersonality,
        version: serverPersonality ? personalityVersion(serverPersonality) : null,
        clone: (value) => ({ ...value }),
        equals: personalityEquals,
    })
    const instructions = useDomainDraft<string>({
        server: serverInstructions,
        version: serverInstructions ?? null,
        clone: (value) => value,
        equals: (a, b) => a === b,
    })

    const normalisedMemory = useMemo(
        () => (memory ? normaliseMemoryForSave(memory.draft) : null),
        [memory],
    )
    const memoryBytes = useMemo(
        () =>
            normalisedMemory
                ? new TextEncoder().encode(canonicalMemoryJson(normalisedMemory)).length
                : 0,
        [normalisedMemory],
    )
    const overBudget = memoryBytes > maxMemoryBytes
    const oversizeSections = useMemo(() => {
        if (!normalisedMemory) return []
        return memorySectionPaths.filter(
            (path) => sectionItems(normalisedMemory, path).length > maxSectionItems,
        )
    }, [normalisedMemory])

    const saveMutation = useMutation({
        mutationFn: async () => {
            if (!memory || !personality || !identity || !instructions) {
                throw new Error('Brief is not loaded yet')
            }
            if (identity.dirty && identity.draft.displayName.trim().length === 0) {
                throw new Error('Display name is required')
            }
            if (memory.dirty && overBudget) {
                throw new Error('Memory is over the size limit')
            }
            if (memory.dirty || personality.dirty) {
                const payload: RoomMemory = {
                    ...normaliseMemoryForSave(memory.draft),
                    personality: personality.draft,
                }
                const result = await updateRoomMemoryServer({
                    data: { roomId, memory: payload, expectedHash: memory.version },
                })
                const savedMemory = result.memory as RoomMemory
                memory.commit(savedMemory, result.hash)
                const savedPersonality = savedMemory.personality ?? personality.draft
                personality.commit(savedPersonality, personalityVersion(savedPersonality))
            }
            if (identity.dirty) {
                const fields: IdentityFields = {
                    displayName: identity.draft.displayName.trim(),
                    slug: identity.draft.slug.trim(),
                }
                await updateRoomIdentityServer({
                    data: {
                        roomId,
                        displayName: fields.displayName,
                        slug: fields.slug || null,
                    },
                })
                identity.commit(fields, identityVersion(fields))
            }
            if (instructions.dirty) {
                const latest = (await getRoomConfigServer({
                    data: { roomId },
                })) as RoomConfigSnapshot
                await saveRoomConfigServer({
                    data: buildRoomConfigPayload(latest, instructions.draft),
                })
                instructions.commit(instructions.draft, instructions.draft)
            }
        },
        onSuccess: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: roomQueryKey.roomMemory(roomId) }),
                queryClient.invalidateQueries({ queryKey: roomQueryKey.roomPersonality(roomId) }),
                queryClient.invalidateQueries({ queryKey: roomQueryKey.roomsList }),
                queryClient.invalidateQueries({ queryKey: roomQueryKey.roomConfig(roomId) }),
            ])
            toast.success('Brief saved')
        },
        onError: async (error: unknown) => {
            const message = error instanceof Error ? error.message : ''
            if (isMemoryConflict(message)) {
                await Promise.all([
                    queryClient.invalidateQueries({
                        queryKey: roomQueryKey.roomMemory(roomId),
                    }),
                    queryClient.invalidateQueries({
                        queryKey: roomQueryKey.roomPersonality(roomId),
                    }),
                ])
                return
            }
            toast.error('We could not save all of your changes', {
                description: `${sanitizeRuntimeError(message)} Any sections that already saved were kept.`,
            })
        },
    })

    const anyError =
        roomsQuery.isError || memoryQuery.isError || personalityQuery.isError || configQuery.isError
    const ready = identity && memory && personality && instructions
    const roomMissing = roomsQuery.isSuccess && !room

    const retryLoad = () => {
        roomsQuery.refetch()
        memoryQuery.refetch()
        personalityQuery.refetch()
        configQuery.refetch()
    }

    if (anyError && !ready) {
        const error =
            memoryQuery.error ?? configQuery.error ?? personalityQuery.error ?? roomsQuery.error
        return (
            <div className="flex w-full flex-col gap-6">
                <Section title="Coworker brief">
                    <EmptyState
                        icon={BrainIcon}
                        title="Could not load this brief"
                        description={sanitizeRuntimeError(
                            error instanceof Error ? error.message : null,
                        )}
                        action={
                            <Button variant="outline" onClick={retryLoad}>
                                Try again
                            </Button>
                        }
                    />
                </Section>
            </div>
        )
    }

    if (roomMissing) {
        return (
            <div className="flex w-full flex-col gap-6">
                <Section title="Coworker brief">
                    <EmptyState
                        icon={BrainIcon}
                        title="This room is not available"
                        description="We could not find this room. It may have been removed, or you may not have access to it."
                        action={
                            <Button variant="outline" onClick={retryLoad}>
                                Try again
                            </Button>
                        }
                    />
                </Section>
            </div>
        )
    }

    if (!ready) {
        return (
            <div className="flex w-full flex-col gap-6">
                <Section title="Coworker brief">
                    <LoadingRows count={6} />
                </Section>
            </div>
        )
    }

    const dirty = identity.dirty || memory.dirty || personality.dirty || instructions.dirty

    return (
        <div className="flex w-full flex-col gap-6">
            <Section
                title="Coworker brief"
                description="One place to shape who this room is, how it works, and what it remembers."
            >
                <WhoSection
                    role={memory.draft.identity.role}
                    displayName={identity.draft.displayName}
                    slug={identity.draft.slug}
                    onRoleChange={(role) =>
                        memory.setDraft((current) => ({
                            ...current,
                            identity: { ...current.identity, role },
                        }))
                    }
                    onDisplayNameChange={(displayName) =>
                        identity.setDraft((current) => ({ ...current, displayName }))
                    }
                    onSlugChange={(slug) => identity.setDraft((current) => ({ ...current, slug }))}
                />
            </Section>

            <Section
                title="Personality"
                description="Pick the preset that fits how this room should think and respond."
            >
                <PersonalityPicker form={personality.draft} onChange={personality.setDraft} />
            </Section>

            <Section
                title="Instructions"
                description="How this room should behave in every conversation and task."
            >
                <InstructionsSection value={instructions.draft} onChange={instructions.setDraft} />
            </Section>

            <Section
                title="What it remembers"
                description="Durable notes this room keeps across conversations and scheduled tasks. It updates these itself as it works."
                bodyClassName="space-y-5 p-4"
            >
                {memory.conflicted ? (
                    <AttentionBanner
                        tone="attention"
                        title="This room updated its own memory"
                        description="It saved new notes while you were editing. Load the latest brief to keep working from the current version. This discards your unsaved memory edits."
                        action={
                            <Button size="sm" variant="outline" onClick={memory.adoptServer}>
                                Load latest
                            </Button>
                        }
                    />
                ) : null}

                <BudgetMeter
                    bytes={memoryBytes}
                    overBudget={overBudget}
                    oversizeSections={oversizeSections}
                />

                <MemorySectionsEditor memory={memory.draft} onChange={memory.setDraft} />
            </Section>

            <SaveBar
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
                    identity.revert()
                    memory.revert()
                    personality.revert()
                    instructions.revert()
                }}
                saveLabel="Save brief"
            />
        </div>
    )
}
