import { useEffect, useState } from 'react'
import { ChevronDownIcon, FilesIcon, Loader2Icon, MonitorIcon, PencilIcon } from 'lucide-react'

import { StateBadge } from '#/components/agent-room'
import { usageProviderLabel } from '#/domain/capability-labels'
import { Button } from '#/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '#/components/ui/collapsible'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { cn } from '#/lib/utils'
import { Label } from '#/components/ui/label'
import type { describeSessionState } from '#/domain/state'
import type { RoomExecutionSnapshot } from '#/domain/room-execution-types'

export function ChatHeader({
    sessionTitle,
    sessionLabel,
    sessionToneKey,
    provider,
    compaction,
    showArtifacts,
    artifactsCount,
    artifactsOpen,
    showBrowserSession,
    browserSessionOpen,
    onToggleArtifacts,
    onToggleBrowserSession,
    onRename,
    renaming,
}: {
    sessionTitle: string
    sessionLabel: string
    sessionToneKey: ReturnType<typeof describeSessionState>['tone']
    provider: string | null
    compaction: RoomExecutionSnapshot['threads'][number]['compaction'] | null
    showArtifacts: boolean
    artifactsCount: number
    artifactsOpen: boolean
    showBrowserSession: boolean
    browserSessionOpen: boolean
    onToggleArtifacts: () => void
    onToggleBrowserSession: () => void
    onRename: (title: string) => Promise<unknown>
    renaming: boolean
}) {
    const [renameOpen, setRenameOpen] = useState(false)
    const [renameTitle, setRenameTitle] = useState(sessionTitle)
    const modelLabel = provider ? usageProviderLabel(provider) : null
    const conversationLabel = compaction
        ? compaction.compacting
            ? 'Tidying up older messages'
            : compaction.enabled
              ? 'Keeps long conversations tidy automatically'
              : 'Keeps the full conversation'
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
                <div className="flex min-w-0 flex-1 flex-col leading-tight">
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
                    {modelLabel || conversationLabel ? (
                        <Collapsible>
                            <CollapsibleTrigger
                                className={cn(
                                    'group flex items-center gap-1 text-[0.6875rem] text-muted-foreground',
                                    'hover:text-foreground',
                                )}
                            >
                                Advanced
                                <ChevronDownIcon className="size-3 transition-transform group-data-[state=open]:rotate-180" />
                            </CollapsibleTrigger>
                            <CollapsibleContent className="flex flex-col text-[0.6875rem] text-muted-foreground">
                                {modelLabel ? <span className="truncate">{modelLabel}</span> : null}
                                {conversationLabel ? (
                                    <span className="truncate">{conversationLabel}</span>
                                ) : null}
                            </CollapsibleContent>
                        </Collapsible>
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
