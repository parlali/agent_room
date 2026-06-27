import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, ReactNode } from 'react'
import { toast } from 'sonner'
import {
    ChevronRightIcon,
    FileIcon,
    FolderIcon,
    HistoryIcon,
    Maximize2Icon,
    SearchIcon,
    UploadCloudIcon,
    XIcon,
} from 'lucide-react'

import { Button } from '#/components/ui/button'
import { CardButton } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import { Badge } from '#/components/ui/badge'
import { Progress } from '#/components/ui/progress'
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from '#/components/ui/breadcrumb'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '#/components/ui/dialog'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '#/components/ui/sheet'
import { RoomSetupRequiredState } from '#/components/room-dashboard'
import { AttentionBanner, Chip, EmptyState, LoadingRows, Section } from '#/components/agent-room'
import { RoomFileMetadata, RoomFilePreviewContent } from '#/components/room-files/file-preview'
import { RoomFileDownloadMenu } from '#/components/room-files/file-download-menu'
import { roomFileEntryIcon } from '#/components/room-files/file-kinds'
import {
    deriveRoomFileProvenance,
    roomFileSurfaceLabel,
    roomFileTypeLabel,
} from '#/domain/file-kinds'
import { formatBytes, formatRelativeTime } from '#/domain/format'
import { sanitizeRuntimeError } from '#/domain/runtime-error'
import { roomFileDownloadUrl, roomFilePreviewUrl } from '#/domain/room-file-links'
import { uploadRoomFiles } from '#/lib/room-file-upload'
import { useIsMobile } from '#/lib/use-media-query'
import { roomQueryKey, roomQueryPolicy } from '#/lib/room-query-keys'
import {
    getRoomSidebarServer,
    listRoomDirectoryServer,
    listRoomFilesServer,
    listRoomFileTreeServer,
    readRoomFileServer,
} from '#/routes/-room-runtime-server'
import { useEventSourceRefetch } from '#/routes/-session-chat/streaming'
import type {
    RoomDirectoryListing,
    RoomFileEntry,
    RoomFilePreview,
    RoomFileSurface,
} from '#/domain/room-file-types'
import type { RoomRealtimeEvent, RoomSidebarSnapshot } from '#/domain/room-execution-types'

export const Route = createFileRoute('/rooms/$roomId/files')({
    component: RoomFilesPage,
})

type UploadItemStatus = 'pending' | 'uploading' | 'done' | 'error'

interface UploadItem {
    id: string
    name: string
    status: UploadItemStatus
    error: string | null
}

interface RuntimeNotice {
    tone: 'attention' | 'info' | 'muted' | 'danger'
    title: string
    description: string
}

function entryKey(entry: Pick<RoomFileEntry, 'surface' | 'relativePath'>): string {
    return `${entry.surface}:${entry.relativePath}`
}

function describeFileError(error: unknown): string {
    return sanitizeRuntimeError(error instanceof Error ? error.message : '')
}

function shouldRefreshFilesForRoomEvent(event: RoomRealtimeEvent): boolean {
    return (
        event.event === 'room.files.changed' ||
        event.event === 'tool_execution_end' ||
        event.event === 'turn_end' ||
        event.event === 'agent_end' ||
        event.event === 'run.finished'
    )
}

function runtimeNoticeFor(sidebar: RoomSidebarSnapshot | undefined): RuntimeNotice | null {
    if (!sidebar) return null
    if (sidebar.setup.phase === 'setup_required') {
        return {
            tone: 'attention',
            title: 'This room needs setup',
            description: 'Finish setting up the room to upload files and get live updates.',
        }
    }
    if (sidebar.room.desiredState === 'stopped') {
        return {
            tone: 'muted',
            title: 'This room is paused',
            description:
                'Existing files are shown below. Resume the room to upload or get live updates.',
        }
    }
    if (sidebar.setup.phase === 'starting' || sidebar.setup.phase === 'onboarding') {
        return {
            tone: 'info',
            title: 'This room is still starting',
            description: 'Files will keep refreshing as the room finishes starting up.',
        }
    }
    if (sidebar.room.healthStatus === 'unhealthy') {
        return {
            tone: 'danger',
            title: 'This room is having trouble',
            description: sidebar.room.lastError
                ? sanitizeRuntimeError(sidebar.room.lastError)
                : 'Uploads and live updates may not work right now.',
        }
    }
    return null
}

