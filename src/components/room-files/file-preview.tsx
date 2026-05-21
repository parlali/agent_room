import { useEffect, useState } from 'react'
import { Loader2Icon } from 'lucide-react'

import type { RoomFileEntry, RoomFilePreview, RoomFileSurface } from '#/lib/room-file-types'
import { formatBytes, formatRelativeTime } from '#/lib/format'
import { cn } from '#/lib/utils'

const officeExtensions = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp'])

const textPreviewLimitBytes = 512000

type PreviewDisplayMode = 'inline' | 'fill' | 'expanded'

export function getRoomFileExtension(name: string): string {
    const idx = name.lastIndexOf('.')
    if (idx <= 0 || idx === name.length - 1) return ''
    return name.slice(idx + 1).toLowerCase()
}

export function describeRoomFileSurface(surface: RoomFileSurface): string {
    return surface === 'workspace' ? 'Workspace' : 'Uploads'
}

export function RoomFileMetadata({ entry }: { entry: RoomFileEntry }) {
    return (
        <div className="rounded-md border border-border/60 p-3">
            <div className="truncate text-sm font-medium text-foreground">{entry.name}</div>
            <div className="mt-2 grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-1 text-xs">
                <span className="text-muted-foreground">Path</span>
                <span className="truncate text-foreground">{entry.relativePath}</span>
                <span className="text-muted-foreground">Root</span>
                <span className="text-foreground">{describeRoomFileSurface(entry.surface)}</span>
                <span className="text-muted-foreground">Size</span>
                <span className="text-foreground">{formatBytes(entry.byteLength)}</span>
                <span className="text-muted-foreground">Updated</span>
                <span className="text-foreground">{formatRelativeTime(entry.updatedAt)}</span>
            </div>
        </div>
    )
}

export function RoomFilePreviewContent({
    entry,
    preview,
    previewUrl,
    loading,
    error,
    displayMode,
    expanded = false,
}: {
    entry: RoomFileEntry
    preview: RoomFilePreview | undefined
    previewUrl: string
    loading: boolean
    error: unknown
    displayMode?: PreviewDisplayMode
    expanded?: boolean
}) {
    const extension = getRoomFileExtension(entry.name)
    const officeLike = officeExtensions.has(extension)
    const mode = displayMode ?? (expanded ? 'expanded' : 'inline')
    const fillsAvailableSpace = mode !== 'inline'
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
            <div
                className={cn(
                    'flex min-h-0 overflow-hidden rounded-md border border-border/60 bg-muted/30',
                    fillsAvailableSpace && 'h-full',
                )}
            >
                <img
                    src={previewUrl}
                    alt={entry.name}
                    className={cn(
                        'w-full object-contain',
                        mode === 'inline'
                            ? 'max-h-[34rem]'
                            : 'h-full min-h-0 max-h-[calc(100vh-9rem)]',
                    )}
                />
            </div>
        )
    }
    if (preview.kind === 'pdf') {
        return (
            <div
                className={cn(
                    'flex min-h-0 flex-col overflow-hidden rounded-md border border-border/60 bg-muted/30',
                    fillsAvailableSpace && 'h-full',
                )}
            >
                {preview.generated || officeLike ? (
                    <div className="border-b border-border/60 px-3 py-2 text-xs text-muted-foreground">
                        Preview generated from {extension.toUpperCase()}
                    </div>
                ) : null}
                <PdfPreviewFrame entry={entry} previewUrl={previewUrl} mode={mode} />
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
        <div
            className={cn(
                'flex min-h-0 flex-col overflow-hidden rounded-md border border-border/60 bg-muted/30',
                fillsAvailableSpace && 'h-full',
            )}
        >
            <pre
                className={cn(
                    'whitespace-pre-wrap p-3 font-mono text-xs text-foreground',
                    mode === 'inline'
                        ? 'max-h-[34rem] overflow-auto'
                        : 'min-h-0 flex-1 overflow-auto',
                )}
            >
                {preview.content}
            </pre>
            {preview.truncated ? (
                <div className="border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
                    Only the first {formatBytes(textPreviewLimitBytes)} is shown.
                </div>
            ) : null}
        </div>
    )
}

function PdfPreviewFrame({
    entry,
    previewUrl,
    mode,
}: {
    entry: RoomFileEntry
    previewUrl: string
    mode: PreviewDisplayMode
}) {
    const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
    const loaded = loadedUrl === previewUrl

    useEffect(() => {
        setLoadedUrl(null)
    }, [previewUrl])

    return (
        <div
            className={cn(
                'relative overflow-hidden bg-muted/30',
                mode === 'inline' ? 'h-[34rem] w-full' : 'min-h-0 flex-1',
            )}
        >
            <iframe
                src={previewUrl}
                title={entry.name}
                onLoad={() => {
                    requestAnimationFrame(() => setLoadedUrl(previewUrl))
                }}
                className={cn(
                    'h-full w-full border-0 bg-transparent transition-opacity duration-150',
                    loaded ? 'opacity-100' : 'opacity-0',
                )}
            />
            {!loaded ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-muted/40 px-4 text-center text-sm text-muted-foreground">
                    <Loader2Icon className="size-4 animate-spin text-working-fg" />
                    <span>Loading PDF preview</span>
                </div>
            ) : null}
        </div>
    )
}
