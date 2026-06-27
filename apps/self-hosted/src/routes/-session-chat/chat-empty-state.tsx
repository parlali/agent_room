import { ArrowUpRightIcon } from 'lucide-react'

import { RoomGlyph } from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import type { RoomRuntimeOverview } from '#/domain/room-execution-types'

const suggestedPrompts = [
    'Search the web and summarize what you find on a topic I care about.',
    'Read a link I paste and pull out the key points.',
    'Draft a short document from a few bullet points.',
]

export function ChatEmptyState({
    room,
    onSuggestPrompt,
}: {
    room: RoomRuntimeOverview
    onSuggestPrompt: (text: string) => void
}) {
    return (
        <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-5 px-2 py-10 text-center">
            <RoomGlyph name={room.displayName} seed={room.roomId} size="lg" />
            <div className="flex flex-col gap-1.5">
                <h2 className="text-lg font-semibold text-foreground">
                    Start working with {room.displayName}
                </h2>
                <p className="text-sm text-muted-foreground">
                    I can search the web, read links you share, work with your files, and draft
                    documents. Ask for anything, or try one of these.
                </p>
            </div>
            <div className="flex w-full flex-col gap-2">
                {suggestedPrompts.map((prompt) => (
                    <Button
                        key={prompt}
                        type="button"
                        variant="outline"
                        className="h-auto w-full justify-between gap-3 px-3.5 py-2.5 text-left text-sm font-normal whitespace-normal"
                        onClick={() => onSuggestPrompt(prompt)}
                    >
                        <span className="min-w-0 flex-1">{prompt}</span>
                        <ArrowUpRightIcon className="size-4 shrink-0 text-muted-foreground" />
                    </Button>
                ))}
            </div>
        </div>
    )
}
