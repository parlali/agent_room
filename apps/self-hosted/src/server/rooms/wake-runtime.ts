import type { PiRuntimeSnapshotPayload } from '../pi-runtime/protocol'

export async function wakeRoomRuntimeWithSnapshot(input: {
    mode: 'now' | 'next-heartbeat'
    text: string
    deferredMessage: string
    readSnapshot: () => Promise<PiRuntimeSnapshotPayload>
    createThread: (firstMessage: string) => Promise<void>
    sendThreadMessage: (sessionKey: string, message: string) => Promise<void>
}): Promise<void> {
    if (input.mode !== 'now') {
        throw new Error(input.deferredMessage)
    }

    const text = input.text.trim()
    if (!text) {
        throw new Error('Wake trigger text cannot be empty')
    }

    const snapshot = await input.readSnapshot()
    const selectedThreadKey = snapshot.selectedThreadKey ?? snapshot.threads[0]?.key ?? null
    if (!selectedThreadKey) {
        await input.createThread(text)
        return
    }

    await input.sendThreadMessage(selectedThreadKey, text)
}
