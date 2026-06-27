import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
    ChevronDownIcon,
    ExternalLinkIcon,
    Maximize2Icon,
    MessageSquareIcon,
    PackageOpenIcon,
    SparklesIcon,
    XIcon,
} from 'lucide-react'

import { Chip, EmptyState } from '#/components/agent-room'
import { RoomFileMetadata, RoomFilePreviewContent } from '#/components/room-files/file-preview'
import { RoomFileDownloadMenu } from '#/components/room-files/file-download-menu'
import { roomFileEntryIcon } from '#/components/room-files/file-kinds'
import { artifactProvenanceLabel, roomFileSurfaceLabel } from '#/domain/file-kinds'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { CardButton } from '#/components/ui/card'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '#/components/ui/dialog'
import { roomFileDownloadUrl, roomFilePreviewUrl } from '#/domain/room-file-links'
import { formatBytes, formatRelativeTime } from '#/domain/format'
import { cn } from '#/lib/utils'
import { roomQueryKey, roomQueryPolicy } from '#/lib/room-query-keys'
import { readRoomFileServer } from '#/routes/-room-runtime-server'
import type { RoomFileEntry, RoomFilePreview } from '#/domain/room-file-types'
import type { RoomSessionArtifact, RoomSessionArtifactKind } from '#/domain/room-execution-types'
import { resolveSelectedArtifact } from './session-artifact-state'

const artifactSections: Array<{
    kind: RoomSessionArtifactKind
    label: string
}> = [
    { kind: 'attached', label: 'Attached' },
    { kind: 'created', label: 'Created' },
    { kind: 'edited', label: 'Edited' },
    { kind: 'referenced', label: 'Referenced' },
]

