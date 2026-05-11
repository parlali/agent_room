import type { RoomFileEntry, RoomFilePreview, RoomFileSurface } from '#/server/rooms/file-store'
import { formatBytes, formatRelativeTime } from '#/lib/format'

const officeExtensions = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp'])

const textPreviewLimitBytes = 512000

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
    expanded = false,
}: {
    entry: RoomFileEntry
    preview: RoomFilePreview | undefined
    previewUrl: string
    loading: boolean
    error: unknown
    expanded?: boolean
}) {
    const extension = getRoomFileExtension(entry.name)
    const officeLike = officeExtensions.has(extension)
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
                <iframe
                    src={previewUrl}
                    title={entry.name}
                    className={
                        expanded
                            ? 'h-full min-h-0 flex-1 border-0 bg-background'
                            : 'h-[34rem] w-full border-0 bg-background'
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
                    Only the first {formatBytes(textPreviewLimitBytes)} is shown.
                </div>
            ) : null}
        </div>
    )
}
