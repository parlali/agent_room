import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
    CheckIcon,
    CompassIcon,
    HammerIcon,
    HandshakeIcon,
    ListChecksIcon,
    SaveIcon,
    SearchCheckIcon,
    SlidersHorizontalIcon,
    Undo2Icon,
    type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import { Section } from '#/components/agent-room'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Label } from '#/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '#/components/ui/select'
import { Skeleton } from '#/components/ui/skeleton'
import { Textarea } from '#/components/ui/textarea'
import { roomQueryKey, roomQueryPolicy } from '#/lib/room-query-keys'
import { cn } from '#/lib/utils'
import { getRoomPersonalityServer, saveRoomPersonalityServer } from '#/routes/-room-runtime-server'
import {
    personalityArchetypeIds,
    personalityArchetypeProfiles,
} from '#/server/rooms/personality/archetypes'
import {
    maxPersonalityNotesLength,
    personalityChallengeStyleProfiles,
    personalityChallengeStyleValues,
    personalityDirectnessProfiles,
    personalityDirectnessValues,
    personalityFormForArchetype,
    personalityHumorProfiles,
    personalityHumorValues,
    personalityReportStyleProfiles,
    personalityReportStyleValues,
    personalityToneProfiles,
    personalityToneValues,
    type PersonalityForm,
    type PersonalityOptionProfile,
} from '#/server/rooms/personality/form'

const personalityIconByArchetype: Record<PersonalityForm['archetype'], LucideIcon> = {
    pragmatic_builder: HammerIcon,
    rigorous_researcher: SearchCheckIcon,
    warm_chief_of_staff: HandshakeIcon,
    strategic_challenger: CompassIcon,
    concise_operator: ListChecksIcon,
}

