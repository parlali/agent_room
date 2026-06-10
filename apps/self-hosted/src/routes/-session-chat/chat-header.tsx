import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { ArrowLeftIcon, FilesIcon, Loader2Icon, MonitorIcon, PencilIcon } from 'lucide-react'

import { RoomGlyph, StateBadge } from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import type { describeSessionState } from '#/domain/state'
import type { RoomExecutionSnapshot, RoomRuntimeOverview } from '#/domain/room-execution-types'

export function ChatHeader({
    room,
    sessionTitle,
    sessionLabel,
    sessionToneKey,
    provider,
    model,
    compaction,
    showArtifacts,
    artifactsCount,
    artifactsOpen,
    showBrowserSession,
    browserSessionOpen,
    onToggleArtifacts,
    onToggleBrowserSession,
    onBack,
    onRename,
    renaming,
}: {
    room: RoomRuntimeOverview
    sessionTitle: string
    sessionLabel: string
    sessionToneKey: ReturnType<typeof describeSessionState>['tone']
    provider: string | null
    model: string | null
    compaction: RoomExecutionSnapshot['threads'][number]['compaction'] | null
    showArtifacts: boolean
    artifactsCount: number
    artifactsOpen: boolean
    showBrowserSession: boolean
    browserSessionOpen: boolean
    onToggleArtifacts: () => void
    onToggleBrowserSession: () => void
    onBack: () => void
    onRename: (title: string) => Promise<unknown>
    renaming: boolean
}) {
    const [renameOpen, setRenameOpen] = useState(false)
    const [renameTitle, setRenameTitle] = useState(sessionTitle)
    const modelLabel = [provider, model].filter(Boolean).join(' / ')
    const compactionLabel = compaction
        ? compaction.compacting
            ? 'Compacting context'
            : compaction.count > 0
              ? `Context compacted ${compaction.count} ${compaction.count === 1 ? 'time' : 'times'}`
              : compaction.enabled
                ? 'Auto-compact on'
                : 'Auto-compact off'
        : null

    useEffect(() => {
        if (!renameOpen) setRenameTitle(sessionTitle)
    }, [renameOpen, sessionTitle])

    const submitRename = async () => {
        const title = renameTitle.trim()
        if (!title || title === sessionTitle.trim()) {
            setRenameOpen(false)
            return
        }
        await onRename(title)
        setRenameOpen(false)
    }

    return (
        <>
            <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background/95 px-3 py-2.5 backdrop-blur sm:px-6">
                <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="Back to room">
                    <ArrowLeftIcon />
                </Button>
                <RoomGlyph name={room.displayName} seed={room.roomId} size="sm" />
                <div className="flex min-w-0 flex-1 flex-col leading-tight">
                    <Link
                        to="/rooms/$roomId"
                        params={{ roomId: room.roomId }}
                        className="truncate text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                        {room.displayName}
                    </Link>
                    <div className="flex min-w-0 items-center gap-1">
                        <span className="truncate text-sm font-medium text-foreground">
                            {sessionTitle}
                        </span>
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            className="shrink-0 text-muted-foreground"
                            onClick={() => setRenameOpen(true)}
                            aria-label="Rename session"
                        >
                            <PencilIcon className="size-3.5" />
                        </Button>
                    </div>
                    {modelLabel ? (
                        <span className="truncate text-[0.6875rem] text-muted-foreground">
                            {modelLabel}
                            {compactionLabel ? ` · ${compactionLabel}` : ''}
                        </span>
                    ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    {showArtifacts ? (
                        <Button
                            type="button"
                            variant={artifactsOpen ? 'secondary' : 'ghost'}
                            size="sm"
                            onClick={onToggleArtifacts}
                            aria-pressed={artifactsOpen}
                            aria-label="Toggle session artifacts"
                        >
                            <FilesIcon />
                            <span className="hidden sm:inline">Artifacts</span>
                            {artifactsCount > 0 ? (
                                <span className="ml-0.5 rounded bg-background/80 px-1 text-[0.6875rem]">
                                    {artifactsCount}
                                </span>
                            ) : null}
                        </Button>
                    ) : null}
                    {showBrowserSession ? (
                        <Button
                            type="button"
                            variant={browserSessionOpen ? 'secondary' : 'ghost'}
                            size="sm"
                            onClick={onToggleBrowserSession}
                            aria-pressed={browserSessionOpen}
                            aria-expanded={browserSessionOpen}
                            aria-label="Toggle browser session"
                        >
                            <MonitorIcon />
                            <span className="hidden sm:inline">Browser</span>
                        </Button>
                    ) : null}
                    <StateBadge
                        tone={sessionToneKey}
                        label={sessionLabel}
                        pulse={sessionToneKey === 'working'}
                    />
                </div>
            </header>
            <Dialog
                open={renameOpen}
                onOpenChange={(open) => {
                    if (!open && !renaming) setRenameOpen(false)
                    if (open) setRenameOpen(true)
                }}
            >
                <DialogContent>
                    <form
                        onSubmit={(event) => {
                            event.preventDefault()
                            void submitRename()
                        }}
                    >
                        <DialogHeader>
                            <DialogTitle>Rename session</DialogTitle>
                            <DialogDescription>
                                Give this conversation a title that is easy to find later.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="py-4">
                            <Label htmlFor="chat-session-title" className="sr-only">
                                Session title
                            </Label>
                            <Input
                                id="chat-session-title"
                                value={renameTitle}
                                onChange={(event) => setRenameTitle(event.target.value)}
                                placeholder="Session title"
                                autoFocus
                                disabled={renaming}
                            />
                        </div>
                        <DialogFooter>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setRenameOpen(false)}
                                disabled={renaming}
                            >
                                Cancel
                            </Button>
                            <Button type="submit" disabled={renaming || !renameTitle.trim()}>
                                {renaming ? <Loader2Icon className="animate-spin" /> : null}
                                Save
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </>
    )
}
