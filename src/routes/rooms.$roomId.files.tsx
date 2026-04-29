import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
    DownloadIcon,
    EyeIcon,
    FileIcon,
    FileImageIcon,
    FileTextIcon,
    FolderIcon,
    LinkIcon,
    SearchIcon,
    UploadIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from '#/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger } from '#/components/ui/tabs'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'
import { Badge } from '#/components/ui/badge'
import { RoomDashboardLayout } from '#/components/room-dashboard'
import { EmptyState, LoadingRows, Section, StateBadge } from '#/components/agent-room'
import { formatBytes, formatRelativeTime } from '#/lib/format'
import { getRoomExecutionServer, listRoomFilesServer } from '#/routes/-room-runtime-server'
import { requireRouteUser } from '#/routes/-route-auth'

type RoomFileEntry = {
    name: string
    relativePath: string
    surface: 'workspace' | 'store'
    kind: 'file' | 'directory'
    byteLength: number | null
    updatedAt: string | null
}

type SubView = 'recent' | 'uploaded' | 'created'
type SourceFilter = 'all' | 'uploaded' | 'created'

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

function describeSource(surface: 'workspace' | 'store'): string {
    return surface === 'workspace' ? 'Created by room' : 'Uploaded'
}

function labelForSource(value: SourceFilter): string {
    if (value === 'uploaded') return 'Uploaded'
    if (value === 'created') return 'Created by room'
    return 'All'
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
    const filesQuery = useQuery({
        queryKey: ['room-files', roomId],
        queryFn: () => listRoomFilesServer({ data: { roomId } }),
        staleTime: 5_000,
    })
    const [search, setSearch] = useState('')
    const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
    const [subView, setSubView] = useState<SubView>('recent')
    const [previewEntry, setPreviewEntry] = useState<RoomFileEntry | null>(null)
    const [uploadOpen, setUploadOpen] = useState(false)

    const allFiles = useMemo<RoomFileEntry[]>(
        () => (filesQuery.data ?? []).filter((entry) => entry.kind === 'file'),
        [filesQuery.data],
    )
    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase()
        let rows = allFiles
        const restrict =
            subView === 'uploaded' ? 'store' : subView === 'created' ? 'workspace' : null
        if (restrict) rows = rows.filter((e) => e.surface === restrict)
        if (sourceFilter === 'uploaded') rows = rows.filter((e) => e.surface === 'store')
        if (sourceFilter === 'created') rows = rows.filter((e) => e.surface === 'workspace')
        if (q) rows = rows.filter((e) => e.name.toLowerCase().includes(q))
        return [...rows].sort((a, b) => {
            const ta = a.updatedAt ? Date.parse(a.updatedAt) : 0
            const tb = b.updatedAt ? Date.parse(b.updatedAt) : 0
            return tb - ta
        })
    }, [allFiles, search, sourceFilter, subView])

    const uploadAction = (
        <Sheet open={uploadOpen} onOpenChange={setUploadOpen}>
            <SheetTrigger asChild>
                <Button size="sm">
                    <UploadIcon />
                    Upload
                </Button>
            </SheetTrigger>
            <SheetContent side="right" className="gap-0">
                <SheetHeader>
                    <SheetTitle>Upload coming soon</SheetTitle>
                    <SheetDescription>
                        File upload from the dashboard is not wired up yet.
                    </SheetDescription>
                </SheetHeader>
                <div className="px-4 pb-4">
                    <StateBadge tone="muted" label="Not available yet" />
                </div>
            </SheetContent>
        </Sheet>
    )

    return (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
            <Section
                title="Files"
                description="Anything uploaded to the room or produced by the agent."
                actions={uploadAction}
                bodyClassName="p-0"
            >
                <div className="flex flex-col gap-3 border-b border-border/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="relative w-full sm:max-w-xs">
                        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search files"
                            className="pl-8"
                        />
                    </div>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm">
                                Source: {labelForSource(sourceFilter)}
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Filter by source</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuRadioGroup
                                value={sourceFilter}
                                onValueChange={(v) => setSourceFilter(v as SourceFilter)}
                            >
                                <DropdownMenuRadioItem value="all">All</DropdownMenuRadioItem>
                                <DropdownMenuRadioItem value="uploaded">
                                    Uploaded
                                </DropdownMenuRadioItem>
                                <DropdownMenuRadioItem value="created">
                                    Created by room
                                </DropdownMenuRadioItem>
                            </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
                <div className="border-b border-border/60 px-4 py-2">
                    <Tabs value={subView} onValueChange={(v) => setSubView(v as SubView)}>
                        <TabsList variant="line">
                            <TabsTrigger value="recent">Recent</TabsTrigger>
                            <TabsTrigger value="uploaded">Uploaded</TabsTrigger>
                            <TabsTrigger value="created">Created by room</TabsTrigger>
                        </TabsList>
                    </Tabs>
                </div>
                <div className="px-4 py-4">
                    {filesQuery.isLoading ? (
                        <LoadingRows count={4} />
                    ) : filesQuery.isError ? (
                        <EmptyState
                            icon={FileIcon}
                            title="Could not load files"
                            description={
                                filesQuery.error instanceof Error
                                    ? filesQuery.error.message
                                    : 'Unexpected error fetching room files.'
                            }
                        />
                    ) : filtered.length === 0 ? (
                        <EmptyState
                            icon={FolderIcon}
                            title={search ? 'No files match your search' : 'No files yet'}
                            description={
                                search
                                    ? 'Try a different name or clear the filter.'
                                    : 'Upload a file or let the room produce one — it will show up here.'
                            }
                            action={
                                search ? null : (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setUploadOpen(true)}
                                    >
                                        <UploadIcon />
                                        Upload a file
                                    </Button>
                                )
                            }
                        />
                    ) : (
                        <ul className="divide-y divide-border/60">
                            {filtered.map((entry) => (
                                <FileRow
                                    key={`${entry.surface}:${entry.relativePath}`}
                                    entry={entry}
                                    roomId={roomId}
                                    onPreview={() => setPreviewEntry(entry)}
                                />
                            ))}
                        </ul>
                    )}
                </div>
            </Section>
            <PreviewSheet
                entry={previewEntry}
                onOpenChange={(open) => !open && setPreviewEntry(null)}
            />
        </div>
    )
}