export function SessionArtifactsPanel({
    roomId,
    artifacts,
    onClose,
    selectedArtifactId,
    onSelectArtifact,
    onViewInConversation,
    className,
}: {
    roomId: string
    artifacts: RoomSessionArtifact[]
    onClose?: () => void
    selectedArtifactId: string | null
    onSelectArtifact: (id: string) => void
    onViewInConversation?: (artifact: RoomSessionArtifact) => void
    className?: string
}) {
    const [expanded, setExpanded] = useState(false)
    const [previewCollapsed, setPreviewCollapsed] = useState(false)
    const selectedArtifact = resolveSelectedArtifact(artifacts, selectedArtifactId)
    const selectedId = selectedArtifact?.id ?? null
    const selectedEntry = selectedArtifact ? artifactToFileEntry(selectedArtifact) : null
    const previewQuery = useQuery({
        queryKey: roomQueryKey.roomFilePreview(
            roomId,
            selectedEntry?.surface,
            selectedEntry?.relativePath,
        ),
        queryFn: () =>
            readRoomFileServer({
                data: {
                    roomId,
                    surface: selectedEntry!.surface,
                    relativePath: selectedEntry!.relativePath,
                },
            }),
        enabled: selectedEntry !== null,
        staleTime: roomQueryPolicy.coldStaleMs,
    })
    const preview = previewQuery.data as RoomFilePreview | undefined
    const previewUrl = selectedEntry ? roomFilePreviewUrl(roomId, selectedEntry) : ''
    const downloadUrl = selectedEntry ? roomFileDownloadUrl(roomId, selectedEntry) : ''
    const grouped = useMemo(() => groupArtifacts(artifacts), [artifacts])
    const showPreview = Boolean(selectedEntry) && !previewCollapsed

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
                        <span className="text-sm font-medium">Files</span>
                        <Badge variant="secondary" className="h-5 px-1.5 text-[0.6875rem]">
                            {artifacts.length}
                        </Badge>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                        Files from this session
                    </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <Button asChild variant="ghost" size="icon-sm" aria-label="Open all room files">
                        <Link to="/rooms/$roomId/files" params={{ roomId }}>
                            <ExternalLinkIcon />
                        </Link>
                    </Button>
                    {onClose ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Close files"
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
                        title="No files yet"
                        description="Files attached, created, edited, or used in this session will appear here."
                    />
                </div>
            ) : (
                <div className="flex min-h-0 flex-1 flex-col">
                    <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                        {artifactSections.map((section) =>
                            grouped[section.kind].length > 0 ? (
                                <ArtifactSection
                                    key={section.kind}
                                    label={section.label}
                                    artifacts={grouped[section.kind]}
                                    selectedId={selectedId}
                                    onSelect={(id) => {
                                        setPreviewCollapsed(false)
                                        onSelectArtifact(id)
                                    }}
                                    onViewInConversation={onViewInConversation}
                                />
                            ) : null,
                        )}
                    </div>
                    {selectedEntry ? (
                        <div className="flex max-h-[60%] min-h-0 flex-col overflow-hidden border-t border-border/60">
                            <button
                                type="button"
                                onClick={() => setPreviewCollapsed((value) => !value)}
                                className="flex shrink-0 items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/40"
                                aria-expanded={showPreview}
                            >
                                <span className="min-w-0">
                                    <span className="block truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                        Preview
                                    </span>
                                    <span className="block truncate text-sm font-medium">
                                        {selectedEntry.name}
                                    </span>
                                </span>
                                <ChevronDownIcon
                                    className={cn(
                                        'size-4 shrink-0 text-muted-foreground transition-transform',
                                        showPreview ? '' : '-rotate-90',
                                    )}
                                />
                            </button>
                            {showPreview ? (
                                <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3">
                                    <div className="flex shrink-0 items-center justify-end gap-1">
                                        <RoomFileDownloadMenu
                                            roomId={roomId}
                                            entry={selectedEntry}
                                            preview={preview}
                                        />
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
                                    <div className="shrink-0">
                                        <RoomFileMetadata entry={selectedEntry} />
                                    </div>
                                    <div className="min-h-0 flex-1">
                                        <RoomFilePreviewContent
                                            entry={selectedEntry}
                                            preview={preview}
                                            previewUrl={previewUrl}
                                            downloadUrl={downloadUrl}
                                            loading={previewQuery.isLoading}
                                            error={previewQuery.error}
                                            onRetry={() => void previewQuery.refetch()}
                                            displayMode="fill"
                                        />
                                    </div>
                                </div>
                            ) : null}
                            <Dialog open={expanded} onOpenChange={setExpanded}>
                                <DialogContent className="grid max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-none grid-rows-[auto_minmax(0,1fr)] gap-3 p-4">
                                    <div className="flex min-w-0 items-start justify-between gap-3 pr-8">
                                        <DialogHeader className="min-w-0">
                                            <DialogTitle className="truncate">
                                                {selectedEntry.name}
                                            </DialogTitle>
                                            <DialogDescription className="truncate">
                                                {roomFileSurfaceLabel(selectedEntry.surface)} /{' '}
                                                {selectedEntry.relativePath}
                                            </DialogDescription>
                                        </DialogHeader>
                                        <RoomFileDownloadMenu
                                            roomId={roomId}
                                            entry={selectedEntry}
                                            preview={preview}
                                            variant="outline"
                                        />
                                    </div>
                                    <div className="h-full min-h-0">
                                        <RoomFilePreviewContent
                                            entry={selectedEntry}
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
                    ) : null}
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
    onViewInConversation,
}: {
    label: string
    artifacts: RoomSessionArtifact[]
    selectedId: string | null
    onSelect: (id: string) => void
    onViewInConversation?: (artifact: RoomSessionArtifact) => void
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
                        onViewInConversation={onViewInConversation}
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
    onViewInConversation,
}: {
    artifact: RoomSessionArtifact
    selected: boolean
    onSelect: () => void
    onViewInConversation?: (artifact: RoomSessionArtifact) => void
}) {
    const Icon = roomFileEntryIcon({ name: artifact.name, kind: 'file' })
    const canViewInConversation = Boolean(onViewInConversation && artifact.messageId)
    return (
        <div
            className={cn(
                'rounded-md',
                selected ? 'bg-muted text-foreground' : 'text-muted-foreground',
            )}
        >
            <CardButton
                size="sm"
                className="min-w-0 items-start gap-2 border-0 bg-transparent px-2 py-2 hover:bg-muted/60"
                onClick={onSelect}
            >
                <Icon className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                        {artifact.name}
                    </span>
                    <Chip bordered={false} icon={<SparklesIcon />} className="mt-0.5">
                        {artifactProvenanceLabel(artifact.kind)}
                        {artifact.timestamp ? ` · ${formatRelativeTime(artifact.timestamp)}` : ''}
                    </Chip>
                    <span className="mt-0.5 block truncate font-mono text-[0.6875rem]">
                        {artifact.relativePath}
                    </span>
                </span>
                <span className="shrink-0 text-[0.6875rem]">
                    {formatBytes(artifact.byteLength)}
                </span>
            </CardButton>
            {canViewInConversation ? (
                <div className="px-2 pb-1.5">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => onViewInConversation?.(artifact)}
                    >
                        <MessageSquareIcon />
                        View in conversation
                    </Button>
                </div>
            ) : null}
        </div>
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