function RoomFilesPage() {
    const { roomId } = Route.useParams()
    return <FilesContent roomId={roomId} />
}

function FilesContent({ roomId }: { roomId: string }) {
    const queryClient = useQueryClient()
    const isMobile = useIsMobile()
    const [surface, setSurface] = useState<RoomFileSurface>('store')
    const [path, setPath] = useState('')
    const [advanced, setAdvanced] = useState(false)
    const [search, setSearch] = useState('')
    const [selectedEntry, setSelectedEntry] = useState<RoomFileEntry | null>(null)
    const [streamError, setStreamError] = useState<string | null>(null)
    const [uploadItems, setUploadItems] = useState<UploadItem[]>([])
    const uploadingRef = useRef(false)
    const searching = search.trim().length > 0

    const sidebarQuery = useQuery({
        queryKey: roomQueryKey.roomSidebar(roomId),
        queryFn: () => getRoomSidebarServer({ data: { roomId } }),
        staleTime: roomQueryPolicy.hotStaleMs,
    })
    const runtimeNotice = runtimeNoticeFor(sidebarQuery.data)
    const setupRequired = sidebarQuery.data?.setup.phase === 'setup_required'
    const uploadDisabled = Boolean(runtimeNotice && runtimeNotice.tone !== 'info')

    const directoryQuery = useQuery({
        queryKey: roomQueryKey.roomDirectory(roomId, surface, path),
        queryFn: () =>
            listRoomDirectoryServer({
                data: {
                    roomId,
                    surface,
                    relativePath: path,
                },
            }),
        staleTime: roomQueryPolicy.hotStaleMs,
    })

    const treeQuery = useQuery({
        queryKey: roomQueryKey.roomFileTree(roomId),
        queryFn: () => listRoomFileTreeServer({ data: { roomId } }),
        staleTime: roomQueryPolicy.hotStaleMs,
    })

    const allFilesQuery = useQuery({
        queryKey: roomQueryKey.roomFiles(roomId),
        queryFn: () => listRoomFilesServer({ data: { roomId } }),
        staleTime: roomQueryPolicy.hotStaleMs,
        enabled: searching,
    })

    const searchResults = useMemo(() => {
        const q = search.trim().toLowerCase()
        if (!q) return []
        return (allFilesQuery.data ?? [])
            .filter((entry) => entry.kind === 'file')
            .filter((entry) => `${entry.name} ${entry.relativePath}`.toLowerCase().includes(q))
            .sort((left, right) => {
                const leftTime = left.updatedAt ? Date.parse(left.updatedAt) : 0
                const rightTime = right.updatedAt ? Date.parse(right.updatedAt) : 0
                return rightTime - leftTime
            })
    }, [allFilesQuery.data, search])

    const listing = directoryQuery.data as RoomDirectoryListing | undefined
    const entries = searching ? searchResults : (listing?.entries ?? [])
    const activeRootTruncated = Boolean(
        treeQuery.data?.roots.find((root) => root.surface === surface)?.truncated,
    )

    const invalidateFileQueries = useCallback(() => {
        void Promise.all([
            queryClient.invalidateQueries({
                queryKey: roomQueryKey.roomDirectory(roomId),
                exact: false,
            }),
            queryClient.invalidateQueries({ queryKey: roomQueryKey.roomFileTree(roomId) }),
            queryClient.invalidateQueries({ queryKey: roomQueryKey.roomFiles(roomId) }),
            queryClient.invalidateQueries({
                queryKey: roomQueryKey.roomFilePreview(roomId),
                exact: false,
            }),
        ])
    }, [queryClient, roomId])

    const onRealtimeEvent = useCallback(
        (event: RoomRealtimeEvent) => {
            if (shouldRefreshFilesForRoomEvent(event)) {
                invalidateFileQueries()
            }
        },
        [invalidateFileQueries],
    )

    useEventSourceRefetch({
        url: `/api/rooms/${encodeURIComponent(roomId)}/events`,
        queryClient,
        onError: setStreamError,
        onEvent: onRealtimeEvent,
    })

    const selectedEntrySource = searching ? allFilesQuery.data : listing?.entries

    useEffect(() => {
        if (!selectedEntry) return
        const refreshed = (selectedEntrySource ?? []).find(
            (entry) => entryKey(entry) === entryKey(selectedEntry),
        )
        if (!refreshed) {
            const sourceLoaded = searching ? allFilesQuery.isSuccess : directoryQuery.isSuccess
            if (sourceLoaded) setSelectedEntry(null)
            return
        }
        if (
            refreshed.byteLength !== selectedEntry.byteLength ||
            refreshed.updatedAt !== selectedEntry.updatedAt
        ) {
            setSelectedEntry(refreshed)
        }
    }, [
        allFilesQuery.isSuccess,
        directoryQuery.isSuccess,
        searching,
        selectedEntry,
        selectedEntrySource,
    ])

    const navigateTo = useCallback((nextSurface: RoomFileSurface, nextPath: string) => {
        setSurface(nextSurface)
        setPath(nextPath)
        setSearch('')
        setSelectedEntry(null)
    }, [])

    const onSelectSurface = useCallback(
        (nextSurface: RoomFileSurface) => {
            navigateTo(nextSurface, '')
        },
        [navigateTo],
    )

    const onToggleAdvanced = useCallback(() => {
        setAdvanced((current) => {
            const next = !current
            if (!next && surface === 'workspace') {
                navigateTo('store', '')
            }
            return next
        })
    }, [navigateTo, surface])

    const runUpload = useCallback(
        async (files: File[]) => {
            if (files.length === 0 || uploadingRef.current) return
            uploadingRef.current = true
            const items: UploadItem[] = files.map((file, index) => ({
                id: `${Date.now()}:${index}:${file.name}`,
                name: file.name,
                status: 'uploading',
                error: null,
            }))
            setUploadItems(items)
            try {
                const result = await uploadRoomFiles({
                    roomId,
                    files,
                    surface,
                    path,
                })
                setUploadItems((current) =>
                    current.map((item) => ({
                        ...item,
                        status: 'done',
                    })),
                )
                const lastUploaded = result.files.at(-1) ?? null
                if (lastUploaded) {
                    setSelectedEntry(lastUploaded)
                }
                toast.success(
                    files.length === 1
                        ? `Uploaded ${files[0]!.name}`
                        : `Uploaded ${files.length} files`,
                )
                setUploadItems([])
            } catch (error) {
                const message = describeFileError(error)
                setUploadItems((current) =>
                    current.map((item) => ({
                        ...item,
                        status: 'error',
                        error: message,
                    })),
                )
                toast.error('Upload failed')
            } finally {
                uploadingRef.current = false
                invalidateFileQueries()
            }
        },
        [invalidateFileQueries, path, roomId, surface],
    )

    const uploading = uploadItems.some(
        (item) => item.status === 'pending' || item.status === 'uploading',
    )

    return (
        <div className="flex w-full flex-col gap-4">
            {runtimeNotice ? (
                <AttentionBanner
                    tone={runtimeNotice.tone}
                    title={runtimeNotice.title}
                    description={runtimeNotice.description}
                />
            ) : null}
            <Section
                title="Files"
                description="Files you upload and files your agent creates in this room."
                bodyClassName="p-0"
                actions={
                    <SurfaceControl
                        surface={surface}
                        advanced={advanced}
                        onSelectSurface={onSelectSurface}
                        onToggleAdvanced={onToggleAdvanced}
                    />
                }
            >
                {streamError ? (
                    <div className="border-b border-border/60 px-4 py-2 text-sm text-danger-fg">
                        {sanitizeRuntimeError(streamError)}
                    </div>
                ) : null}
                <FilesToolbar
                    surface={surface}
                    path={path}
                    search={search}
                    uploading={uploading}
                    uploadDisabled={uploadDisabled}
                    onSearchChange={setSearch}
                    onUploadFiles={(files) => void runUpload(files)}
                />
                {uploadItems.length > 0 ? (
                    <UploadProgressPanel
                        items={uploadItems}
                        uploading={uploading}
                        onDismiss={() => setUploadItems([])}
                    />
                ) : null}
                {!searching ? (
                    <FilesBreadcrumb
                        surface={surface}
                        listing={listing}
                        itemCount={entries.length}
                        onNavigate={navigateTo}
                    />
                ) : (
                    <div className="flex min-h-12 items-center gap-2 border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
                        <SearchIcon className="size-3.5" />
                        Searching all files in this room
                    </div>
                )}
                {activeRootTruncated ? (
                    <div className="border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
                        This room has a lot of files. Some may not be listed here.
                    </div>
                ) : null}
                <UploadDropZone
                    disabled={uploading || uploadDisabled}
                    onUploadFiles={(files) => void runUpload(files)}
                >
                    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(24rem,1.4fr)]">
                        <DirectoryList
                            entries={entries}
                            searching={searching}
                            setupRequired={setupRequired}
                            loading={searching ? allFilesQuery.isLoading : directoryQuery.isLoading}
                            error={searching ? allFilesQuery.error : directoryQuery.error}
                            selectedEntry={selectedEntry}
                            roomId={roomId}
                            onSelectEntry={setSelectedEntry}
                            onNavigate={navigateTo}
                        />
                        {!isMobile ? <PreviewPane roomId={roomId} entry={selectedEntry} /> : null}
                    </div>
                </UploadDropZone>
            </Section>
            {isMobile ? (
                <Sheet
                    open={selectedEntry !== null}
                    onOpenChange={(open) => {
                        if (!open) setSelectedEntry(null)
                    }}
                >
                    <SheetContent side="bottom" className="h-[90dvh] gap-0 p-0">
                        <SheetHeader className="sr-only">
                            <SheetTitle>File preview</SheetTitle>
                        </SheetHeader>
                        {selectedEntry ? (
                            <div className="flex h-full min-h-0 flex-col overflow-y-auto p-3">
                                <PreviewBody roomId={roomId} entry={selectedEntry} />
                            </div>
                        ) : null}
                    </SheetContent>
                </Sheet>
            ) : null}
        </div>
    )
}

