import type { SessionEntry } from '@mariozechner/pi-coding-agent'
import { extractTextFromRuntimeContent } from '#/lib/runtime-message'
import { isRecord } from './runtime-redaction'

export const proactiveCompactionContextBytes = 256000

function textBytes(text: string): number {
    return Buffer.byteLength(text, 'utf8')
}

function jsonBytes(value: unknown): number {
    try {
        return textBytes(JSON.stringify(value))
    } catch {
        return 0
    }
}

function messageContentBytes(content: unknown): number {
    if (!Array.isArray(content)) {
        return textBytes(extractTextFromRuntimeContent(content))
    }
    let bytes = 0
    for (const block of content) {
        if (!isRecord(block)) {
            continue
        }
        if (block.type === 'toolCall') {
            bytes += textBytes(typeof block.name === 'string' ? block.name : '')
            bytes += jsonBytes(block.arguments)
            continue
        }
        bytes += textBytes(extractTextFromRuntimeContent(block))
    }
    return bytes
}

export function estimateRuntimeMessageContextBytes(messages: readonly unknown[]): number {
    let bytes = 0
    for (const message of messages) {
        if (isRecord(message)) {
            bytes += messageContentBytes(message.content)
        }
    }
    return bytes
}

export function estimateSessionBranchContextBytes(entries: SessionEntry[]): number {
    let bytes = 0
    for (const entry of entries) {
        if (entry.type === 'message') {
            bytes += messageContentBytes((entry.message as { content?: unknown }).content)
        } else if (entry.type === 'custom_message') {
            bytes += messageContentBytes(entry.content)
        } else if (entry.type === 'compaction') {
            bytes += textBytes(entry.summary)
        } else if (entry.type === 'branch_summary') {
            bytes += textBytes(entry.summary)
        }
    }
    return bytes
}
