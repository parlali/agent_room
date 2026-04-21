export function friendlyNotice(value: string | null): string | null {
    const notice = value?.trim()
    if (!notice) {
        return null
    }

    const normalized = notice.toLowerCase()
    if (normalized.includes('active runtime endpoint') || normalized.includes('runtime endpoint')) {
        return 'Room is paused. Resume it before starting or continuing sessions.'
    }
    if (normalized.includes('diagnostic files preserved at')) {
        return notice.replace(
            /Diagnostic files preserved at .+$/i,
            'Diagnostic files were preserved for support review.',
        )
    }
    if (normalized.includes('openclaw') || normalized.includes('runtime')) {
        return 'Room is not ready. Check its model connection and settings, then resume the room.'
    }

    return notice.replace(/^Room [0-9a-f-]{36}\s+/i, 'Room ')
}
