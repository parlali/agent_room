import { formatBytes, parseFormattedBytes } from './format'
import type { RoomFileSurface } from './room-file-types'

export interface RoomAttachment {
    id: string
    name: string
    surface: RoomFileSurface
    relativePath: string
    byteLength: number | null
    sizeLabel: string | null
}

export interface ParsedRoomMessageAttachments {
    text: string
    attachments: RoomAttachment[]
}

const attachmentHeaderPattern = /\n{0,2}Attached files:\n/i
const attachmentLinePattern =
    /^-\s+(.+?)\s+\(([^)]*)\)\s+root=(workspace|store)\s+path="([^"]+)"\s*$/i

export function parseRoomMessageAttachments(text: string): ParsedRoomMessageAttachments {
    const match = attachmentHeaderPattern.exec(text)
    if (!match) {
        return {
            text,
            attachments: [],
        }
    }

    const body = text.slice(0, match.index).trimEnd()
    const rawLines = text.slice(match.index + match[0].length).split('\n')
    const attachments: RoomAttachment[] = []
    const rest: string[] = []
    let parsingAttachments = true

    for (const line of rawLines) {
        if (parsingAttachments) {
            const attachment = parseAttachmentLine(line)
            if (attachment) {
                attachments.push(attachment)
                continue
            }
            if (!line.trim()) {
                parsingAttachments = false
                continue
            }
        }
        parsingAttachments = false
        rest.push(line)
    }

    if (attachments.length === 0) {
        return {
            text,
            attachments: [],
        }
    }

    return {
        text: [body, rest.join('\n').trim()].filter(Boolean).join('\n\n'),
        attachments,
    }
}

export function formatMessageWithAttachments(
    message: string,
    attachments: RoomAttachment[],
): string {
    if (attachments.length === 0) {
        return message
    }
    const body = message || 'Please review the attached file(s).'
    const attachmentLines = attachments.map(
        (attachment) =>
            `- ${attachment.name} (${formatBytes(attachment.byteLength)}) root=${attachment.surface} path="${attachment.relativePath}"`,
    )
    return `${body}\n\nAttached files:\n${attachmentLines.join('\n')}`
}

function parseAttachmentLine(line: string): RoomAttachment | null {
    const match = attachmentLinePattern.exec(line.trim())
    if (!match) return null
    const name = match[1]?.trim()
    const sizeLabel = match[2]?.trim() || null
    const surface = match[3]?.toLowerCase()
    const relativePath = match[4]?.trim()
    if (!name || !relativePath || (surface !== 'workspace' && surface !== 'store')) {
        return null
    }

    return {
        id: `${surface}:${relativePath}`,
        name,
        surface,
        relativePath,
        byteLength: parseFormattedBytes(sizeLabel),
        sizeLabel,
    }
}