function SurfaceControl({
    surface,
    advanced,
    onSelectSurface,
    onToggleAdvanced,
}: {
    surface: RoomFileSurface
    advanced: boolean
    onSelectSurface: (surface: RoomFileSurface) => void
    onToggleAdvanced: () => void
}) {
    return (
        <div className="flex flex-wrap items-center gap-1">
            <SurfaceButton active={surface === 'store'} onClick={() => onSelectSurface('store')}>
                {roomFileSurfaceLabel('store')}
            </SurfaceButton>
            {advanced ? (
                <SurfaceButton
                    active={surface === 'workspace'}
                    onClick={() => onSelectSurface('workspace')}
                >
                    {roomFileSurfaceLabel('workspace')}
                </SurfaceButton>
            ) : null}
            <Button type="button" variant="ghost" size="sm" onClick={onToggleAdvanced}>
                {advanced ? 'Hide advanced' : 'Advanced'}
            </Button>
        </div>
    )
}

function SurfaceButton({
    active,
    onClick,
    children,
}: {
    active: boolean
    onClick: () => void
    children: ReactNode
}) {
    return (
        <Button
            type="button"
            variant={active ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={active}
            onClick={onClick}
        >
            {children}
        </Button>
    )
}

function FilesToolbar({
    surface,
    path,
    search,
    uploading,
    uploadDisabled,
    onSearchChange,
    onUploadFiles,
}: {
    surface: RoomFileSurface
    path: string
    search: string
    uploading: boolean
    uploadDisabled: boolean
    onSearchChange: (value: string) => void
    onUploadFiles: (files: File[]) => void
}) {
    const uploadInputRef = useRef<HTMLInputElement | null>(null)
    const destination = path
        ? `${roomFileSurfaceLabel(surface)} / ${path}`
        : roomFileSurfaceLabel(surface)
    const onUploadInputChange = (event: ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files
        if (files && files.length > 0) {
            onUploadFiles(Array.from(files))
        }
        event.target.value = ''
    }

    return (
        <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-3">
            <div className="relative min-w-48 flex-1">
                <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                    value={search}
                    onChange={(event) => onSearchChange(event.target.value)}
                    placeholder="Search files by name or path"
                    className="pl-8"
                />
            </div>
            <input
                ref={uploadInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={onUploadInputChange}
            />
            <div className="flex items-center gap-2">
                <span className="hidden text-xs text-muted-foreground sm:inline">
                    To {destination}
                </span>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => uploadInputRef.current?.click()}
                    disabled={uploading || uploadDisabled}
                >
                    <UploadCloudIcon />
                    Upload
                </Button>
            </div>
        </div>
    )
}

function UploadDropZone({
    disabled,
    onUploadFiles,
    children,
}: {
    disabled: boolean
    onUploadFiles: (files: File[]) => void
    children: ReactNode
}) {
    const [dragActive, setDragActive] = useState(false)

    const onDragOver = (event: DragEvent<HTMLDivElement>) => {
        if (disabled) return
        event.preventDefault()
        setDragActive(true)
    }
    const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setDragActive(false)
    }
    const onDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault()
        setDragActive(false)
        if (disabled) return
        const files = Array.from(event.dataTransfer.files)
        if (files.length > 0) {
            onUploadFiles(files)
        }
    }

    return (
        <div className="relative" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
            {children}
            {dragActive ? (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-2 border-2 border-dashed border-primary/60 bg-background/85 text-sm font-medium text-foreground">
                    <UploadCloudIcon className="size-4" />
                    Drop files to upload
                </div>
            ) : null}
        </div>
    )
}

