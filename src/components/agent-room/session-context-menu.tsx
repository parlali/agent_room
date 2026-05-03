import { useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loader2Icon, MoreHorizontalIcon, PencilIcon, Trash2Icon } from 'lucide-react'

import { Button } from '#/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '#/components/ui/dialog'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { deleteSessionServer, renameSessionServer } from '#/routes/-room-runtime-server'

type DialogState = { type: 'closed' } | { type: 'rename'; title: string } | { type: 'delete' }

export function SessionContextMenu({
    roomId,
    sessionKey,
    sessionTitle,
    children,
    onDeleted,
}: {
    roomId: string
    sessionKey: string
    sessionTitle: string
    children: ReactNode
    onDeleted?: () => void
}) {
    const queryClient = useQueryClient()
    const [dialog, setDialog] = useState<DialogState>({ type: 'closed' })

    const renameMutation = useMutation({
        mutationFn: (title: string) => renameSessionServer({ data: { roomId, sessionKey, title } }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['room-execution', roomId] })
            toast.success('Session renamed')
            setDialog({ type: 'closed' })
        },
        onError: (e: unknown) =>
            toast.error('Failed to rename session', {
                description: e instanceof Error ? e.message : 'Unexpected error',
            }),
    })

    const deleteMutation = useMutation({
        mutationFn: () => deleteSessionServer({ data: { roomId, sessionKey } }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['room-execution', roomId] })
            toast.success('Session deleted')
            setDialog({ type: 'closed' })
            onDeleted?.()
        },
        onError: (e: unknown) =>
            toast.error('Failed to delete session', {
                description: e instanceof Error ? e.message : 'Unexpected error',
            }),
    })

    const isPending = renameMutation.isPending || deleteMutation.isPending

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem
                        onSelect={() => setDialog({ type: 'rename', title: sessionTitle })}
                    >
                        <PencilIcon className="size-4" />
                        Rename
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => setDialog({ type: 'delete' })}
                    >
                        <Trash2Icon className="size-4" />
                        Delete
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>

            <Dialog
                open={dialog.type === 'rename'}
                onOpenChange={(open) => {
                    if (!open && !isPending) setDialog({ type: 'closed' })
                }}
            >
                <DialogContent>
                    <form
                        onSubmit={(e) => {
                            e.preventDefault()
                            if (dialog.type === 'rename' && dialog.title.trim()) {
                                renameMutation.mutate(dialog.title.trim())
                            }
                        }}
                    >
                        <DialogHeader>
                            <DialogTitle>Rename session</DialogTitle>
                            <DialogDescription>
                                Give this session a memorable name.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="py-4">
                            <Label htmlFor="session-title" className="sr-only">
                                Session title
                            </Label>
                            <Input
                                id="session-title"
                                value={dialog.type === 'rename' ? dialog.title : ''}
                                onChange={(e) =>
                                    setDialog({ type: 'rename', title: e.target.value })
                                }
                                placeholder="Session title"
                                autoFocus
                                disabled={isPending}
                            />
                        </div>
                        <DialogFooter>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setDialog({ type: 'closed' })}
                                disabled={isPending}
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                disabled={
                                    isPending || (dialog.type === 'rename' && !dialog.title.trim())
                                }
                            >
                                {renameMutation.isPending ? (
                                    <Loader2Icon className="animate-spin" />
                                ) : null}
                                Save
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <Dialog
                open={dialog.type === 'delete'}
                onOpenChange={(open) => {
                    if (!open && !isPending) setDialog({ type: 'closed' })
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete this session?</DialogTitle>
                        <DialogDescription>
                            "{sessionTitle || 'Untitled session'}" and all its messages will be
                            permanently deleted. This cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setDialog({ type: 'closed' })}
                            disabled={isPending}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => deleteMutation.mutate()}
                            disabled={isPending}
                        >
                            {deleteMutation.isPending ? (
                                <Loader2Icon className="animate-spin" />
                            ) : (
                                <Trash2Icon />
                            )}
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}

export function SessionContextMenuTrigger({ className }: { className?: string }) {
    return (
        <Button
            variant="ghost"
            size="icon-xs"
            className={className}
            onClick={(e) => e.preventDefault()}
        >
            <MoreHorizontalIcon className="size-4" />
            <span className="sr-only">Session options</span>
        </Button>
    )
}
