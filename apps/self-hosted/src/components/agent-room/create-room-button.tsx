import { useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '#/components/ui/select'
import { Textarea } from '#/components/ui/textarea'
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from '#/components/ui/sheet'
import { createRoomServer } from '#/routes/-room-runtime-server'
import type { RoomMode } from '#/domain/domain-types'
import { ROOM_MODE_OPTIONS } from '#/domain/room-modes'
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
        mutationFn: (input: { displayName: string; instructions: string; roomMode: RoomMode }) =>
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
                description: error instanceof Error ? error.message : 'Unexpected error',
            })
        },
    })

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
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
            </SheetTrigger>
            <SheetContent side="right" className="w-full sm:max-w-md">
                <SheetHeader>
                    <SheetTitle>Create a new room</SheetTitle>
                    <SheetDescription>
                        A room is a persistent AI worker. You can edit its provider, tools, and
                        instructions later in settings.
                    </SheetDescription>
                </SheetHeader>
                <CreateRoomForm
                    onSubmit={(values) => create.mutate(values)}
                    pending={create.isPending}
                />
            </SheetContent>
        </Sheet>
    )
}

function CreateRoomForm({
    onSubmit,
    pending,
}: {
    onSubmit: (values: { displayName: string; instructions: string; roomMode: RoomMode }) => void
    pending: boolean
}) {
    const [displayName, setDisplayName] = useState('')
    const [instructions, setInstructions] = useState('')
    const [roomMode, setRoomMode] = useState<RoomMode>('coworker')

    const handle = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const trimmed = displayName.trim()
        if (!trimmed) return
        onSubmit({ displayName: trimmed, instructions: instructions.trim(), roomMode })
    }

    return (
        <form onSubmit={handle} className="space-y-4 px-4 py-2">
            <div className="space-y-1.5">
                <Label htmlFor="display-name">Room name</Label>
                <Input
                    id="display-name"
                    autoFocus
                    placeholder="e.g. Startup, Personal, Finance"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    required
                />
            </div>
            <div className="space-y-1.5">
                <Label htmlFor="instructions">What this room is for (optional)</Label>
                <Textarea
                    id="instructions"
                    rows={5}
                    placeholder="e.g. Help me research markets, draft outreach, and keep notes."
                    value={instructions}
                    onChange={(event) => setInstructions(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                    This becomes the room's working instructions. You can refine it later.
                </p>
            </div>
            <div className="space-y-1.5">
                <Label htmlFor="room-mode">Mode</Label>
                <Select value={roomMode} onValueChange={(value) => setRoomMode(value as RoomMode)}>
                    <SelectTrigger id="room-mode" className="w-full">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {ROOM_MODE_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                                {option.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                    Programmer is lean for code and repos. Coworker is broader for memory, files,
                    jobs, and artifacts.
                </p>
            </div>
            <SheetFooter className="px-0">
                <Button type="submit" disabled={pending || !displayName.trim()}>
                    {pending ? 'Creating...' : 'Create room'}
                </Button>
            </SheetFooter>
        </form>
    )
}