function UploadProgressPanel({
    items,
    uploading,
    onDismiss,
}: {
    items: UploadItem[]
    uploading: boolean
    onDismiss: () => void
}) {
    const done = items.filter((item) => item.status === 'done' || item.status === 'error').length
    const value = items.length > 0 ? Math.round((done / items.length) * 100) : 0
    return (
        <div className="space-y-2 border-b border-border/60 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-foreground">
                    {uploading ? 'Uploading files' : 'Upload complete'}
                </span>
                {!uploading ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Dismiss upload status"
                        onClick={onDismiss}
                    >
                        <XIcon />
                    </Button>
                ) : null}
            </div>
            <Progress value={value} />
            <ul className="space-y-1">
                {items.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="min-w-0 truncate text-muted-foreground">{item.name}</span>
                        <span className="shrink-0">
                            <UploadItemStatusLabel item={item} />
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    )
}

function UploadItemStatusLabel({ item }: { item: UploadItem }) {
    if (item.status === 'done') {
        return <span className="text-ready-fg">Done</span>
    }
    if (item.status === 'error') {
        return <span className="text-danger-fg">{item.error ?? 'Failed'}</span>
    }
    if (item.status === 'uploading') {
        return <span className="text-working-fg">Uploading</span>
    }
    return <span className="text-muted-foreground">Waiting</span>
}

