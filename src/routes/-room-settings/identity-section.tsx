import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2Icon, SaveIcon } from 'lucide-react'
import { Section } from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Skeleton } from '#/components/ui/skeleton'
import { updateRoomIdentityServer } from '#/routes/-room-runtime-server'
import type { IdentityDraft } from './model'

export function IdentitySection({
    roomId,
    loading,
    defaultDisplayName,
    defaultSlug,
    onSaved,
}: {
    roomId: string
    loading: boolean
    defaultDisplayName: string
    defaultSlug: string
    onSaved: () => Promise<void>
}) {
    const [draft, setDraft] = useState<IdentityDraft>({
        displayName: defaultDisplayName,
        slug: defaultSlug,
    })

    useEffect(() => {
        setDraft({ displayName: defaultDisplayName, slug: defaultSlug })
    }, [defaultDisplayName, defaultSlug])

    const mutation = useMutation({
        mutationFn: () =>
            updateRoomIdentityServer({
                data: {
                    roomId,
                    displayName: draft.displayName.trim(),
                    slug: draft.slug.trim() || null,
                },
            }),
        onSuccess: async () => {
            await onSaved()
            toast.success('Room identity saved')
        },
        onError: (e: unknown) =>
            toast.error('Could not save identity', {
                description: e instanceof Error ? e.message : 'Unexpected error',
            }),
    })

    const dirty = draft.displayName !== defaultDisplayName || draft.slug !== defaultSlug
    const valid = draft.displayName.trim().length > 0

    return (
        <Section title="Identity" description="The name and URL slug operators see for this room.">
            {loading ? (
                <div className="space-y-3">
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-9 w-full" />
                </div>
            ) : (
                <form
                    className="grid gap-4 sm:grid-cols-2"
                    onSubmit={(e) => {
                        e.preventDefault()
                        if (!valid || !dirty || mutation.isPending) return
                        mutation.mutate()
                    }}
                >
                    <div className="space-y-1.5">
                        <Label htmlFor="room-display-name">Display name</Label>
                        <Input
                            id="room-display-name"
                            value={draft.displayName}
                            onChange={(e) =>
                                setDraft((prev) => ({ ...prev, displayName: e.target.value }))
                            }
                            required
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="room-slug">Slug</Label>
                        <Input
                            id="room-slug"
                            value={draft.slug}
                            onChange={(e) =>
                                setDraft((prev) => ({ ...prev, slug: e.target.value }))
                            }
                            placeholder="auto"
                        />
                        <p className="text-xs text-muted-foreground">
                            Lowercase, hyphenated. Leave blank to auto-generate.
                        </p>
                    </div>
                    <div className="flex justify-end gap-2 sm:col-span-2">
                        <Button type="submit" disabled={!valid || !dirty || mutation.isPending}>
                            {mutation.isPending ? (
                                <Loader2Icon className="animate-spin" />
                            ) : (
                                <SaveIcon />
                            )}
                            Save identity
                        </Button>
                    </div>
                </form>
            )}
        </Section>
    )
}
