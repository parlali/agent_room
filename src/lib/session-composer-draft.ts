export const maxSessionComposerDraftLength = 20_000
export const sessionComposerDraftSaveDebounceMs = 400

export interface SessionComposerDraftSnapshot {
    draft: string
    updatedAt: number | null
}

export function sessionComposerDraftKey(roomId: string, sessionKey: string): string {
    return `${roomId}:${sessionKey}`
}
