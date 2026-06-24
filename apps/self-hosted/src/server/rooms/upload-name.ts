import { basename } from 'node:path'

export function sanitizeUploadName(name: string): string {
    const cleaned = basename(name.replace(/\\/g, '/'))
        .split('')
        .filter((char) => {
            const code = char.charCodeAt(0)
            return code >= 32 && code !== 127
        })
        .join('')
        .trim()
    if (!cleaned || cleaned === '.' || cleaned === '..') {
        throw new Error('Uploaded file name is invalid')
    }
    if (cleaned.includes('/') || cleaned.includes('\\')) {
        throw new Error('Uploaded file name is invalid')
    }
    return cleaned
}
