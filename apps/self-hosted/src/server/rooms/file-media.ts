import { extname } from 'node:path'

const officeExtensions = new Set([
    '.doc',
    '.docx',
    '.xls',
    '.xlsx',
    '.ppt',
    '.pptx',
    '.odt',
    '.ods',
    '.odp',
])

export function mediaTypeFor(path: string): string {
    const lower = path.toLowerCase()
    if (lower.endsWith('.png')) return 'image/png'
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
    if (lower.endsWith('.webp')) return 'image/webp'
    if (lower.endsWith('.gif')) return 'image/gif'
    if (lower.endsWith('.svg')) return 'image/svg+xml'
    if (lower.endsWith('.pdf')) return 'application/pdf'
    if (lower.endsWith('.docx')) {
        return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    }
    if (lower.endsWith('.xlsx')) {
        return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }
    if (lower.endsWith('.pptx')) {
        return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    }
    if (lower.endsWith('.json')) return 'application/json'
    if (lower.endsWith('.html')) return 'text/html'
    if (lower.endsWith('.csv')) return 'text/csv'
    if (lower.endsWith('.md')) return 'text/markdown'
    if (lower.endsWith('.txt') || lower.endsWith('.log')) return 'text/plain'
    return 'application/octet-stream'
}

export function isTextMediaType(mediaType: string): boolean {
    return mediaType.startsWith('text/') || mediaType.includes('json') || mediaType.includes('xml')
}

export function isImageMediaType(mediaType: string): boolean {
    return mediaType.startsWith('image/')
}

export function isOfficePath(path: string): boolean {
    return officeExtensions.has(extname(path).toLowerCase())
}