function FileRow({
    entry,
    roomId,
    onPreview,
}: {
    entry: RoomFileEntry
    roomId: string
    onPreview: () => void
}) {
    const Icon = pickIcon(entry)
    const ext = getExtension(entry.name)
    return (
        <li className="flex items-center gap-3 py-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Icon className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">{entry.name}</p>
                    {ext ? (
                        <Badge variant="outline" className="font-mono uppercase">
                            {ext}
                        </Badge>
                    ) : null}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span>{formatBytes(entry.byteLength)}</span>
                    <span>{describeSource(entry.surface)}</span>
                    <span>Updated {formatRelativeTime(entry.updatedAt)}</span>
                </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
                <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={onPreview}
                    aria-label="Preview file"
                    title="Preview"
                >
                    <EyeIcon />
                </Button>
                <AttachToSessionPopover roomId={roomId} />
            </div>
        </li>
    )
}

function AttachToSessionPopover({ roomId }: { roomId: string }) {
    const [open, setOpen] = useState(false)
    const executionQuery = useQuery({
        queryKey: ['room-execution', roomId, 'files-attach'],
        queryFn: () => getRoomExecutionServer({ data: { roomId, selectedThreadKey: null } }),
        enabled: open,
        staleTime: 10_000,
    })
    const threads = executionQuery.data?.threads ?? []
    const isLoading = executionQuery.isLoading
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Attach to session"
                    title="Attach to session"
                >
                    <LinkIcon />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64">
                <div className="text-xs font-medium text-foreground">Attach to a session</div>
                <p className="text-xs text-muted-foreground">
                    Attaching files from the dashboard is not wired up yet. Sessions in this room
                    are listed for reference.
                </p>
                <div className="max-h-56 overflow-y-auto rounded-md border border-border/60 bg-card">
                    {isLoading ? (
                        <div className="px-2 py-2 text-xs text-muted-foreground">
                            Loading sessions…
                        </div>
                    ) : threads.length === 0 ? (
                        <div className="px-2 py-2 text-xs text-muted-foreground">
                            No sessions yet.
                        </div>
                    ) : (
                        <ul className="divide-y divide-border/60">
                            {threads.map((thread) => (
                                <li key={thread.key} className="px-2 py-1.5">
                                    <p className="truncate text-xs font-medium text-foreground">
                                        {thread.title || 'Untitled session'}
                                    </p>
                                    <p className="text-[11px] text-muted-foreground">
                                        Updated {formatRelativeTime(thread.updatedAt)}
                                    </p>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    )
}

function PreviewSheet({
    entry,
    onOpenChange,
}: {
    entry: RoomFileEntry | null
    onOpenChange: (open: boolean) => void
}) {
    const ext = entry ? getExtension(entry.name) : ''
    const textLike = entry ? TEXT_EXTENSIONS.has(ext) : false
    return (
        <Sheet open={entry !== null} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="gap-0 sm:max-w-md">
                {entry ? (
                    <>
                        <SheetHeader>
                            <SheetTitle className="truncate">{entry.name}</SheetTitle>
                            <SheetDescription>{describeSource(entry.surface)}</SheetDescription>
                        </SheetHeader>
                        <div className="flex flex-col gap-3 px-4 pb-4 text-xs">
                            <div className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1.5">
                                <span className="text-muted-foreground">Type</span>
                                <span className="font-mono uppercase text-foreground">
                                    {ext || '—'}
                                </span>
                                <span className="text-muted-foreground">Size</span>
                                <span className="text-foreground">
                                    {formatBytes(entry.byteLength)}
                                </span>
                                <span className="text-muted-foreground">Updated</span>
                                <span className="text-foreground">
                                    {formatRelativeTime(entry.updatedAt)}
                                </span>
                            </div>
                            <div className="rounded-md border border-dashed border-border/70 bg-muted/30 px-3 py-6 text-center text-muted-foreground">
                                {textLike
                                    ? 'Inline preview is not available yet — content streaming will be added once the file API is wired.'
                                    : 'Binary file. Metadata only.'}
                            </div>
                            <div className="flex justify-end">
                                <Button
                                    size="sm"
                                    variant="outline"
                                    disabled
                                    title="Download endpoint not available yet"
                                >
                                    <DownloadIcon />
                                    Download
                                </Button>
                            </div>
                        </div>
                    </>
                ) : null}
            </SheetContent>
        </Sheet>
    )
}
