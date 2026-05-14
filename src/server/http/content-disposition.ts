function asciiFallbackFilename(name: string): string {
    const fallback = name
        .replace(/[\\/]/g, '_')
        .replace(/["\r\n]/g, '_')
        .replace(/[^\x20-\x7e]/g, '_')
        .trim()
    return fallback || 'download'
}

function encodeRfc5987Value(value: string): string {
    return encodeURIComponent(value).replace(
        /['()*]/g,
        (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    )
}

export function contentDispositionHeader(input: {
    disposition: 'inline' | 'attachment'
    filename: string
}): string {
    const fallback = asciiFallbackFilename(input.filename)
    return `${input.disposition}; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987Value(input.filename)}`
}

export const __testing = {
    asciiFallbackFilename,
    encodeRfc5987Value,
}
