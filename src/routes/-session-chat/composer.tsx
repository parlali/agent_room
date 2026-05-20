import { useRef } from 'react'
import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react'
import { PaperclipIcon, SendIcon, SquareIcon } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip'
import type { RoomAttachment } from '#/lib/room-attachments'
import type { RoomExecutionModelState } from '#/lib/room-execution-types'
import { maxSessionComposerDraftLength } from '#/lib/session-composer-draft'
import { AttachmentCards } from './attachment-cards'
import { ModelModeMenu, type ModelModeChange } from './model-mode-menu'

export type ComposerAttachment = RoomAttachment

export function Composer({
    roomId,
    roomDisplayName,
    draft,
    onChangeDraft,
    onSubmit,
    onKeyDown,
    sending,
    stopping,
    canStop,
    onStop,
    attachments,
    attaching,
    onAttachFiles,
    onRemoveAttachment,
    modelState,
    modelUpdating,
    onChangeModel,
}: {
    roomId: string
    roomDisplayName: string
    draft: string
    onChangeDraft: (value: string) => void
    onSubmit: (event: FormEvent<HTMLFormElement>) => void
    onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
    sending: boolean
    stopping: boolean
    canStop: boolean
    onStop: () => void
    attachments: ComposerAttachment[]
    attaching: boolean
    onAttachFiles: (files: FileList) => void
    onRemoveAttachment: (id: string) => void
    modelState: RoomExecutionModelState | null
    modelUpdating: boolean
    onChangeModel: (change: ModelModeChange) => void
}) {
    const fileInputRef = useRef<HTMLInputElement | null>(null)
    const trimmed = draft.trim()
    const canSend = trimmed.length > 0 || attachments.length > 0
    const showingStopAction = canStop || stopping
    const primaryActionLoading = showingStopAction ? stopping : sending
    const primaryActionDisabled = showingStopAction ? false : attaching || !canSend
    const primaryActionLabel = showingStopAction ? 'Stop generation' : 'Send message'
    const primaryActionTooltip = showingStopAction ? 'Stop' : 'Send · Cmd+Enter'
    const onFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files
        if (files && files.length > 0) {
            onAttachFiles(files)
        }
        event.target.value = ''
    }

    return (
        <form
            onSubmit={onSubmit}
            className="sticky bottom-0 border-t border-border bg-background/95 px-3 py-3 backdrop-blur sm:px-6"
        >
            {attachments.length > 0 ? (
                <div className="mx-auto mb-2 w-full max-w-5xl">
                    <AttachmentCards
                        roomId={roomId}
                        attachments={attachments}
                        onRemove={onRemoveAttachment}
                    />
                </div>
            ) : null}
            <div className="mx-auto flex w-full max-w-5xl items-end gap-2">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Attach a file"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={sending}
                            loading={attaching}
                        >
                            <PaperclipIcon />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Attach a file</TooltipContent>
                </Tooltip>
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={onFileInputChange}
                />
                <Textarea
                    value={draft}
                    onChange={(event) => onChangeDraft(event.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder={`Message ${roomDisplayName}`}
                    className="max-h-48 min-h-10 flex-1 resize-none"
                    maxLength={maxSessionComposerDraftLength}
                    rows={1}
                />
                <ModelModeMenu
                    state={modelState}
                    disabled={sending || stopping || canStop}
                    updating={modelUpdating}
                    onChange={onChangeModel}
                />
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            type={showingStopAction ? 'button' : 'submit'}
                            variant={showingStopAction ? 'outline' : 'default'}
                            size="icon"
                            onClick={showingStopAction ? onStop : undefined}
                            disabled={primaryActionDisabled}
                            loading={primaryActionLoading}
                            aria-label={primaryActionLabel}
                            className={
                                showingStopAction
                                    ? 'active:not-aria-[haspopup]:translate-y-0'
                                    : undefined
                            }
                        >
                            {showingStopAction ? <SquareIcon className="size-3.5" /> : <SendIcon />}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">{primaryActionTooltip}</TooltipContent>
                </Tooltip>
            </div>
        </form>
    )
}
