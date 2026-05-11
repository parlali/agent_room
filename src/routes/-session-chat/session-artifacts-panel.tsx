import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import {
    ExternalLinkIcon,
    FileIcon,
    FileImageIcon,
    FileTextIcon,
    Maximize2Icon,
    PackageOpenIcon,
    XIcon,
} from 'lucide-react'

import { EmptyState } from '#/components/agent-room'
import {
    RoomFileMetadata,
    RoomFilePreviewContent,
    describeRoomFileSurface,
    getRoomFileExtension,
} from '#/components/room-files/file-preview'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '#/components/ui/dialog'
import { roomFilePreviewUrl } from '#/lib/room-file-links'
import { formatBytes, formatRelativeTime } from '#/lib/format'
import { cn } from '#/lib/utils'
import { readRoomFileServer } from '#/routes/-room-runtime-server'
import type { RoomFileEntry, RoomFilePreview } from '#/lib/room-file-types'
import type { RoomSessionArtifact, RoomSessionArtifactKind } from '#/lib/room-execution-types'

const artifactSections: Array<{
    kind: RoomSessionArtifactKind
    label: string
}> = [
    { kind: 'attached', label: 'Attached' },
    { kind: 'created', label: 'Created' },
    { kind: 'edited', label: 'Edited' },
    { kind: 'referenced', label: 'Referenced' },
]

const textExtensions = new Set([
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

const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'])

export function SessionArtifactsPanel({
    roomId,
    artifacts,
    onClose,
    className,
}: {
    roomId: string
    artifacts: RoomSessionArtifact[]
    onClose?: () => void
    className?: string
}) {
    const [selectedId, setSelectedId] = useState<string | null>(artifacts[0]?.id ?? null)
    const [expanded, setExpanded] = useState(false)
    const selectedArtifact = artifacts.find((artifact) => artifact.id === selectedId) ?? null
    const selectedEntry = selectedArtifact ? artifactToFileEntry(selectedArtifact) : null
    const previewQuery = useQuery({
        queryKey: [
            'room-file-preview',
            roomId,
            selectedEntry?.surface,
            selectedEntry?.relativePath,
        ],
        queryFn: () =>
            readRoomFileServer({
                data: {
                    roomId,
                    surface: selectedEntry!.surface,
                    relativePath: selectedEntry!.relativePath,
                },
            }),
        enabled: selectedEntry !== null,
        staleTime: 60_000,
    })
    const preview = previewQuery.data as RoomFilePreview | undefined
    const previewUrl = selectedEntry ? roomFilePreviewUrl(roomId, selectedEntry) : ''
    const grouped = useMemo(() => groupArtifacts(artifacts), [artifacts])

    useEffect(() => {
        if (artifacts.length === 0) {
            setSelectedId(null)
            return
        }
        if (!selectedId || !artifacts.some((artifact) => artifact.id === selectedId)) {
            setSelectedId(artifacts[0]!.id)
        }
    }, [artifacts, selectedId])

    return (
        <aside
            className={cn(
                'flex h-full min-h-0 flex-col bg-background text-sm text-foreground',
                className,
            )}
        >
            <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">Artifacts</span>
                        <Badge variant="secondary" className="h-5 px-1.5 text-[0.6875rem]">
                            {artifacts.length}
                        </Badge>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                        Files from this session
                    </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <Button asChild variant="ghost" size="icon-sm" aria-label="Open Files page">
                        <Link to="/rooms/$roomId/files" params={{ roomId }}>
                            <ExternalLinkIcon />
                        </Link>
                    </Button>
                    {onClose ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Close artifacts"
                            onClick={onClose}
                        >
                            <XIcon />
                        </Button>
                    ) : null}
                </div>
            </div>
            {artifacts.length === 0 ? (
                <div className="flex min-h-0 flex-1 items-center justify-center p-4">
                    <EmptyState
                        icon={PackageOpenIcon}
                        title="No artifacts yet"
                        description="Files attached, created, edited, or inspected in this session will appear here."
                    />
                </div>
            ) : (
                <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,0.95fr)_minmax(15rem,1.05fr)]">
                    <div className="min-h-0 overflow-y-auto px-2 py-2">
                        {artifactSections.map((section) =>
                            grouped[section.kind].length > 0 ? (
                                <ArtifactSection
                                    key={section.kind}
                                    label={section.label}
                                    artifacts={grouped[section.kind]}
                                    selectedId={selectedId}
                                    onSelect={setSelectedId}
                                />
                            ) : null,
                        )}
                    </div>
                    <div className="min-h-0 overflow-y-auto border-t border-border/60 p-3">
                        {selectedEntry ? (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                            Preview
                                        </div>
                                        <div className="truncate text-sm font-medium">
                                            {selectedEntry.name}
                                        </div>
                                    </div>
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
                                <RoomFileMetadata entry={selectedEntry} />
                                <RoomFilePreviewContent
                                    entry={selectedEntry}
                                    preview={preview}
                                    previewUrl={previewUrl}
                                    loading={previewQuery.isLoading}
                                    error={previewQuery.error}
                                />
                                <Dialog open={expanded} onOpenChange={setExpanded}>
                                    <DialogContent className="grid h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-none grid-rows-[auto_minmax(0,1fr)] gap-3 p-4">
                                        <DialogHeader className="min-w-0 pr-8">
                                            <DialogTitle className="truncate">
                                                {selectedEntry.name}
                                            </DialogTitle>
                                            <DialogDescription className="truncate">
                                                {describeRoomFileSurface(selectedEntry.surface)} /{' '}
                                                {selectedEntry.relativePath}
                                            </DialogDescription>
                                        </DialogHeader>
                                        <div className="h-full min-h-0">
                                            <RoomFilePreviewContent
                                                entry={selectedEntry}
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
                        ) : null}
                    </div>
                </div>
            )}
        </aside>
    )
}

