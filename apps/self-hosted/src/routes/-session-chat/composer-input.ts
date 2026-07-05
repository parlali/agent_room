export interface ComposerKeyEvent {
    key: string
    shiftKey: boolean
    isComposing: boolean
    canSubmit: boolean
}

export function shouldSendOnEnter(event: ComposerKeyEvent): boolean {
    if (event.key !== 'Enter') return false
    if (event.isComposing) return false
    if (event.shiftKey) return false
    if (!event.canSubmit) return false
    return true
}
