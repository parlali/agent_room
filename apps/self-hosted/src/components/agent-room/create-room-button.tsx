import { useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '#/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '#/components/ui/dialog'
import { CreateRoomForm, type CreateRoomFormValues } from '#/components/agent-room/create-room-form'
import { sanitizeRuntimeError } from '#/domain/runtime-error'
import { createRoomServer } from '#/routes/-room-runtime-server'
import { roomQueryKey } from '#/lib/room-query-keys'

type CreateRoomButtonProps = {
    children?: ReactNode
    buttonVariant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link'
    size?: 'default' | 'xs' | 'sm' | 'lg' | 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg'
    className?: string
    ariaLabel?: string
    onCreated?: () => void
}

export function CreateRoomButton({
    children,
    buttonVariant = 'default',
    size = 'default',
    className,
    ariaLabel,
    onCreated,
}: CreateRoomButtonProps) {
    const [open, setOpen] = useState(false)
    const navigate = useNavigate()
    const queryClient = useQueryClient()

    const create = useMutation({
        mutationFn: (input: CreateRoomFormValues) =>
            createRoomServer({
                data: {
                    displayName: input.displayName,
                    instructions: input.instructions || undefined,
                    roomMode: input.roomMode,
                    startImmediately: true,
                },
            }),
        onSuccess: async (room) => {
            await queryClient.invalidateQueries({ queryKey: roomQueryKey.roomsList })
            setOpen(false)
            toast.success('Room created', {
                description:
                    room.status === 'failed' ||
                    room.status === 'setup_required' ||
                    room.desiredState === 'stopped'
                        ? `"${room.displayName}" needs setup before it can run.`
                        : `"${room.displayName}" is starting up.`,
            })
            onCreated?.()
            navigate({ to: '/rooms/$roomId', params: { roomId: room.id } })
        },
        onError: (error: unknown) => {
            toast.error('Could not create room', {
                description: sanitizeRuntimeError(error instanceof Error ? error.message : null),
            })
        },
    })

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button
                    type="button"
                    variant={buttonVariant}
                    size={size}
                    className={className}
                    aria-label={ariaLabel}
                >
                    {children ?? (
                        <>
                            <PlusIcon /> Create room
                        </>
                    )}
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Create a new room</DialogTitle>
                    <DialogDescription>
                        A room is a persistent space where the agent works on a topic, with its own
                        files, memory, and history.
                    </DialogDescription>
                </DialogHeader>
                <CreateRoomForm
                    onSubmit={(values) => create.mutate(values)}
                    pending={create.isPending}
                />
            </DialogContent>
        </Dialog>
    )
}
