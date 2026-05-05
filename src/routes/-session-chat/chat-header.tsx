import { Link } from '@tanstack/react-router'
import { ArrowLeftIcon } from 'lucide-react'

import { RoomGlyph, StateBadge } from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import type { describeSessionState } from '#/lib/state'
import type { RoomExecutionSnapshot, RoomRuntimeOverview } from '#/server/rooms/execution-types'

export function ChatHeader({
    room,
    sessionTitle,
    sessionLabel,
    sessionToneKey,
    provider,
    model,
    compaction,
    onBack,
}: {
    room: RoomRuntimeOverview
    sessionTitle: string
    sessionLabel: string
    sessionToneKey: ReturnType<typeof describeSessionState>['tone']
    provider: string | null
    model: string | null
    compaction: RoomExecutionSnapshot['threads'][number]['compaction'] | null
    onBack: () => void
}) {
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
    return (
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
                <span className="truncate text-sm font-medium text-foreground">{sessionTitle}</span>
                {modelLabel ? (
                    <span className="truncate text-[0.6875rem] text-muted-foreground">
                        {modelLabel}
                        {compactionLabel ? ` · ${compactionLabel}` : ''}
                    </span>
                ) : null}
            </div>
            <StateBadge
                tone={sessionToneKey}
                label={sessionLabel}
                pulse={sessionToneKey === 'working'}
            />
        </header>
    )
}
