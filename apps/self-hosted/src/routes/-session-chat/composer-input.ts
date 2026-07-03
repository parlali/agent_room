export interface ComposerKeyEvent {
    key: string
    shiftKey: boolean
    isComposing: boolean
}

export function shouldSendOnEnter(event: ComposerKeyEvent): boolean {
    if (event.key !== 'Enter') return false
    if (event.isComposing) return false
    if (event.shiftKey) return false
    return true
}
