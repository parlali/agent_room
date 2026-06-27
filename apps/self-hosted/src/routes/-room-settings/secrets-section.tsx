import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { KeyRoundIcon, Loader2Icon, PlusIcon, ShieldIcon } from 'lucide-react'
import { EmptyState, Section, StateBadge } from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from '#/components/ui/sheet'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '#/components/ui/select'
import { formatRelativeTime } from '#/domain/format'
import { saveRoomSecretServer } from '#/routes/-operator-config-server'
import type { RoomSecretSummary } from '#/server/configuration/operator-configuration'
import type { SecretDraft, SecretPurpose } from './model'
import { emptySecretDraft } from './model'

export function SecretsSection({
    roomId,
    secrets,
    onSaved,
}: {
    roomId: string
    secrets: RoomSecretSummary[]
    onSaved: () => Promise<void>
}) {
    const [open, setOpen] = useState(false)
    const [draft, setDraft] = useState<SecretDraft>(emptySecretDraft())
    const [editingExisting, setEditingExisting] = useState<RoomSecretSummary | null>(null)

    const mutation = useMutation({
        mutationFn: (input: SecretDraft) =>
            saveRoomSecretServer({
                data: {
                    roomId,
                    label: input.label.trim(),
                    envKey: input.envKey.trim(),
                    purpose: input.purpose,
                    provider: input.provider.trim() || null,
                    value: input.value,
                },
            }),
        onSuccess: async () => {
            await onSaved()
            toast.success(editingExisting ? 'Secret replaced' : 'Secret saved')
            setOpen(false)
            setDraft(emptySecretDraft())
            setEditingExisting(null)
        },
        onError: (e: unknown) =>
            toast.error('Could not save secret', {
                description: e instanceof Error ? e.message : 'Unexpected error',
            }),
    })

    const handleAdd = () => {
        setEditingExisting(null)
        setDraft(emptySecretDraft())
        setOpen(true)
    }

    const handleReplace = (secret: RoomSecretSummary) => {
        setEditingExisting(secret)
        setDraft({
            label: secret.label,
            envKey: secret.envKey,
            purpose: (secret.purpose as SecretPurpose) ?? 'generic',
            provider: secret.provider ?? '',
            value: '',
        })
        setOpen(true)
    }

    const valid =
        draft.label.trim().length > 0 && draft.envKey.trim().length > 0 && draft.value.length > 0

    return (
        <Section
            title="Room secrets"
            description="Encrypted, write-only values exposed to this room as env vars."
            actions={
                <Button size="sm" onClick={handleAdd}>
                    <PlusIcon />
                    Add secret
                </Button>
            }
            bodyClassName={secrets.length === 0 ? 'p-4' : 'p-0'}
        >
            {secrets.length === 0 ? (
                <EmptyState
                    icon={KeyRoundIcon}
                    title="No room secrets yet"
                    description="Add an encrypted value this room can read at runtime."
                    action={
                        <Button size="sm" onClick={handleAdd}>
                            <PlusIcon />
                            Add secret
                        </Button>
                    }
                />
            ) : (
                <ul className="divide-y divide-border/60">
                    {secrets.map((secret) => (
                        <li key={secret.id} className="flex items-center gap-3 px-4 py-3">
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                                <KeyRoundIcon className="size-4" />
                            </span>
                            <div className="min-w-0 flex-1">
                                <h4 className="truncate text-sm font-medium text-foreground">
                                    {secret.label}
                                </h4>
                                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                    {secret.envKey} · {secret.purpose}
                                    {secret.provider ? ` · ${secret.provider}` : ''} · updated{' '}
                                    {formatRelativeTime(secret.updatedAt)}
                                </p>
                            </div>
                            <StateBadge tone="muted" label="Masked" />
                            <Button variant="ghost" size="sm" onClick={() => handleReplace(secret)}>
                                Replace
                            </Button>
                        </li>
                    ))}
                </ul>
            )}

            <Sheet
                open={open}
                onOpenChange={(next) => {
                    setOpen(next)
                    if (!next) {
                        setDraft(emptySecretDraft())
                        setEditingExisting(null)
                    }
                }}
            >
                <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
                    <SheetHeader>
                        <SheetTitle>
                            {editingExisting ? 'Replace secret value' : 'Add room secret'}
                        </SheetTitle>
                        <SheetDescription>
                            {editingExisting
                                ? 'The new value overwrites the existing one. Old values cannot be recovered.'
                                : 'Stored encrypted on disk. Available to the room as an env var.'}
                        </SheetDescription>
                    </SheetHeader>
                    <form
                        className="flex min-h-0 flex-1 flex-col"
                        onSubmit={(e) => {
                            e.preventDefault()
                            if (!valid || mutation.isPending) return
                            mutation.mutate(draft)
                        }}
                    >
                        <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
                            <div className="space-y-1.5">
                                <Label htmlFor="secret-label">Label</Label>
                                <Input
                                    id="secret-label"
                                    value={draft.label}
                                    onChange={(e) =>
                                        setDraft((prev) => ({ ...prev, label: e.target.value }))
                                    }
                                    required
                                    disabled={editingExisting !== null}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="secret-env-key">Env key</Label>
                                <Input
                                    id="secret-env-key"
                                    value={draft.envKey}
                                    onChange={(e) =>
                                        setDraft((prev) => ({ ...prev, envKey: e.target.value }))
                                    }
                                    placeholder="MY_SECRET"
                                    required
                                    disabled={editingExisting !== null}
                                />
                                <p className="text-xs text-muted-foreground">
                                    Becomes <code>{draft.envKey || 'MY_SECRET'}</code> inside the
                                    room.
                                </p>
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="secret-purpose">Purpose</Label>
                                <Select
                                    value={draft.purpose}
                                    onValueChange={(value) =>
                                        setDraft((prev) => ({
                                            ...prev,
                                            purpose: value as SecretPurpose,
                                        }))
                                    }
                                    disabled={editingExisting !== null}
                                >
                                    <SelectTrigger id="secret-purpose" className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="generic">Generic</SelectItem>
                                        <SelectItem value="webhook">Webhook</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="secret-provider">Namespace (optional)</Label>
                                <Input
                                    id="secret-provider"
                                    value={draft.provider}
                                    onChange={(e) =>
                                        setDraft((prev) => ({
                                            ...prev,
                                            provider: e.target.value,
                                        }))
                                    }
                                    placeholder="external-service"
                                    disabled={editingExisting !== null}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="secret-value">Secret value</Label>
                                <Input
                                    id="secret-value"
                                    type="password"
                                    value={draft.value}
                                    onChange={(e) =>
                                        setDraft((prev) => ({ ...prev, value: e.target.value }))
                                    }
                                    autoComplete="off"
                                    required
                                />
                                <p className="text-xs text-muted-foreground">
                                    Write-only. Cannot be retrieved after save.
                                </p>
                            </div>
                        </div>
                        <SheetFooter className="border-t border-border/60">
                            <div className="flex justify-end gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setOpen(false)}
                                    disabled={mutation.isPending}
                                >
                                    Cancel
                                </Button>
                                <Button type="submit" disabled={!valid || mutation.isPending}>
                                    {mutation.isPending ? (
                                        <Loader2Icon className="animate-spin" />
                                    ) : (
                                        <ShieldIcon />
                                    )}
                                    {editingExisting ? 'Replace value' : 'Save secret'}
                                </Button>
                            </div>
                        </SheetFooter>
                    </form>
                </SheetContent>
            </Sheet>
        </Section>
    )
}
