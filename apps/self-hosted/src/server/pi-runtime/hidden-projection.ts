import type { AgentSession, SessionEntry } from '@mariozechner/pi-coding-agent'

export const hiddenProjectionEntryType = 'agent_room.hidden_projection.v1'

export interface HiddenProjectionMetadata {
    hiddenEntryId?: string
    hiddenText?: string
}

export function hiddenProjectionMetadataFromValue(value: unknown): HiddenProjectionMetadata | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return null
    }
    const hiddenEntryId =
        'hiddenEntryId' in value && typeof value.hiddenEntryId === 'string'
            ? value.hiddenEntryId
            : undefined
    const hiddenText =
        'hiddenText' in value && typeof value.hiddenText === 'string' ? value.hiddenText : undefined
    if (!hiddenEntryId && !hiddenText) {
        return null
    }
    return { hiddenEntryId, hiddenText }
}

export function hiddenProjectionEntryIds(entries: SessionEntry[]): Set<string> {
    const hidden = new Set<string>()
    for (const entry of entries) {
        if (entry.type !== 'custom' || entry.customType !== hiddenProjectionEntryType) {
            continue
        }
        const metadata = hiddenProjectionMetadataFromValue(entry.data)
        if (metadata?.hiddenEntryId) {
            hidden.add(metadata.hiddenEntryId)
        }
    }
    return hidden
}

export function hiddenProjectionTexts(entries: SessionEntry[]): Set<string> {
    const hidden = new Set<string>()
    for (const entry of entries) {
        if (entry.type !== 'custom' || entry.customType !== hiddenProjectionEntryType) {
            continue
        }
        const metadata = hiddenProjectionMetadataFromValue(entry.data)
        if (metadata?.hiddenText) {
            hidden.add(metadata.hiddenText)
        }
    }
    return hidden
}

function messageText(entry: SessionEntry): string | null {
    if (entry.type !== 'message') {
        return null
    }
    const message = entry.message as unknown as Record<string, unknown>
    const content = message.content
    if (typeof content === 'string') {
        return content
    }
    return null
}

export function isHiddenProjectionEntry(
    entry: SessionEntry,
    hiddenIds: Set<string>,
    hiddenTexts = new Set<string>(),
): boolean {
    if (entry.type !== 'message') {
        return false
    }
    const message = entry.message as unknown as Record<string, unknown>
    if (message.role !== 'user') {
        return false
    }
    if (entry.id && hiddenIds.has(entry.id)) {
        return true
    }
    const text = messageText(entry)
    return text !== null && hiddenTexts.has(text)
}

export function visibleProjectionEntries(entries: SessionEntry[]): SessionEntry[] {
    const hiddenIds = hiddenProjectionEntryIds(entries)
    const hiddenTexts = hiddenProjectionTexts(entries)
    return entries.filter((entry) => !isHiddenProjectionEntry(entry, hiddenIds, hiddenTexts))
}

export function appendHiddenProjectionForPromptText(session: AgentSession, text: string): void {
    session.sessionManager.appendCustomEntry(hiddenProjectionEntryType, {
        hiddenText: text,
    })
}

export function appendHiddenProjectionForLatestUserMessage(session: AgentSession): void {
    const branch = session.sessionManager.getBranch()
    for (let index = branch.length - 1; index >= 0; index -= 1) {
        const entry = branch[index]
        if (!entry || entry.type !== 'message') {
            continue
        }
        const message = entry.message as unknown as Record<string, unknown>
        if (message.role !== 'user' || !entry.id) {
            continue
        }
        session.sessionManager.appendCustomEntry(hiddenProjectionEntryType, {
            hiddenEntryId: entry.id,
        })
        return
    }
}
