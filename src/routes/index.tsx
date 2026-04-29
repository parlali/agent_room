import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { ArrowRightIcon, PlusIcon, SparklesIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '#/components/ui/button'
import { Card } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
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
import { AppShell } from '#/components/app-shell'
import {
    AttentionBanner,
    EmptyState,
    LoadingCards,
    PageHeader,
    RoomGlyph,
    StateBadge,
} from '#/components/agent-room'
import { describeRoomState } from '#/lib/state'
import { formatRelativeTime, pluralize } from '#/lib/format'
import { requireRouteUser } from './-route-auth'
import {
    createRoomServer,
    getRoomSetupReadinessServer,
    listRoomsServer,
} from './-room-runtime-server'
import { getOperatorConfigServer } from './-operator-config-server'
import type { RoomRuntimeOverview } from '#/server/rooms/execution-types'

export const Route = createFileRoute('/')({
    beforeLoad: async () => {
        await requireRouteUser()
        const config = await getOperatorConfigServer()
        if (!config.onboarding.completed) {
            throw redirect({ to: '/onboarding' })
        }
    },
    component: HomePage,
})

function HomePage() {
    const roomsQuery = useQuery({
        queryKey: ['rooms-list'],
        queryFn: () => listRoomsServer(),
        staleTime: 10_000,
        refetchInterval: 15_000,
    })
    const readinessQuery = useQuery({
        queryKey: ['room-setup-readiness'],
        queryFn: () => getRoomSetupReadinessServer(),
        staleTime: 30_000,
    })

    const rooms = roomsQuery.data ?? []
    const blockingIssues =
        readinessQuery.data?.issues.filter((i) => i.severity === 'blocking') ?? []
    const attentionRooms = rooms.filter(
        (r) => r.lastError || r.healthStatus === 'unhealthy' || r.status === 'failed',
    )

    return (
        <AppShell>
            <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
                <PageHeader
                    title="Your rooms"
                    subtitle={
                        rooms.length === 0
                            ? 'Create your first room to get started.'
                            : `${rooms.length} ${pluralize(rooms.length, 'room')} · ${attentionRooms.length} ${pluralize(attentionRooms.length, 'needs attention', 'need attention')}`
                    }
                    actions={<CreateRoomButton />}
                />

                <div className="mt-6 space-y-6">
                    {blockingIssues.length > 0 ? (
                        <AttentionBanner
                            tone="attention"
                            title={`Setup needs attention (${blockingIssues.length})`}
                            description={blockingIssues.map((i) => i.message).join(' · ')}
                            action={
                                <Link to="/settings">
                                    <Button variant="outline" size="sm">
                                        Open settings
                                    </Button>
                                </Link>
                            }
                        />
                    ) : null}

                    {roomsQuery.isLoading ? (
                        <LoadingCards count={3} />
                    ) : rooms.length === 0 ? (
                        <FirstRoomEmpty />
                    ) : (
                        <RoomGrid rooms={rooms} />
                    )}
                </div>
            </div>
        </AppShell>
    )
}

function RoomGrid({ rooms }: { rooms: RoomRuntimeOverview[] }) {
    return (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rooms.map((room) => (
                <RoomCard key={room.roomId} room={room} />
            ))}
        </div>
    )
}

function RoomCard({ room }: { room: RoomRuntimeOverview }) {
    const state = describeRoomState({
        status: room.status,
        desiredState: room.desiredState,
        healthStatus: room.healthStatus,
    })
    return (
        <Link to="/rooms/$roomId" params={{ roomId: room.roomId }} className="group block">
            <Card className="h-full justify-between gap-3 p-4 transition-colors hover:bg-accent/40">
                <div className="flex items-start gap-3">
                    <RoomGlyph name={room.displayName} seed={room.roomId} size="lg" />
                    <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                            <h3 className="truncate text-base font-semibold tracking-tight">
                                {room.displayName}
                            </h3>
                            <StateBadge
                                tone={state.tone}
                                label={state.label}
                                pulse={state.tone === 'working'}
                            />
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            /{room.slug}
                        </p>
                    </div>
                </div>

                {room.lastError ? (
                    <p className="line-clamp-2 text-xs text-danger-fg">{room.lastError}</p>
                ) : (
                    <p className="text-xs text-muted-foreground">
                        Last health check {formatRelativeTime(room.lastHealthAt)}
                    </p>
                )}

                <div className="flex items-center justify-end text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
                    Open <ArrowRightIcon className="ml-1 size-3.5" />
                </div>
            </Card>
        </Link>
    )
}

function FirstRoomEmpty() {
    return (
        <EmptyState
            icon={SparklesIcon}
            title="No rooms yet"
            description="A room is a persistent AI worker with its own files, jobs, and instructions. Create your first one — you can set it up in seconds."
            action={<CreateRoomButton variant="primary" />}
        />
    )
}

function CreateRoomButton({ variant = 'primary' }: { variant?: 'primary' | 'compact' }) {
    const [open, setOpen] = useState(false)
    const navigate = useNavigate()
    const queryClient = useQueryClient()

    const create = useMutation({
        mutationFn: (input: { displayName: string; instructions: string }) =>
            createRoomServer({
                data: {
                    displayName: input.displayName,
                    instructions: input.instructions || undefined,
                    startImmediately: true,
                },
            }),
        onSuccess: async (room) => {
            await queryClient.invalidateQueries({ queryKey: ['rooms-list'] })
            setOpen(false)
            toast.success('Room created', { description: `"${room.displayName}" is starting up.` })
            navigate({ to: '/rooms/$roomId', params: { roomId: room.id } })
        },
        onError: (e: unknown) => {
            toast.error('Could not create room', {
                description: e instanceof Error ? e.message : 'Unexpected error',
            })
        },
    })

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
                <Button size={variant === 'compact' ? 'sm' : 'default'}>
                    <PlusIcon /> Create room
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
    onSubmit: (values: { displayName: string; instructions: string }) => void
    pending: boolean
}) {
    const [displayName, setDisplayName] = useState('')
    const [instructions, setInstructions] = useState('')

    const handle = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        const trimmed = displayName.trim()
        if (!trimmed) return
        onSubmit({ displayName: trimmed, instructions: instructions.trim() })
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
                    onChange={(e) => setDisplayName(e.target.value)}
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
                    onChange={(e) => setInstructions(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                    This becomes the room's working instructions. You can refine it later.
                </p>
            </div>
            <SheetFooter className="px-0">
                <Button type="submit" disabled={pending || !displayName.trim()}>
                    {pending ? 'Creating…' : 'Create room'}
                    <ArrowRightIcon />
                </Button>
            </SheetFooter>
        </form>
    )
}