function FilesBreadcrumb({
    surface,
    listing,
    itemCount,
    onNavigate,
}: {
    surface: RoomFileSurface
    listing: RoomDirectoryListing | undefined
    itemCount: number
    onNavigate: (surface: RoomFileSurface, path: string) => void
}) {
    const crumbs = listing?.breadcrumbs ?? []
    return (
        <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
            <Breadcrumb className="min-w-0 flex-1 overflow-x-auto">
                <BreadcrumbList className="flex-nowrap">
                    <BreadcrumbItem>
                        <BreadcrumbLink asChild>
                            <button type="button" onClick={() => onNavigate(surface, '')}>
                                {roomFileSurfaceLabel(surface)}
                            </button>
                        </BreadcrumbLink>
                    </BreadcrumbItem>
                    {crumbs.map((crumb, index) => {
                        const isLast = index === crumbs.length - 1
                        return (
                            <Fragment key={crumb.relativePath}>
                                <BreadcrumbSeparator />
                                <BreadcrumbItem className="min-w-0">
                                    {isLast ? (
                                        <BreadcrumbPage className="truncate">
                                            {crumb.name}
                                        </BreadcrumbPage>
                                    ) : (
                                        <BreadcrumbLink asChild>
                                            <button
                                                type="button"
                                                className="truncate"
                                                onClick={() =>
                                                    onNavigate(surface, crumb.relativePath)
                                                }
                                            >
                                                {crumb.name}
                                            </button>
                                        </BreadcrumbLink>
                                    )}
                                </BreadcrumbItem>
                            </Fragment>
                        )
                    })}
                </BreadcrumbList>
            </Breadcrumb>
            <span className="shrink-0 text-xs text-muted-foreground">{itemCount} items</span>
        </div>
    )
}

