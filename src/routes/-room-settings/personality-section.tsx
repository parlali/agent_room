import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { Section } from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import { Label } from '#/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '#/components/ui/select'
import { Textarea } from '#/components/ui/textarea'
import { roomQueryKey, roomQueryPolicy } from '#/lib/room-query-keys'
import { getRoomPersonalityServer, saveRoomPersonalityServer } from '#/routes/-room-runtime-server'
import type { PersonalityForm } from '#/server/rooms/personality/form'
import {
    personalityArchetypeIds,
    personalityArchetypeLabels,
} from '#/server/rooms/personality/archetypes'
import {
    personalityChallengeStyleValues,
    personalityDirectnessValues,
    personalityHumorValues,
    personalityReportStyleValues,
    personalityToneValues,
    maxPersonalityNotesLength,
} from '#/server/rooms/personality/form'

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
            await queryClient.invalidateQueries({ queryKey: roomQueryKey.roomPersonality(roomId) })
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
                title="Working style"
                description="How this coworker communicates and reports back."
            >
                {personalityQuery.isError ? (
                    <p className="px-4 py-3 text-sm text-destructive">
                        Could not load working style.
                    </p>
                ) : (
                    <p className="px-4 py-3 text-sm text-muted-foreground">
                        Loading personality...
                    </p>
                )}
            </Section>
        )
    }

    return (
        <Section
            title="Working style"
            description="Shape how this coworker communicates. These preferences apply to every session and scheduled job."
        >
            <div className="grid gap-4 px-4 py-4">
                <div className="space-y-1.5">
                    <Label>Archetype</Label>
                    <Select
                        value={draft.archetype}
                        onValueChange={(value) =>
                            setDraft({ ...draft, archetype: value as PersonalityForm['archetype'] })
                        }
                    >
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {personalityArchetypeIds.map((id) => (
                                <SelectItem key={id} value={id}>
                                    {personalityArchetypeLabels[id]}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <EnumField
                    label="Tone"
                    value={draft.tone}
                    options={personalityToneValues}
                    onChange={(tone) => setDraft({ ...draft, tone })}
                />
                <EnumField
                    label="Directness"
                    value={draft.directness}
                    options={personalityDirectnessValues}
                    onChange={(directness) => setDraft({ ...draft, directness })}
                />
                <EnumField
                    label="Report style"
                    value={draft.reportStyle}
                    options={personalityReportStyleValues}
                    onChange={(reportStyle) => setDraft({ ...draft, reportStyle })}
                />
                <EnumField
                    label="Humor"
                    value={draft.humor}
                    options={personalityHumorValues}
                    onChange={(humor) => setDraft({ ...draft, humor })}
                />
                <EnumField
                    label="Challenge style"
                    value={draft.challengeStyle}
                    options={personalityChallengeStyleValues}
                    onChange={(challengeStyle) => setDraft({ ...draft, challengeStyle })}
                />
                <div className="space-y-1.5">
                    <Label htmlFor="personality-notes">Notes</Label>
                    <Textarea
                        id="personality-notes"
                        value={draft.notes}
                        rows={3}
                        maxLength={maxPersonalityNotesLength}
                        onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                    />
                </div>
                <Button
                    type="button"
                    disabled={saveMutation.isPending}
                    onClick={() => saveMutation.mutate(draft)}
                >
                    Save working style
                </Button>
            </div>
        </Section>
    )
}

function EnumField<T extends string>({
    label,
    value,
    options,
    onChange,
}: {
    label: string
    value: T
    options: readonly T[]
    onChange: (value: T) => void
}) {
    return (
        <div className="space-y-1.5">
            <Label>{label}</Label>
            <Select value={value} onValueChange={(next) => onChange(next as T)}>
                <SelectTrigger>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {options.map((option) => (
                        <SelectItem key={option} value={option}>
                            {option.replaceAll('_', ' ')}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    )
}
