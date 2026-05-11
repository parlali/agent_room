import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
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
import { formatBytes, formatRelativeTime } from '#/lib/format'
import { roomFileEntryPreviewUrl } from '#/lib/room-file-links'
import { uploadRoomFiles } from '#/lib/room-file-upload'
import {
    listRoomDirectoryServer,
    listRoomFilesServer,
    listRoomFileTreeServer,
    readRoomFileServer,
} from '#/routes/-room-runtime-server'
import { requireRouteUser } from '#/routes/-route-auth'
import type {
    RoomDirectoryListing,
    RoomFileEntry,
    RoomFilePreview,
    RoomFileSurface,
    RoomFileTreeNode,
} from '#/server/rooms/file-store'

export const Route = createFileRoute('/rooms/$roomId/files')({
    beforeLoad: requireRouteUser,
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
const OFFICE_EXTENSIONS = new Set([
    'doc',
    'docx',
    'xls',
    'xlsx',
    'ppt',
    'pptx',
    'odt',
    'ods',
    'odp',
])
const TEXT_PREVIEW_LIMIT_BYTES = 512000

function getExtension(name: string): string {
    const idx = name.lastIndexOf('.')
    if (idx <= 0 || idx === name.length - 1) return ''
    return name.slice(idx + 1).toLowerCase()
}

function pickIcon(entry: RoomFileEntry): LucideIcon {
    if (entry.kind === 'directory') return FolderIcon
    const ext = getExtension(entry.name)
    if (IMAGE_EXTENSIONS.has(ext)) return FileImageIcon
    if (TEXT_EXTENSIONS.has(ext)) return FileTextIcon
    return FileIcon
}

function describeSurface(surface: RoomFileSurface): string {
    return surface === 'workspace' ? 'Workspace' : 'Uploads'
}

function entryKey(entry: Pick<RoomFileEntry, 'surface' | 'relativePath'>): string {
    return `${entry.surface}:${entry.relativePath}`
}

function fileTypeLabel(entry: RoomFileEntry): string {
    if (entry.kind === 'directory') return 'Folder'
    const ext = getExtension(entry.name)
    if (!ext) return 'File'
    return ext.toUpperCase()
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

    const directoryQuery = useQuery({
        queryKey: ['room-directory', roomId, surface, path],
        queryFn: () =>
            listRoomDirectoryServer({
                data: {
                    roomId,
                    surface,
                    relativePath: path,
                },
            }),
        staleTime: 5_000,
    })

    const treeQuery = useQuery({
        queryKey: ['room-file-tree', roomId],
        queryFn: () => listRoomFileTreeServer({ data: { roomId } }),
        staleTime: 5_000,
    })

    const allFilesQuery = useQuery({
        queryKey: ['room-files', roomId],
        queryFn: () => listRoomFilesServer({ data: { roomId } }),
        staleTime: 5_000,
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
                queryClient.invalidateQueries({ queryKey: ['room-directory', roomId] }),
                queryClient.invalidateQueries({ queryKey: ['room-file-tree', roomId] }),
                queryClient.invalidateQueries({ queryKey: ['room-files', roomId] }),
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
                        onUploadFiles={(files) => uploadMutation.mutate(Array.from(files))}
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
            <button
                type="button"
                onClick={() => onSelect(node.surface, node.relativePath)}
                className={`flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm transition-colors hover:bg-muted hover:text-foreground ${active ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}
                style={{ paddingLeft: `${depth * 10 + 8}px` }}
            >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{node.name}</span>
            </button>
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
    onUploadFiles: (files: FileList) => void
    uploading: boolean
    uploadError: unknown
}) {
    const uploadInputRef = useRef<HTMLInputElement | null>(null)
    const searching = search.trim().length > 0
    const onUploadInputChange = (event: ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files
        if (files && files.length > 0) {
            onUploadFiles(files)
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
                    {describeSurface(surface)}
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
            <button
                type="button"
                onClick={onClick}
                className={`flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-muted ${selected ? 'bg-muted' : ''}`}
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
                        <span>{describeSurface(entry.surface)}</span>
                        <span>Updated {formatRelativeTime(entry.updatedAt)}</span>
                    </span>
                </span>
                {entry.kind === 'directory' ? (
                    <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                ) : null}
            </button>
        </li>
    )
}

function PreviewPane({ roomId, entry }: { roomId: string; entry: RoomFileEntry | null }) {
    const [expanded, setExpanded] = useState(false)
    const previewQuery = useQuery({
        queryKey: ['room-file-preview', roomId, entry?.surface, entry?.relativePath],
        queryFn: () =>
            readRoomFileServer({
                data: {
                    roomId,
                    surface: entry!.surface,
                    relativePath: entry!.relativePath,
                },
            }),
        enabled: entry !== null && entry.kind === 'file',
        staleTime: 60_000,
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
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpanded(true)}
                    >
                        <Maximize2Icon />
                        Expand
                    </Button>
                ) : null}
            </div>
            {!entry ? (
                <div className="flex min-h-72 items-center justify-center rounded-md border border-dashed border-border/70 p-6 text-center text-sm text-muted-foreground">
                    Select a file to preview it.
                </div>
            ) : (
                <div className="space-y-3">
                    <FileMetadata entry={entry} />
                    <PreviewContent
                        entry={entry}
                        preview={preview}
                        previewUrl={previewUrl}
                        loading={previewQuery.isLoading}
                        error={previewQuery.error}
                    />
                    <Dialog open={expanded} onOpenChange={setExpanded}>
                        <DialogContent className="grid h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-none grid-rows-[auto_minmax(0,1fr)] gap-3 p-4">
                            <DialogHeader className="min-w-0 pr-8">
                                <DialogTitle className="truncate">{entry.name}</DialogTitle>
                                <DialogDescription className="truncate">
                                    {describeSurface(entry.surface)} / {entry.relativePath}
                                </DialogDescription>
                            </DialogHeader>
                            <div className="h-full min-h-0">
                                <PreviewContent
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

function FileMetadata({ entry }: { entry: RoomFileEntry }) {
    return (
        <div className="rounded-md border border-border/60 p-3">
            <div className="truncate text-sm font-medium text-foreground">{entry.name}</div>
            <div className="mt-2 grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-1 text-xs">
                <span className="text-muted-foreground">Path</span>
                <span className="truncate text-foreground">{entry.relativePath}</span>
                <span className="text-muted-foreground">Root</span>
                <span className="text-foreground">{describeSurface(entry.surface)}</span>
                <span className="text-muted-foreground">Size</span>
                <span className="text-foreground">{formatBytes(entry.byteLength)}</span>
                <span className="text-muted-foreground">Updated</span>
                <span className="text-foreground">{formatRelativeTime(entry.updatedAt)}</span>
            </div>
        </div>
    )
}

function PreviewContent({
    entry,
    preview,
    previewUrl,
    loading,
    error,
    expanded = false,
}: {
    entry: RoomFileEntry
    preview: RoomFilePreview | undefined
    previewUrl: string
    loading: boolean
    error: unknown
    expanded?: boolean
}) {
    const extension = getExtension(entry.name)
    const officeLike = OFFICE_EXTENSIONS.has(extension)
    if (loading) {
        return (
            <div className="rounded-md border border-border/60 px-3 py-8 text-center text-sm text-muted-foreground">
                Preparing preview
            </div>
        )
    }
    if (error) {
        return (
            <div className="rounded-md border border-border/60 px-3 py-8 text-center text-sm text-danger-fg">
                Preview failed
            </div>
        )
    }
    if (!preview) {
        return (
            <div className="rounded-md border border-border/60 px-3 py-8 text-center text-sm text-muted-foreground">
                No preview loaded.
            </div>
        )
    }
    if (preview.kind === 'unsupported') {
        return (
            <div className="rounded-md border border-border/60 px-3 py-8 text-center text-sm text-muted-foreground">
                {preview.reason}
            </div>
        )
    }
    if (preview.kind === 'image') {
        return (
            <div className="flex h-full min-h-0 overflow-hidden rounded-md border border-border/60 bg-muted/30">
                <img
                    src={previewUrl}
                    alt={entry.name}
                    className={
                        expanded
                            ? 'h-full max-h-[calc(100vh-9rem)] w-full object-contain'
                            : 'max-h-[34rem] w-full object-contain'
                    }
                />
            </div>
        )
    }
    if (preview.kind === 'pdf') {
        return (
            <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border/60 bg-muted/30">
                {preview.generated || officeLike ? (
                    <div className="border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
                        Preview generated from {extension.toUpperCase()}
                    </div>
                ) : null}
                <img
                    src={previewUrl}
                    alt={entry.name}
                    className={
                        expanded
                            ? 'h-full min-h-0 flex-1 object-contain'
                            : 'max-h-[34rem] w-full object-contain'
                    }
                />
            </div>
        )
    }
    if (preview.kind !== 'text') {
        return (
            <div className="rounded-md border border-border/60 px-3 py-8 text-center text-sm text-muted-foreground">
                Preview is not available.
            </div>
        )
    }
    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border/60 bg-muted/30">
            <pre
                className={
                    expanded
                        ? 'min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-3 font-mono text-xs text-foreground'
                        : 'max-h-[34rem] overflow-auto whitespace-pre-wrap p-3 font-mono text-xs text-foreground'
                }
            >
                {preview.content}
            </pre>
            {preview.truncated ? (
                <div className="border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
                    Only the first {formatBytes(TEXT_PREVIEW_LIMIT_BYTES)} is shown.
                </div>
            ) : null}
        </div>
    )
}
