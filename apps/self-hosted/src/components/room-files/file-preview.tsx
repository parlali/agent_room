import { useEffect, useState } from 'react'
import { FileXIcon, Loader2Icon, TriangleAlertIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import type { RoomFileEntry, RoomFilePreview } from '#/domain/room-file-types'
import { fileExtensionLabel, isOfficeFile, roomFileSurfaceLabel } from '#/domain/file-kinds'
import { roomFileEntryIcon } from './file-kinds'
import { formatBytes, formatRelativeTime } from '#/domain/format'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'

const textPreviewLimitBytes = 512000

type PreviewDisplayMode = 'inline' | 'fill' | 'expanded'

function PreviewState({
    tone = 'muted',
    icon,
    title,
    description,
    action,
}: {
    tone?: 'muted' | 'danger'
    icon: ReactNode
    title: string
    description?: ReactNode
    action?: ReactNode
}) {
    return (
        <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 rounded-md border border-border/60 px-3 py-8 text-center">
            <span className={cn(tone === 'danger' ? 'text-danger-fg' : 'text-muted-foreground')}>
                {icon}
            </span>
            <div className="text-sm font-medium text-foreground">{title}</div>
            {description ? (
                <div className="max-w-sm text-xs text-muted-foreground">{description}</div>
            ) : null}
            {action ? <div className="mt-1">{action}</div> : null}
        </div>
    )
}

export function RoomFileMetadata({ entry }: { entry: RoomFileEntry }) {
    return (
        <div className="rounded-md border border-border/60 p-3">
            <div className="truncate text-sm font-medium text-foreground">{entry.name}</div>
            <div className="mt-2 grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-1 text-xs">
                <span className="text-muted-foreground">Path</span>
                <span className="truncate text-foreground">{entry.relativePath}</span>
                <span className="text-muted-foreground">Where</span>
                <span className="text-foreground">{roomFileSurfaceLabel(entry.surface)}</span>
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
    downloadUrl,
    loading,
    error,
    onRetry,
    displayMode,
    expanded = false,
}: {
    entry: RoomFileEntry
    preview: RoomFilePreview | undefined
    previewUrl: string
    downloadUrl?: string
    loading: boolean
    error: unknown
    onRetry?: () => void
    displayMode?: PreviewDisplayMode
    expanded?: boolean
}) {
    const extensionLabel = fileExtensionLabel(entry.name)
    const officeLike = isOfficeFile(entry.name)
    const mode = displayMode ?? (expanded ? 'expanded' : 'inline')
    const fillsAvailableSpace = mode !== 'inline'
    if (loading) {
        return (
            <PreviewState
                icon={<Loader2Icon className="size-5 animate-spin text-working-fg" />}
                title="Preparing preview"
                description="Loading this file from the room."
            />
        )
    }
    if (error) {
        return (
            <PreviewState
                tone="danger"
                icon={<TriangleAlertIcon className="size-5" />}
                title="Could not load this file"
                description={error instanceof Error ? error.message : 'The preview failed to load.'}
                action={
                    onRetry ? (
                        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                            Try again
                        </Button>
                    ) : null
                }
            />
        )
    }
    if (!preview) {
        const Icon = roomFileEntryIcon(entry)
        return (
            <PreviewState
                icon={<Icon className="size-5" />}
                title="No preview to show"
                description="Select a file to preview it."
            />
        )
    }
    if (preview.kind === 'unsupported') {
        return (
            <PreviewState
                icon={<FileXIcon className="size-5" />}
                title="No preview available"
                description={preview.reason}
                action={
                    downloadUrl ? (
                        <Button asChild variant="outline" size="sm">
                            <a href={downloadUrl} download={entry.name}>
                                Download file
                            </a>
                        </Button>
                    ) : null
                }
            />
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
                <ImagePreview entry={entry} previewUrl={previewUrl} mode={mode} />
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
                        Preview generated from {extensionLabel ?? 'this document'}
                    </div>
                ) : null}
                <PdfPreviewFrame entry={entry} previewUrl={previewUrl} mode={mode} />
            </div>
        )
    }
    if (preview.kind !== 'text') {
        return (
            <PreviewState
                icon={<FileXIcon className="size-5" />}
                title="No preview available"
                description="This file type cannot be shown here."
            />
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
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
                    <span>Only the first {formatBytes(textPreviewLimitBytes)} is shown.</span>
                    {downloadUrl ? (
                        <Button asChild variant="outline" size="sm">
                            <a href={downloadUrl} download={entry.name}>
                                Download full file
                            </a>
                        </Button>
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}

function ImagePreview({
    entry,
    previewUrl,
    mode,
}: {
    entry: RoomFileEntry
    previewUrl: string
    mode: PreviewDisplayMode
}) {
    const [failed, setFailed] = useState(false)
    const Icon = roomFileEntryIcon(entry)

    useEffect(() => {
        setFailed(false)
    }, [previewUrl])

    if (failed) {
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 py-8 text-center text-sm text-muted-foreground">
                <Icon className="size-6" />
                <span>This image could not be loaded.</span>
            </div>
        )
    }
    return (
        <img
            src={previewUrl}
            alt={entry.name}
            onError={() => setFailed(true)}
            className={cn(
                'w-full object-contain',
                mode === 'inline' ? 'max-h-[34rem]' : 'h-full min-h-0 max-h-[calc(100dvh-9rem)]',
            )}
        />
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