function ArtifactSection({
    label,
    artifacts,
    selectedId,
    onSelect,
}: {
    label: string
    artifacts: RoomSessionArtifact[]
    selectedId: string | null
    onSelect: (id: string) => void
}) {
    return (
        <section className="mb-3 last:mb-0">
            <div className="px-1 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {label}
            </div>
            <div className="space-y-1">
                {artifacts.map((artifact) => (
                    <ArtifactRow
                        key={artifact.id}
                        artifact={artifact}
                        selected={artifact.id === selectedId}
                        onSelect={() => onSelect(artifact.id)}
                    />
                ))}
            </div>
        </section>
    )
}

function ArtifactRow({
    artifact,
    selected,
    onSelect,
}: {
    artifact: RoomSessionArtifact
    selected: boolean
    onSelect: () => void
}) {
    const Icon = iconForArtifact(artifact)
    return (
        <button
            type="button"
            className={cn(
                'flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/60',
                selected ? 'bg-muted text-foreground' : 'text-muted-foreground',
            )}
            onClick={onSelect}
        >
            <Icon className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                    {artifact.name}
                </span>
                <span className="mt-0.5 block truncate text-xs">
                    {artifact.source}
                    {artifact.timestamp ? ` · ${formatRelativeTime(artifact.timestamp)}` : ''}
                </span>
                <span className="mt-0.5 block truncate font-mono text-[0.6875rem]">
                    {artifact.relativePath}
                </span>
            </span>
            <span className="shrink-0 text-[0.6875rem]">{formatBytes(artifact.byteLength)}</span>
        </button>
    )
}

function groupArtifacts(artifacts: RoomSessionArtifact[]) {
    return artifactSections.reduce(
        (groups, section) => {
            groups[section.kind] = artifacts.filter((artifact) => artifact.kind === section.kind)
            return groups
        },
        {
            attached: [],
            created: [],
            edited: [],
            referenced: [],
        } as Record<RoomSessionArtifactKind, RoomSessionArtifact[]>,
    )
}

function artifactToFileEntry(artifact: RoomSessionArtifact): RoomFileEntry {
    return {
        name: artifact.name,
        relativePath: artifact.relativePath,
        surface: artifact.surface,
        kind: 'file',
        byteLength: artifact.byteLength,
        updatedAt: artifact.timestamp ? new Date(artifact.timestamp).toISOString() : null,
    }
}

function iconForArtifact(artifact: RoomSessionArtifact) {
    const ext = getRoomFileExtension(artifact.name)
    if (imageExtensions.has(ext)) return FileImageIcon
    if (textExtensions.has(ext)) return FileTextIcon
    return FileIcon
}
