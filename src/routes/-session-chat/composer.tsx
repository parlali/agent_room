import { useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { LoaderIcon, PaperclipIcon, SendIcon, SquareIcon } from 'lucide-react'

import { Button } from '#/components/ui/button'
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '#/components/ui/sheet'
import { Textarea } from '#/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip'

export function Composer({
    roomDisplayName,
    draft,
    onChangeDraft,
    onSubmit,
    onKeyDown,
    sending,
    stopping,
    canStop,
    onStop,
}: {
    roomDisplayName: string
    draft: string
    onChangeDraft: (value: string) => void
    onSubmit: (event: FormEvent<HTMLFormElement>) => void
    onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
    sending: boolean
    stopping: boolean
    canStop: boolean
    onStop: () => void
}) {
    const [attachOpen, setAttachOpen] = useState(false)
    const trimmed = draft.trim()

    return (
        <form
            onSubmit={onSubmit}
            className="sticky bottom-0 border-t border-border bg-background/95 px-3 py-3 backdrop-blur sm:px-6"
        >
            <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Attach a file"
                            onClick={() => setAttachOpen(true)}
                        >
                            <PaperclipIcon />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Attach a file</TooltipContent>
                </Tooltip>
                <Textarea
                    value={draft}
                    onChange={(event) => onChangeDraft(event.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder={`Message ${roomDisplayName}`}
                    className="max-h-48 min-h-10 flex-1 resize-none"
                    rows={1}
                />
                {canStop ? (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={onStop}
                                disabled={stopping}
                                aria-label="Stop generation"
                            >
                                <SquareIcon />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top">Stop</TooltipContent>
                    </Tooltip>
                ) : null}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            type="submit"
                            size="icon"
                            disabled={sending || !trimmed}
                            aria-label="Send message"
                        >
                            {sending ? <LoaderIcon className="animate-spin" /> : <SendIcon />}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Send · Cmd+Enter</TooltipContent>
                </Tooltip>
            </div>
            <Sheet open={attachOpen} onOpenChange={setAttachOpen}>
                <SheetContent side="right" className="w-full sm:max-w-md">
                    <SheetHeader>
                        <SheetTitle>Attach files</SheetTitle>
                        <SheetDescription>File uploads from chat are coming soon.</SheetDescription>
                    </SheetHeader>
                    <div className="px-4 pb-6 text-sm text-muted-foreground">
                        For now, manage files from the room files page.
                    </div>
                </SheetContent>
            </Sheet>
        </form>
    )
}
