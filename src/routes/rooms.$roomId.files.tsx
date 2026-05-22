import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { toast } from 'sonner'
import {
    ChevronRightIcon,
    FileIcon,
    FileImageIcon,
    FileTextIcon,
    FolderIcon,
    FolderOpenIcon,
    Maximize2Icon,
    SearchIcon,
    UploadIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { CardButton } from '#/components/ui/card'
import { Input } from '#/components/ui/input'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '#/components/ui/dialog'
import { Badge } from '#/components/ui/badge'
import { RoomDashboardLayout } from '#/components/room-dashboard'
import { EmptyState, LoadingRows, Section } from '#/components/agent-room'
import {
    RoomFileMetadata,
    RoomFilePreviewContent,
    describeRoomFileSurface,
    getRoomFileExtension,
} from '#/components/room-files/file-preview'
import { RoomFileDownloadMenu } from '#/components/room-files/file-download-menu'
import { formatBytes, formatRelativeTime } from '#/lib/format'
import { roomFileEntryPreviewUrl } from '#/lib/room-file-links'
import { uploadRoomFiles } from '#/lib/room-file-upload'
import { roomQueryKey, roomQueryPolicy } from '#/lib/room-query-keys'
import {
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
    RoomFileTreeNode,
} from '#/lib/room-file-types'
import type { RoomRealtimeEvent } from '#/lib/room-execution-types'

export const Route = createFileRoute('/rooms/$roomId/files')({
    component: RoomFilesPage,
})

const TEXT_EXTENSIONS = new Set([
    'txt',
    'md',
    'json',
    'yaml',
    'yml',
    'csv',
    'log',
    'env',
    'sh',
    'js',
    'ts',
    'tsx',
    'jsx',
    'py',
    'rb',
    'go',
    'rs',
    'sql',
    'html',
    'css',
    'toml',
    'ini',
    'xml',
])
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'])
function pickIcon(entry: RoomFileEntry): LucideIcon {
    if (entry.kind === 'directory') return FolderIcon
    const ext = getRoomFileExtension(entry.name)
    if (IMAGE_EXTENSIONS.has(ext)) return FileImageIcon
    if (TEXT_EXTENSIONS.has(ext)) return FileTextIcon
    return FileIcon
}

function entryKey(entry: Pick<RoomFileEntry, 'surface' | 'relativePath'>): string {
    return `${entry.surface}:${entry.relativePath}`
}

function fileTypeLabel(entry: RoomFileEntry): string {
    if (entry.kind === 'directory') return 'Folder'
    const ext = getRoomFileExtension(entry.name)
    if (!ext) return 'File'
    return ext.toUpperCase()
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

function RoomFilesPage() {
    const { roomId } = Route.useParams()
    return (
        <RoomDashboardLayout roomId={roomId} activeTab="files">
            <FilesContent roomId={roomId} />
        </RoomDashboardLayout>
    )
}

function FilesContent({ roomId }: { roomId: string }) {
    const queryClient = useQueryClient()
    const [surface, setSurface] = useState<RoomFileSurface>('workspace')
    const [path, setPath] = useState('')
    const [search, setSearch] = useState('')
    const [selectedEntry, setSelectedEntry] = useState<RoomFileEntry | null>(null)
    const [streamError, setStreamError] = useState<string | null>(null)

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
    const entries = search.trim() ? searchResults : (listing?.entries ?? [])

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

    useEffect(() => {
        if (!selectedEntry) return
        const refreshed = (allFilesQuery.data ?? []).find(
            (entry) => entryKey(entry) === entryKey(selectedEntry),
        )
        if (!refreshed) return
        if (
            refreshed.byteLength !== selectedEntry.byteLength ||
            refreshed.updatedAt !== selectedEntry.updatedAt
        ) {
            setSelectedEntry(refreshed)
        }
    }, [allFilesQuery.data, selectedEntry])

    const uploadMutation = useMutation({
        mutationFn: (files: File[]) =>
            uploadRoomFiles({
                roomId,
                files,
                surface,
                path,
            }),
        onSuccess: async (result) => {
            await Promise.all([
                queryClient.invalidateQueries({
                    queryKey: roomQueryKey.roomDirectory(roomId),
                    exact: false,
                }),
                queryClient.invalidateQueries({ queryKey: roomQueryKey.roomFileTree(roomId) }),
                queryClient.invalidateQueries({ queryKey: roomQueryKey.roomFiles(roomId) }),
            ])
            setSelectedEntry(result.files[0] ?? null)
            toast.success(
                result.files.length === 1
                    ? `Uploaded ${result.files[0]!.name}`
                    : `Uploaded ${result.files.length} files`,
            )
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : 'Upload failed')
        },
    })
    const navigateTo = (nextSurface: RoomFileSurface, nextPath: string) => {
        setSurface(nextSurface)
        setPath(nextPath)
        setSelectedEntry(null)
    }

    return (
        <div className="mx-auto flex w-full max-w-[96rem] flex-col gap-4">
            <Section
                title="Files"
                description="Browse the room workspace and uploaded artifacts."
                bodyClassName="p-0"
            >
                {streamError ? (
                    <div className="border-b border-border/60 px-4 py-2 text-sm text-danger-fg">
                        {streamError}
                    </div>
                ) : null}
                <div className="grid grid-cols-1 md:grid-cols-[12rem_minmax(0,1fr)] xl:min-h-[42rem] xl:grid-cols-[13rem_minmax(16rem,0.85fr)_minmax(28rem,1.55fr)]">
                    <FileTreePane
                        loading={treeQuery.isLoading}
                        roots={treeQuery.data?.roots ?? []}
                        activeSurface={surface}
                        activePath={path}
                        onSelect={navigateTo}
                    />
                    <DirectoryPane
                        surface={surface}
                        path={path}
                        listing={listing}
                        entries={entries}
                        search={search}
                        loading={search.trim() ? allFilesQuery.isLoading : directoryQuery.isLoading}
                        error={search.trim() ? allFilesQuery.error : directoryQuery.error}
                        selectedEntry={selectedEntry}
                        onSearchChange={setSearch}
                        onSelectEntry={setSelectedEntry}
                        onNavigate={navigateTo}
                        onUploadFiles={(files) => uploadMutation.mutate(files)}
                        uploading={uploadMutation.isPending}
                        uploadError={uploadMutation.error}
                    />
                    <PreviewPane roomId={roomId} entry={selectedEntry} />
                </div>
            </Section>
        </div>
    )
}

function FileTreePane({
    loading,
    roots,
    activeSurface,
    activePath,
    onSelect,
}: {
    loading: boolean
    roots: RoomFileTreeNode[]
    activeSurface: RoomFileSurface
    activePath: string
    onSelect: (surface: RoomFileSurface, path: string) => void
}) {
    return (
        <aside className="border-b border-border/60 p-3 md:border-b-0 md:border-r">
            <div className="mb-2 px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Browser
            </div>
            <div className="max-h-72 overflow-y-auto md:max-h-[34rem] xl:max-h-[calc(100vh-18rem)]">
                {loading ? (
                    <LoadingRows count={3} />
                ) : (
                    <div className="space-y-1">
                        {roots.map((root) => (
                            <TreeNode
                                key={root.surface}
                                node={root}
                                depth={0}
                                activeSurface={activeSurface}
                                activePath={activePath}
                                onSelect={onSelect}
                            />
                        ))}
                    </div>
                )}
            </div>
        </aside>
    )
}

function TreeNode({
    node,
    depth,
    activeSurface,
    activePath,
    onSelect,
}: {
    node: RoomFileTreeNode
    depth: number
    activeSurface: RoomFileSurface
    activePath: string
    onSelect: (surface: RoomFileSurface, path: string) => void
}) {
    const active = node.surface === activeSurface && node.relativePath === activePath
    const Icon = active ? FolderOpenIcon : FolderIcon
    return (
        <div>
            <Button
                type="button"
                variant="ghost"
                onClick={() => onSelect(node.surface, node.relativePath)}
                className={`h-8 w-full min-w-0 justify-start gap-2 rounded-md px-2 text-left text-sm font-normal hover:bg-muted hover:text-foreground ${active ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
                style={{ paddingLeft: `${depth * 10 + 8}px` }}
            >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{node.name}</span>
            </Button>
            {node.children.length > 0 ? (
                <div>
                    {node.children.map((child) => (
                        <TreeNode
                            key={`${child.surface}:${child.relativePath}`}
                            node={child}
                            depth={depth + 1}
                            activeSurface={activeSurface}
                            activePath={activePath}
                            onSelect={onSelect}
                        />
                    ))}
                </div>
            ) : null}
        </div>
    )
}

function DirectoryPane({
    surface,
    path,
    listing,
    entries,
    search,
    loading,
    error,
    selectedEntry,
    onSearchChange,
    onSelectEntry,
    onNavigate,
    onUploadFiles,
    uploading,
    uploadError,
}: {
    surface: RoomFileSurface
    path: string
    listing: RoomDirectoryListing | undefined
    entries: RoomFileEntry[]
    search: string
    loading: boolean
    error: unknown
    selectedEntry: RoomFileEntry | null
    onSearchChange: (value: string) => void
    onSelectEntry: (entry: RoomFileEntry | null) => void
    onNavigate: (surface: RoomFileSurface, path: string) => void
    onUploadFiles: (files: File[]) => void
    uploading: boolean
    uploadError: unknown
}) {
    const uploadInputRef = useRef<HTMLInputElement | null>(null)
    const searching = search.trim().length > 0
    const onUploadInputChange = (event: ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files
        if (files && files.length > 0) {
            onUploadFiles(Array.from(files))
        }
        event.target.value = ''
    }

    return (
        <main className="min-w-0 border-b border-border/60 xl:border-b-0">
            <div className="flex items-center gap-2 border-b border-border/60 p-3">
                <div className="relative flex-1">
                    <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={search}
                        onChange={(e) => onSearchChange(e.target.value)}
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
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => uploadInputRef.current?.click()}
                    disabled={uploading}
                >
                    <UploadIcon />
                    {uploading ? 'Uploading' : 'Upload'}
                </Button>
            </div>
            {uploadError ? (
                <div className="border-b border-border/60 px-3 py-2 text-sm text-destructive">
                    {uploadError instanceof Error ? uploadError.message : 'Upload failed'}
                </div>
            ) : null}
            <div className="flex min-h-12 items-center gap-1 border-b border-border/60 px-3 py-2">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onNavigate(surface, '')}
                >
                    {describeRoomFileSurface(surface)}
                </Button>
                {!searching && listing
                    ? listing.breadcrumbs.map((crumb) => (
                          <span
                              key={crumb.relativePath}
                              className="flex min-w-0 items-center gap-1"
                          >
                              <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
                              <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="min-w-0"
                                  onClick={() => onNavigate(surface, crumb.relativePath)}
                              >
                                  <span className="truncate">{crumb.name}</span>
                              </Button>
                          </span>
                      ))
                    : null}
                {searching ? (
                    <span className="ml-auto text-xs text-muted-foreground">
                        Searching all files
                    </span>
                ) : path ? null : (
                    <span className="ml-auto text-xs text-muted-foreground">
                        {entries.length} items
                    </span>
                )}
            </div>
            <div className="max-h-[30rem] overflow-y-auto p-3 xl:max-h-[calc(100vh-18rem)]">
                {loading ? (
                    <LoadingRows count={6} />
                ) : error ? (
                    <EmptyState
                        icon={FileIcon}
                        title="Could not load files"
                        description={
                            error instanceof Error
                                ? error.message
                                : 'Unexpected error fetching room files.'
                        }
                    />
                ) : entries.length === 0 ? (
                    <EmptyState
                        icon={FolderIcon}
                        title={searching ? 'No files match your search' : 'This folder is empty'}
                        description={
                            searching
                                ? 'Try a different name or clear the search.'
                                : 'Files created or uploaded here will appear in this browser.'
                        }
                    />
                ) : (
                    <ul className="divide-y divide-border/60">
                        {entries.map((entry) => (
                            <FileBrowserRow
                                key={entryKey(entry)}
                                entry={entry}
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

function FileBrowserRow({
    entry,
    selected,
    searching,
    onClick,
}: {
    entry: RoomFileEntry
    selected: boolean
    searching: boolean
    onClick: () => void
}) {
    const Icon = pickIcon(entry)
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
                            {fileTypeLabel(entry)}
                        </Badge>
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        {searching ? <span className="truncate">{entry.relativePath}</span> : null}
                        {entry.kind === 'file' ? (
                            <span>{formatBytes(entry.byteLength)}</span>
                        ) : null}
                        <span>{describeRoomFileSurface(entry.surface)}</span>
                        <span>Updated {formatRelativeTime(entry.updatedAt)}</span>
                    </span>
                </span>
                {entry.kind === 'directory' ? (
                    <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                ) : null}
            </CardButton>
        </li>
    )
}

function PreviewPane({ roomId, entry }: { roomId: string; entry: RoomFileEntry | null }) {
    const [expanded, setExpanded] = useState(false)
    const previewQuery = useQuery({
        queryKey: roomQueryKey.roomFilePreview(roomId, entry?.surface, entry?.relativePath),
        queryFn: () =>
            readRoomFileServer({
                data: {
                    roomId,
                    surface: entry!.surface,
                    relativePath: entry!.relativePath,
                },
            }),
        enabled: entry !== null && entry.kind === 'file',
        staleTime: roomQueryPolicy.coldStaleMs,
    })
    const preview = previewQuery.data as RoomFilePreview | undefined
    const previewUrl = entry ? roomFileEntryPreviewUrl(roomId, entry) : ''

    return (
        <aside className="min-w-0 p-3 md:col-span-2 xl:col-span-1 xl:border-l">
            <div className="mb-2 flex items-center justify-between gap-3 px-1">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Preview
                </div>
                {entry ? (
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
                ) : null}
            </div>
            {!entry ? (
                <div className="flex min-h-72 items-center justify-center rounded-md border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">
                    Select a file to preview it.
                </div>
            ) : (
                <div className="space-y-3">
                    <RoomFileMetadata entry={entry} />
                    <RoomFilePreviewContent
                        entry={entry}
                        preview={preview}
                        previewUrl={previewUrl}
                        loading={previewQuery.isLoading}
                        error={previewQuery.error}
                    />
                    <Dialog open={expanded} onOpenChange={setExpanded}>
                        <DialogContent className="grid h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-none grid-rows-[auto_minmax(0,1fr)] gap-3 p-4">
                            <div className="flex min-w-0 items-start justify-between gap-3 pr-8">
                                <DialogHeader className="min-w-0">
                                    <DialogTitle className="truncate">{entry.name}</DialogTitle>
                                    <DialogDescription className="truncate">
                                        {describeRoomFileSurface(entry.surface)} /{' '}
                                        {entry.relativePath}
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
                                    loading={previewQuery.isLoading}
                                    error={previewQuery.error}
                                    expanded
                                />
                            </div>
                        </DialogContent>
                    </Dialog>
                </div>
            )}
        </aside>
    )
}
