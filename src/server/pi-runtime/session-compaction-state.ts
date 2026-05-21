import type { SessionEntry } from '@mariozechner/pi-coding-agent'

interface SessionLeafReader {
    getLeafEntry: () => SessionEntry | undefined
}

export function isSessionCompactionLeaf(sessionManager: SessionLeafReader): boolean {
    return sessionManager.getLeafEntry()?.type === 'compaction'
}
