export function friendlyNotice(value: string | null): string | null {
    const notice = value?.trim()
    if (!notice) {
        return null
    }

    const normalized = notice.toLowerCase()
    if (
        normalized.includes('codex oauth profile is missing') ||
        normalized.includes('codex auth') ||
        normalized.includes('oauth profile')
    ) {
        return 'Model login needed. Connect Codex to start sessions and jobs.'
    }
    if (normalized.includes('provider') && normalized.includes('missing')) {
        return 'Model connection needed. Choose a connected model before this room starts work.'
    }
    if (normalized.includes('active runtime endpoint') || normalized.includes('runtime endpoint')) {
        return 'Room is paused. Resume it before starting or continuing sessions.'
    }
    if (normalized.includes('diagnostic files preserved at')) {
        return notice.replace(
            /Diagnostic files preserved at .+$/i,
            'Diagnostic files were preserved for support review.',
        )
    }
    if (normalized.includes('runtime')) {
        return 'Room is not ready. Check its model connection and settings, then resume the room.'
    }

    return notice.replace(/^Room [0-9a-f-]{36}\s+/i, 'Room ')
}
