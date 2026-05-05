import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
    AlertTriangleIcon,
    ArchiveIcon,
    Loader2Icon,
    PauseIcon,
    PlayIcon,
    Trash2Icon,
} from 'lucide-react'
import { DangerZone, DangerZoneItem, Section } from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Switch } from '#/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip'
import { deleteRoomServer, setRoomDesiredStateServer } from '#/routes/-room-runtime-server'

export function PauseAndArchiveSection({
    roomId,
    paused,
    loading,
}: {
    roomId: string
    paused: boolean
    loading: boolean
}) {
    const queryClient = useQueryClient()

    const pauseMutation = useMutation({
        mutationFn: (next: boolean) =>
            setRoomDesiredStateServer({
                data: { roomId, desiredState: next ? 'stopped' : 'running' },
            }),
        onSuccess: async (_data, next) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['rooms-list'] }),
                queryClient.invalidateQueries({ queryKey: ['room-execution', roomId] }),
            ])
            toast.success(next ? 'Room paused' : 'Room resumed')
        },
        onError: (e: unknown) =>
            toast.error('Could not change room state', {
                description: e instanceof Error ? e.message : 'Unexpected error',
            }),
    })

    return (
        <Section
            title="Lifecycle"
            description="Pause work or archive the room."
            bodyClassName="p-0"
        >
            <div className="divide-y divide-border/60">
                <div className="flex items-center gap-4 px-4 py-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        {paused ? (
                            <PauseIcon className="size-4" />
                        ) : (
                            <PlayIcon className="size-4" />
                        )}
                    </span>
                    <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-medium text-foreground">
                            {paused ? 'Room is paused' : 'Room is running'}
                        </h4>
                        <p className="text-xs text-muted-foreground">
                            Pause stops the runtime and cron jobs. Resume to bring it back.
                        </p>
                    </div>
                    <Switch
                        checked={paused}
                        disabled={loading || pauseMutation.isPending}
                        onCheckedChange={(next) => pauseMutation.mutate(next)}
                        aria-label={paused ? 'Resume room' : 'Pause room'}
                    />
                </div>
                <div className="flex items-center gap-4 px-4 py-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <ArchiveIcon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-medium text-foreground">Archive room</h4>
                        <p className="text-xs text-muted-foreground">
                            Hides the room and stops all execution. Cannot be undone.
                        </p>
                    </div>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <span>
                                <Button variant="outline" size="sm" disabled>
                                    <ArchiveIcon />
                                    Archive
                                </Button>
                            </span>
                        </TooltipTrigger>
                        <TooltipContent>
                            Coming soon. No archive endpoint exists yet.
                        </TooltipContent>
                    </Tooltip>
                </div>
            </div>
        </Section>
    )
}

export function DangerZoneSection({
    roomId,
    roomSlug,
    roomDisplayName,
    loading,
}: {
    roomId: string
    roomSlug: string
    roomDisplayName: string
    loading: boolean
}) {
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const [showDeleteDialog, setShowDeleteDialog] = useState(false)
    const [confirmSlug, setConfirmSlug] = useState('')

    const deleteMutation = useMutation({
        mutationFn: () => deleteRoomServer({ data: { roomId, confirmSlug } }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['rooms-list'] })
            toast.success('Room deleted')
            navigate({ to: '/' })
        },
        onError: (e: unknown) =>
            toast.error('Could not delete room', {
                description: e instanceof Error ? e.message : 'Unexpected error',
            }),
    })

    const canDelete = confirmSlug === roomSlug && roomSlug.length > 0

    return (
        <>
            <DangerZone
                title="Danger Zone"
                description="Irreversible actions that permanently affect this room."
            >
                <DangerZoneItem
                    icon={<Trash2Icon className="size-5" />}
                    title="Delete this room"
                    description="Permanently delete this room and all its sessions, files, jobs, and secrets. This action cannot be undone."
                    action={
                        <Button
                            variant="destructive"
                            size="sm"
                            disabled={loading}
                            onClick={() => setShowDeleteDialog(true)}
                        >
                            <Trash2Icon />
                            Delete room
                        </Button>
                    }
                />
            </DangerZone>

            <Dialog
                open={showDeleteDialog}
                onOpenChange={(open) => {
                    if (!open && !deleteMutation.isPending) {
                        setShowDeleteDialog(false)
                        setConfirmSlug('')
                    }
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-danger-fg">
                            <AlertTriangleIcon className="size-5" />
                            Delete {roomDisplayName || 'this room'}?
                        </DialogTitle>
                        <DialogDescription className="space-y-3 pt-2">
                            <span className="block">
                                This will permanently delete the room and all associated data:
                            </span>
                            <ul className="list-inside list-disc space-y-1 text-sm">
                                <li>All sessions and conversation history</li>
                                <li>All workspace files</li>
                                <li>All scheduled jobs</li>
                                <li>All room secrets and configuration</li>
                            </ul>
                            <span className="block font-medium text-foreground">
                                This action cannot be undone.
                            </span>
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2 py-2">
                        <Label htmlFor="confirm-slug">
                            Type{' '}
                            <span className="font-mono font-semibold text-foreground">
                                {roomSlug}
                            </span>{' '}
                            to confirm
                        </Label>
                        <Input
                            id="confirm-slug"
                            value={confirmSlug}
                            onChange={(e) => setConfirmSlug(e.target.value)}
                            placeholder={roomSlug}
                            autoComplete="off"
                            disabled={deleteMutation.isPending}
                        />
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => {
                                setShowDeleteDialog(false)
                                setConfirmSlug('')
                            }}
                            disabled={deleteMutation.isPending}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => deleteMutation.mutate()}
                            disabled={!canDelete || deleteMutation.isPending}
                        >
                            {deleteMutation.isPending ? (
                                <Loader2Icon className="animate-spin" />
                            ) : (
                                <Trash2Icon />
                            )}
                            Delete room permanently
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