function DirectoryList({
    entries,
    searching,
    setupRequired,
    loading,
    error,
    selectedEntry,
    roomId,
    onSelectEntry,
    onNavigate,
}: {
    entries: RoomFileEntry[]
    searching: boolean
    setupRequired: boolean
    loading: boolean
    error: unknown
    selectedEntry: RoomFileEntry | null
    roomId: string
    onSelectEntry: (entry: RoomFileEntry | null) => void
    onNavigate: (surface: RoomFileSurface, path: string) => void
}) {
    return (
        <main className="min-w-0 lg:border-r lg:border-border/60">
            <div className="max-h-[34rem] overflow-y-auto p-3 lg:max-h-[calc(100vh-20rem)]">
                {setupRequired ? (
                    <RoomSetupRequiredState description="Finish setup to upload files and see what this room creates." />
                ) : loading ? (
                    <LoadingRows count={6} />
                ) : error ? (
                    <EmptyState
                        icon={FileIcon}
                        title="Could not load files"
                        description={describeFileError(error)}
                    />
                ) : entries.length === 0 ? (
                    <EmptyState
                        icon={FolderIcon}
                        title={searching ? 'No files match your search' : 'Nothing here yet'}
                        description={
                            searching
                                ? 'Try a different name, or clear the search.'
                                : 'Upload a file or let your agent create one and it will show up here.'
                        }
                    />
                ) : (
                    <ul className="divide-y divide-border/60">
                        {entries.map((entry) => (
                            <FileRow
                                key={entryKey(entry)}
                                entry={entry}
                                roomId={roomId}
                                selected={
                                    selectedEntry
                                        ? entryKey(selectedEntry) === entryKey(entry)
                                        : false
                                }
                                searching={searching}
                                onClick={() => {
                                    if (entry.kind === 'directory') {
                                        onNavigate(entry.surface, entry.relativePath)
                                        return
                                    }
                                    onSelectEntry(entry)
                                }}
                            />
                        ))}
                    </ul>
                )}
            </div>
        </main>
    )
}