export function PersonalitySection({ roomId }: { roomId: string }) {
    const queryClient = useQueryClient()
    const personalityQuery = useQuery({
        queryKey: roomQueryKey.roomPersonality(roomId),
        queryFn: () => getRoomPersonalityServer({ data: { roomId } }),
        staleTime: roomQueryPolicy.warmStaleMs,
    })

    const saveMutation = useMutation({
        mutationFn: (form: PersonalityForm) =>
            saveRoomPersonalityServer({
                data: {
                    roomId,
                    form,
                },
            }),
        onSuccess: async (response) => {
            setDraft(response.form)
            setDraftRoomId(response.roomId)
            await queryClient.invalidateQueries({
                queryKey: roomQueryKey.roomPersonality(response.roomId),
            })
            toast.success('Personality saved')
        },
        onError: (error: unknown) => {
            toast.error('Could not save personality', {
                description: error instanceof Error ? error.message : 'Unexpected error',
            })
        },
    })

    const [draft, setDraft] = useState<PersonalityForm | null>(null)
    const [draftRoomId, setDraftRoomId] = useState(roomId)

    useEffect(() => {
        if (!personalityQuery.data?.form || personalityQuery.data.roomId !== roomId) {
            return
        }
        if (draft && draftRoomId === roomId) {
            return
        }
        setDraft(personalityQuery.data.form)
        setDraftRoomId(roomId)
    }, [draft, draftRoomId, personalityQuery.data?.form, personalityQuery.data?.roomId, roomId])

    if (!draft || draftRoomId !== roomId) {
        return (
            <Section
                title="Agent personality"
                description="The room's agent profile for sessions and scheduled jobs."
            >
                {personalityQuery.isError ? (
                    <p className="text-sm text-destructive">Could not load agent personality.</p>
                ) : (
                    <div className="grid gap-3 md:grid-cols-2">
                        <Skeleton className="h-28 rounded-lg" />
                        <Skeleton className="h-28 rounded-lg" />
                        <Skeleton className="h-28 rounded-lg" />
                        <Skeleton className="h-28 rounded-lg" />
                    </div>
                )}
            </Section>
        )
    }

    const saved = personalityQuery.data?.roomId === roomId ? personalityQuery.data.form : null
    const dirty = saved ? !personalityFormsEqual(draft, saved) : true
    const selectedProfile = personalityArchetypeProfiles[draft.archetype]
    const SelectedIcon = personalityIconByArchetype[draft.archetype]

    const resetDraft = () => {
        if (!saved) {
            return
        }
        setDraft(saved)
        setDraftRoomId(roomId)
    }

    return (
        <Section
            title="Agent personality"
            description="Choose the coworker profile this room should use across normal sessions and scheduled jobs."
            bodyClassName="p-0"
        >
            <form
                className="space-y-5 p-4"
                onSubmit={(event) => {
                    event.preventDefault()
                    if (!dirty || saveMutation.isPending) {
                        return
                    }
                    saveMutation.mutate(draft)
                }}
            >
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.85fr)]">
                    <div className="space-y-3">
                        <div>
                            <h3 className="text-sm font-medium text-foreground">Core profile</h3>
                            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                                Pick the profile that matches how this room should think, challenge,
                                and report.
                            </p>
                        </div>
                        <div className="grid gap-2 md:grid-cols-2">
                            {personalityArchetypeIds.map((id) => {
                                const profile = personalityArchetypeProfiles[id]
                                const Icon = personalityIconByArchetype[id]
                                const selected = draft.archetype === id
                                return (
                                    <button
                                        key={id}
                                        type="button"
                                        aria-pressed={selected}
                                        data-selected={selected}
                                        className={cn(
                                            'min-h-32 rounded-lg border border-border bg-background/40 p-3 text-left transition-colors hover:border-foreground/30 hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none data-[selected=true]:border-primary data-[selected=true]:bg-primary/5',
                                        )}
                                        onClick={() =>
                                            setDraft(personalityFormForArchetype(id, draft.notes))
                                        }
                                    >
                                        <span className="flex items-start justify-between gap-3">
                                            <span className="flex min-w-0 items-center gap-2">
                                                <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
                                                    <Icon className="size-4" />
                                                </span>
                                                <span className="min-w-0">
                                                    <span className="block truncate text-sm font-medium text-foreground">
                                                        {profile.label}
                                                    </span>
                                                    <span className="mt-0.5 block text-xs text-muted-foreground">
                                                        {profile.summary}
                                                    </span>
                                                </span>
                                            </span>
                                            {selected ? (
                                                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                                                    <CheckIcon className="size-3.5" />
                                                </span>
                                            ) : null}
                                        </span>
                                        <span className="mt-3 flex flex-wrap gap-1.5">
                                            {profile.traits.map((trait) => (
                                                <Badge
                                                    key={trait}
                                                    variant="outline"
                                                    className="h-5 rounded-md bg-card px-1.5 text-[0.6875rem] font-normal"
                                                >
                                                    {trait}
                                                </Badge>
                                            ))}
                                        </span>
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                    <aside className="rounded-lg border border-border/70 bg-muted/30 p-3">
                        <div className="flex items-start gap-3">
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground ring-1 ring-border">
                                <SelectedIcon className="size-4" />
                            </span>
                            <div className="min-w-0">
                                <p className="text-sm font-medium text-foreground">
                                    {selectedProfile.label}
                                </p>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    {selectedProfile.description}
                                </p>
                            </div>
                        </div>
                        <div className="mt-4 space-y-2 rounded-lg border border-border/60 bg-background/60 p-3">
                            <p className="text-xs font-medium uppercase text-muted-foreground">
                                Current tuning
                            </p>
                            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                                <TuningValue
                                    label="Tone"
                                    value={personalityToneProfiles[draft.tone].label}
                                />
                                <TuningValue
                                    label="Directness"
                                    value={personalityDirectnessProfiles[draft.directness].label}
                                />
                                <TuningValue
                                    label="Reports"
                                    value={personalityReportStyleProfiles[draft.reportStyle].label}
                                />
                                <TuningValue
                                    label="Challenge"
                                    value={
                                        personalityChallengeStyleProfiles[draft.challengeStyle]
                                            .label
                                    }
                                />
                            </dl>
                        </div>
                    </aside>
                </div>

                <details className="group rounded-lg border border-border/70 bg-background/40">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium text-foreground outline-none transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                        <span className="flex min-w-0 items-center gap-2">
                            <SlidersHorizontalIcon className="size-4 shrink-0 text-muted-foreground" />
                            <span>Advanced tuning</span>
                        </span>
                        <span className="truncate text-xs font-normal text-muted-foreground">
                            {personalityToneProfiles[draft.tone].label},{' '}
                            {personalityDirectnessProfiles[draft.directness].label},{' '}
                            {personalityReportStyleProfiles[draft.reportStyle].label}
                        </span>
                    </summary>
                    <div className="grid gap-4 border-t border-border/60 p-3 sm:grid-cols-2 lg:grid-cols-3">
                        <EnumField
                            id="personality-tone"
                            label="Tone"
                            value={draft.tone}
                            options={personalityToneValues}
                            profiles={personalityToneProfiles}
                            onChange={(tone) => setDraft({ ...draft, tone })}
                        />
                        <EnumField
                            id="personality-directness"
                            label="Directness"
                            value={draft.directness}
                            options={personalityDirectnessValues}
                            profiles={personalityDirectnessProfiles}
                            onChange={(directness) => setDraft({ ...draft, directness })}
                        />
                        <EnumField
                            id="personality-report-style"
                            label="Report style"
                            value={draft.reportStyle}
                            options={personalityReportStyleValues}
                            profiles={personalityReportStyleProfiles}
                            onChange={(reportStyle) => setDraft({ ...draft, reportStyle })}
                        />
                        <EnumField
                            id="personality-humor"
                            label="Humor"
                            value={draft.humor}
                            options={personalityHumorValues}
                            profiles={personalityHumorProfiles}
                            onChange={(humor) => setDraft({ ...draft, humor })}
                        />
                        <EnumField
                            id="personality-challenge-style"
                            label="Challenge style"
                            value={draft.challengeStyle}
                            options={personalityChallengeStyleValues}
                            profiles={personalityChallengeStyleProfiles}
                            onChange={(challengeStyle) => setDraft({ ...draft, challengeStyle })}
                        />
                        <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
                            <div className="flex items-center justify-between gap-3">
                                <Label htmlFor="personality-notes">Notes</Label>
                                <span className="text-xs text-muted-foreground">
                                    {draft.notes.length}/{maxPersonalityNotesLength}
                                </span>
                            </div>
                            <Textarea
                                id="personality-notes"
                                value={draft.notes}
                                rows={3}
                                maxLength={maxPersonalityNotesLength}
                                placeholder="Room-specific communication preferences"
                                onChange={(event) =>
                                    setDraft({ ...draft, notes: event.target.value })
                                }
                            />
                        </div>
                    </div>
                </details>

                <div className="flex flex-col-reverse gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-muted-foreground">
                        Saved changes apply to subsequent sessions and scheduled jobs.
                    </p>
                    <div className="flex shrink-0 items-center justify-end gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            disabled={!dirty || saveMutation.isPending}
                            onClick={resetDraft}
                        >
                            <Undo2Icon />
                            Revert
                        </Button>
                        <Button type="submit" disabled={!dirty || saveMutation.isPending}>
                            <SaveIcon />
                            Save personality
                        </Button>
                    </div>
                </div>
            </form>
        </Section>
    )
}

function TuningValue({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 truncate font-medium text-foreground">{value}</dd>
        </div>
    )
}

function EnumField<T extends string>({
    id,
    label,
    value,
    options,
    profiles,
    onChange,
}: {
    id: string
    label: string
    value: T
    options: readonly T[]
    profiles: Record<T, PersonalityOptionProfile>
    onChange: (value: T) => void
}) {
    return (
        <div className="space-y-1.5">
            <Label htmlFor={id}>{label}</Label>
            <Select value={value} onValueChange={(next) => onChange(next as T)}>
                <SelectTrigger id={id} className="w-full">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" align="start">
                    {options.map((option) => (
                        <SelectItem key={option} value={option}>
                            {profiles[option].label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{profiles[value].description}</p>
        </div>
    )
}

function personalityFormsEqual(left: PersonalityForm, right: PersonalityForm): boolean {
    return (
        left.archetype === right.archetype &&
        left.tone === right.tone &&
        left.directness === right.directness &&
        left.reportStyle === right.reportStyle &&
        left.humor === right.humor &&
        left.challengeStyle === right.challengeStyle &&
        left.notes === right.notes
    )
}
