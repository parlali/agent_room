// @vitest-environment jsdom

import { act } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Composer } from './composer'

vi.mock('lucide-react', () => ({
    Loader2Icon: () => <svg data-testid="loader-icon" />,
    PaperclipIcon: () => <svg data-testid="paperclip-icon" />,
    SendIcon: () => <svg data-testid="send-icon" />,
    SquareIcon: () => <svg data-testid="square-icon" />,
}))

vi.mock('#/components/ui/tooltip', () => ({
    Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
    TooltipContent: ({ children }: { children: ReactNode }) => <span>{children}</span>,
    TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('./attachment-cards', () => ({
    AttachmentCards: () => <div data-testid="attachment-cards" />,
}))

vi.mock('./model-mode-menu', () => ({
    ModelModeMenu: () => <button type="button" aria-label="Model mode" />,
}))

const reactActGlobal = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true

describe('Composer file interactions', () => {
    let root: Root | null = null
    let container: HTMLDivElement | null = null

    afterEach(() => {
        if (root) {
            act(() => root?.unmount())
        }
        container?.remove()
        root = null
        container = null
    })

    it('attaches dropped files without inserting file paths into the draft', async () => {
        const onAttachFiles = vi.fn()
        const onChangeDraft = vi.fn()
        await renderComposer({
            onAttachFiles,
            onChangeDraft,
        })
        const textarea = composerTextarea()
        const file = new File(['image'], 'upload.png', {
            type: 'image/png',
        })
        const dataTransfer = dataTransferWithFiles([file])

        const dragOverEvent = fileEvent('dragover', 'dataTransfer', dataTransfer)
        await act(async () => {
            textarea.dispatchEvent(dragOverEvent)
        })
        expect(dragOverEvent.defaultPrevented).toBe(true)
        expect(dataTransfer.dropEffect).toBe('copy')

        const dropEvent = fileEvent('drop', 'dataTransfer', dataTransfer)
        await act(async () => {
            textarea.dispatchEvent(dropEvent)
        })

        expect(dropEvent.defaultPrevented).toBe(true)
        expect(onAttachFiles).toHaveBeenCalledWith([file])
        expect(onChangeDraft).not.toHaveBeenCalled()
    })

    it('attaches pasted image files without replacing the draft text', async () => {
        const onAttachFiles = vi.fn()
        const onChangeDraft = vi.fn()
        await renderComposer({
            draft: 'existing text',
            onAttachFiles,
            onChangeDraft,
        })
        const file = new File(['image'], 'clipboard.png', {
            type: 'image/png',
        })
        const pasteEvent = fileEvent('paste', 'clipboardData', dataTransferWithFiles([file]))

        await act(async () => {
            composerTextarea().dispatchEvent(pasteEvent)
        })

        expect(pasteEvent.defaultPrevented).toBe(true)
        expect(onAttachFiles).toHaveBeenCalledWith([file])
        expect(onChangeDraft).not.toHaveBeenCalled()
    })

    async function renderComposer(
        props: Partial<ComponentProps<typeof Composer>> = {},
    ): Promise<void> {
        container = document.createElement('div')
        document.body.append(container)
        root = createRoot(container)

        await act(async () => {
            root?.render(
                <Composer
                    roomId="room-1"
                    roomDisplayName="Room"
                    draft=""
                    onChangeDraft={vi.fn()}
                    onSubmit={(event) => event.preventDefault()}
                    onKeyDown={vi.fn()}
                    sending={false}
                    stopping={false}
                    canStop={false}
                    onStop={vi.fn()}
                    attachments={[]}
                    attaching={false}
                    onAttachFiles={vi.fn()}
                    onRemoveAttachment={vi.fn()}
                    modelState={null}
                    modelUpdating={false}
                    onChangeModel={vi.fn()}
                    {...props}
                />,
            )
        })
    }

    function composerTextarea(): HTMLTextAreaElement {
        const textarea = container?.querySelector('textarea')
        expect(textarea).toBeInstanceOf(HTMLTextAreaElement)
        return textarea as HTMLTextAreaElement
    }
})

function dataTransferWithFiles(files: File[]): DataTransfer {
    return {
        types: ['Files'],
        files,
        items: files.map((file) => ({
            kind: 'file',
            type: file.type,
            getAsFile: () => file,
        })),
        dropEffect: 'none',
    } as unknown as DataTransfer
}

function fileEvent(
    type: string,
    key: 'clipboardData' | 'dataTransfer',
    dataTransfer: DataTransfer,
) {
    const event = new Event(type, {
        bubbles: true,
        cancelable: true,
    })
    Object.defineProperty(event, key, {
        value: dataTransfer,
    })
    return event
}