function FileRow({
    entry,
    roomId,
    selected,
    searching,
    onClick,
}: {
    entry: RoomFileEntry
    roomId: string
    selected: boolean
    searching: boolean
    onClick: () => void
}) {
    const Icon = roomFileEntryIcon(entry)
    const provenance = entry.kind === 'file' ? deriveRoomFileProvenance(entry) : null
    return (
        <li>
            <CardButton
                onClick={onClick}
                size="sm"
                className={`items-center gap-3 border-0 bg-transparent px-2 py-2.5 hover:bg-muted ${selected ? 'bg-muted' : ''}`}
            >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Icon className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                            {entry.name}
                        </span>
                        <Badge variant="outline" className="shrink-0 font-mono">
                            {roomFileTypeLabel(entry)}
                        </Badge>
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        {searching ? <span className="truncate">{entry.relativePath}</span> : null}
                        {entry.kind === 'file' ? (
                            <span>{formatBytes(entry.byteLength)}</span>
                        ) : null}
                        <span>{roomFileSurfaceLabel(entry.surface)}</span>
                        <span>Updated {formatRelativeTime(entry.updatedAt)}</span>
                    </span>
                </span>
                {entry.kind === 'directory' ? (
                    <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                ) : null}
            </CardButton>
            {provenance?.sessionKey ? (
                <div className="px-2 pb-1.5 pl-12">
                    <Chip bordered={false} icon={<HistoryIcon />}>
                        <Link
                            to="/rooms/$roomId/sessions/$sessionKey"
                            params={{ roomId, sessionKey: provenance.sessionKey }}
                            className="hover:text-foreground hover:underline"
                        >
                            From a session
                        </Link>
                    </Chip>
                </div>
            ) : null}
        </li>
    )
}

function PreviewPane({ roomId, entry }: { roomId: string; entry: RoomFileEntry | null }) {
    return (
        <aside className="min-w-0 border-t border-border/60 p-3 lg:border-t-0">
            {!entry ? (
                <div className="flex min-h-72 items-center justify-center rounded-md border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">
                    Select a file to preview it.
                </div>
            ) : (
                <PreviewBody roomId={roomId} entry={entry} />
            )}
        </aside>
    )
}

function PreviewBody({ roomId, entry }: { roomId: string; entry: RoomFileEntry }) {
    const [expanded, setExpanded] = useState(false)
    const previewQuery = useQuery({
        queryKey: roomQueryKey.roomFilePreview(roomId, entry.surface, entry.relativePath),
        queryFn: () =>
            readRoomFileServer({
                data: {
                    roomId,
                    surface: entry.surface,
                    relativePath: entry.relativePath,
                },
            }),
        enabled: entry.kind === 'file',
        staleTime: roomQueryPolicy.coldStaleMs,
    })
    const preview = previewQuery.data as RoomFilePreview | undefined
    const previewUrl = roomFilePreviewUrl(roomId, entry)
    const downloadUrl = roomFileDownloadUrl(roomId, entry)

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 px-1">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Preview
                </div>
                <div className="flex items-center gap-1">
                    <RoomFileDownloadMenu roomId={roomId} entry={entry} preview={preview} />
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpanded(true)}
                    >
                        <Maximize2Icon />
                        Expand
                    </Button>
                </div>
            </div>
            <RoomFileMetadata entry={entry} />
            <RoomFilePreviewContent
                entry={entry}
                preview={preview}
                previewUrl={previewUrl}
                downloadUrl={downloadUrl}
                loading={previewQuery.isLoading}
                error={previewQuery.error}
                onRetry={() => void previewQuery.refetch()}
            />
            <Dialog open={expanded} onOpenChange={setExpanded}>
                <DialogContent className="grid max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-none grid-rows-[auto_minmax(0,1fr)] gap-3 p-4">
                    <div className="flex min-w-0 items-start justify-between gap-3 pr-8">
                        <DialogHeader className="min-w-0">
                            <DialogTitle className="truncate">{entry.name}</DialogTitle>
                            <DialogDescription className="truncate">
                                {roomFileSurfaceLabel(entry.surface)} / {entry.relativePath}
                            </DialogDescription>
                        </DialogHeader>
                        <RoomFileDownloadMenu
                            roomId={roomId}
                            entry={entry}
                            preview={preview}
                            variant="outline"
                        />
                    </div>
                    <div className="h-full min-h-0">
                        <RoomFilePreviewContent
                            entry={entry}
                            preview={preview}
                            previewUrl={previewUrl}
                            downloadUrl={downloadUrl}
                            loading={previewQuery.isLoading}
                            error={previewQuery.error}
                            onRetry={() => void previewQuery.refetch()}
                            expanded
                        />
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}
