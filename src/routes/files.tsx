import { createFileRoute, Link } from '@tanstack/react-router'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { ArrowRightIcon, FileIcon, FileTextIcon, FolderIcon, SearchIcon } from 'lucide-react'

import { AppShell } from '#/components/app-shell'
import { EmptyState, LoadingRows, PageHeader, RoomGlyph, Section } from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Badge } from '#/components/ui/badge'
import { formatBytes, formatRelativeTime, pluralize } from '#/lib/format'
import { listRoomFilesServer, listRoomsServer } from './-room-runtime-server'
import { requireRouteUser } from './-route-auth'
import type { RoomRuntimeOverview } from '#/server/rooms/execution-types'

type RoomFileEntry = {
    name: string
    relativePath: string
    surface: 'workspace' | 'store'
    kind: 'file' | 'directory'
    byteLength: number | null
    updatedAt: string | null
}

export const Route = createFileRoute('/files')({
    beforeLoad: requireRouteUser,
    component: FilesPage,
})

const PER_ROOM_LIMIT = 12

interface RoomFileGroup {
    room: RoomRuntimeOverview
    files: RoomFileEntry[]
    totalCount: number
}

function describeSource(surface: 'workspace' | 'store'): string {
    return surface === 'workspace' ? 'Created by room' : 'Uploaded'
}

function FilesPage() {
    const roomsQuery = useQuery({
        queryKey: ['rooms-list'],
        queryFn: () => listRoomsServer(),
        staleTime: 30_000,
    })
    const rooms = roomsQuery.data ?? []

    const fileQueries = useQueries({
        queries: rooms.map((room) => ({
            queryKey: ['room-files', room.roomId],
            queryFn: () => listRoomFilesServer({ data: { roomId: room.roomId } }),
            staleTime: 30_000,
        })),
    })

    const [search, setSearch] = useState('')

    const groups = useMemo<RoomFileGroup[]>(() => {
        const trimmed = search.trim().toLowerCase()
        return rooms
            .map((room, index) => {
                const raw = (fileQueries[index]?.data as RoomFileEntry[] | undefined) ?? []
                let files = raw.filter((entry) => entry.kind === 'file')
                if (trimmed) {
                    files = files.filter((entry) => entry.name.toLowerCase().includes(trimmed))
                }
                const sorted = [...files].sort((a, b) => {
                    const ta = a.updatedAt ? Date.parse(a.updatedAt) : 0
                    const tb = b.updatedAt ? Date.parse(b.updatedAt) : 0
                    return tb - ta
                })
                return {
                    room,
                    totalCount: sorted.length,
                    files: sorted.slice(0, PER_ROOM_LIMIT),
                }
            })
            .filter((group) => group.files.length > 0)
    }, [rooms, fileQueries, search])

    const totalShown = groups.reduce((sum, group) => sum + group.files.length, 0)
    const isLoading = roomsQuery.isLoading || fileQueries.some((q) => q.isLoading)
    const hasNoFilesAtAll =
        !isLoading &&
        search.trim() === '' &&
        rooms.length > 0 &&
        fileQueries.every((q) => {
            const data = q.data as RoomFileEntry[] | undefined
            return !data || data.filter((entry) => entry.kind === 'file').length === 0
        })

    return (
        <AppShell>
            <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
                <PageHeader
                    title="Files"
                    subtitle={
                        totalShown === 0
                            ? 'Files produced or uploaded across your rooms.'
                            : `${totalShown} ${pluralize(totalShown, 'recent file')} across ${groups.length} ${pluralize(groups.length, 'room')}.`
                    }
                />

                <div className="mt-6 space-y-4">
                    <div className="relative w-full sm:max-w-sm">
                        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search files across rooms"
                            className="pl-8"
                        />
                    </div>

                    {isLoading && groups.length === 0 ? (
                        <Section>
                            <LoadingRows count={4} />
                        </Section>
                    ) : hasNoFilesAtAll ? (
                        <EmptyState
                            icon={FolderIcon}
                            title="No files yet across any room."
                            description="Files produced by sessions or uploaded to a room will show up here."
                        />
                    ) : groups.length === 0 ? (
                        <EmptyState
                            icon={FileIcon}
                            title={
                                search.trim()
                                    ? 'No files match your search.'
                                    : 'No files yet across any room.'
                            }
                            description={
                                search.trim()
                                    ? 'Try a different name or clear the filter.'
                                    : undefined
                            }
                        />
                    ) : (
                        groups.map((group) => (
                            <RoomFileGroupSection key={group.room.roomId} group={group} />
                        ))
                    )}
                </div>
            </div>
        </AppShell>
    )
}

function RoomFileGroupSection({ group }: { group: RoomFileGroup }) {
    const more = group.totalCount - group.files.length
    return (
        <Section
            title={
                <span className="inline-flex items-center gap-2">
                    <RoomGlyph name={group.room.displayName} seed={group.room.roomId} size="sm" />
                    <span className="truncate">{group.room.displayName}</span>
                </span>
            }
            description={
                more > 0
                    ? `Showing ${group.files.length} of ${group.totalCount} files.`
                    : `${group.files.length} ${pluralize(group.files.length, 'file')}`
            }
            actions={
                <Link to="/rooms/$roomId/files" params={{ roomId: group.room.roomId }}>
                    <Button variant="ghost" size="sm">
                        View room
                        <ArrowRightIcon />
                    </Button>
                </Link>
            }
            bodyClassName="p-0"
        >
            <ul className="divide-y divide-border/60">
                {group.files.map((file) => (
                    <FileRow
                        key={`${group.room.roomId}:${file.surface}:${file.relativePath}`}
                        roomId={group.room.roomId}
                        roomName={group.room.displayName}
                        file={file}
                    />
                ))}
            </ul>
        </Section>
    )
}

function FileRow({
    roomId,
    roomName,
    file,
}: {
    roomId: string
    roomName: string
    file: RoomFileEntry
}) {
    return (
        <li>
            <Link
                to="/rooms/$roomId/files"
                params={{ roomId }}
                className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent/40"
            >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <FileTextIcon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <span className="truncate">{roomName}</span>
                        <Badge
                            variant="outline"
                            className="font-normal text-[10px] uppercase tracking-wide"
                        >
                            {describeSource(file.surface)}
                        </Badge>
                        <span>{formatBytes(file.byteLength)}</span>
                        <span>Updated {formatRelativeTime(file.updatedAt)}</span>
                    </div>
                </div>
                <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground" />
            </Link>
        </li>
    )
}
