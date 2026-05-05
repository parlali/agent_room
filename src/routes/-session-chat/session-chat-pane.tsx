import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { MessageSquareIcon } from 'lucide-react'
import { toast } from 'sonner'

import { AttentionBanner, EmptyState } from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import { describeSessionState } from '#/lib/state'
import {
    abortMessageServer,
    getRoomExecutionServer,
    sendMessageServer,
} from '#/routes/-room-runtime-server'
import type { RoomExecutionSnapshot } from '#/server/rooms/execution-types'

import { ChatHeader } from './chat-header'
import { ChatSkeleton } from './chat-skeleton'
import { Composer } from './composer'
import {
    dedupeMessages,
    extractLatestStreamRunId,
    isLastMessageInProgress,
} from './conversation-utils'
import { MessageList } from './message-list'
import { useStreamingRefetch } from './streaming'

export function SessionChatPane({ roomId, sessionKey }: { roomId: string; sessionKey: string }) {
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const [draft, setDraft] = useState('')
    const [streamError, setStreamError] = useState<string | null>(null)
    const queryKey = useMemo(
        () => ['room-execution', roomId, sessionKey] as const,
        [roomId, sessionKey],
    )

    const executionQuery = useQuery<RoomExecutionSnapshot>({
        queryKey,
        queryFn: () => getRoomExecutionServer({ data: { roomId, selectedThreadKey: sessionKey } }),
    })

    const snapshot = executionQuery.data
    const room = snapshot?.room ?? null
    const messages = useMemo(
        () => dedupeMessages(snapshot?.selectedThreadMessages ?? []),
        [snapshot?.selectedThreadMessages],
    )
    const selectedThread = useMemo(
        () => snapshot?.threads.find((thread) => thread.key === sessionKey) ?? null,
        [snapshot?.threads, sessionKey],
    )
    const sessionTone = describeSessionState(selectedThread?.status ?? null)
    const isWorking =
        sessionTone.tone === 'working' || isLastMessageInProgress(snapshot?.selectedThreadMessages)
    const lastAssistantRunId = useMemo(
        () => extractLatestStreamRunId(snapshot?.selectedThreadMessages ?? []),
        [snapshot?.selectedThreadMessages],
    )

    useStreamingRefetch({ roomId, sessionKey, queryClient, queryKey, onError: setStreamError })

    const sendMutation = useMutation({
        mutationFn: (message: string) =>
            sendMessageServer({ data: { roomId, sessionKey, message } }),
        onSuccess: () => {
            setDraft('')
            void queryClient.invalidateQueries({ queryKey })
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : 'Message could not be sent')
        },
    })

    const abortMutation = useMutation({
        mutationFn: () =>
            abortMessageServer({
                data: { roomId, sessionKey, runId: lastAssistantRunId ?? null },
            }),
        onSuccess: (result) => {
            if (result.abortedRunId) {
                toast.success('Stopped this run')
            } else {
                toast.message('No active run to stop')
            }
            void queryClient.invalidateQueries({ queryKey })
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : 'Stop request failed')
        },
    })

    const submitDraft = () => {
        if (sendMutation.isPending) return
        const value = draft.trim()
        if (!value) return
        sendMutation.mutate(value)
    }

    const onSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        submitDraft()
    }

    const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            submitDraft()
        }
    }

    if (executionQuery.isLoading && !snapshot) {
        return <ChatSkeleton />
    }

    if (!room) {
        return (
            <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-10">
                <EmptyState
                    icon={MessageSquareIcon}
                    title="Room not found"
                    description="This room may have been removed. Pick another from the rooms list."
                    action={
                        <Button asChild variant="outline" size="sm">
                            <Link to="/">Back to rooms</Link>
                        </Button>
                    }
                />
            </div>
        )
    }

    return (
        <div className="flex min-h-svh flex-col">
            <ChatHeader
                room={room}
                sessionTitle={selectedThread?.title ?? 'Conversation'}
                sessionLabel={sessionTone.label}
                sessionToneKey={sessionTone.tone}
                provider={
                    selectedThread?.modelProvider ?? snapshot?.roomAgent?.modelPrimary ?? null
                }
                model={selectedThread?.model ?? null}
                compaction={selectedThread?.compaction ?? null}
                onBack={() => {
                    void navigate({ to: '/rooms/$roomId', params: { roomId } })
                }}
            />
            {snapshot?.executionState === 'error' ? (
                <div className="border-b border-border/60 px-4 py-3 sm:px-6">
                    <AttentionBanner
                        tone="danger"
                        title="Runtime is reporting an error"
                        description={
                            snapshot.executionMessage ??
                            'The room runtime is unhealthy. Open status to investigate.'
                        }
                        action={
                            <Button asChild variant="outline" size="sm">
                                <Link to="/rooms/$roomId/status" params={{ roomId }}>
                                    Open status
                                </Link>
                            </Button>
                        }
                    />
                </div>
            ) : null}
            {streamError ? (
                <div className="border-b border-border/60 px-4 py-3 sm:px-6">
                    <AttentionBanner
                        tone="attention"
                        title="Live updates paused"
                        description={streamError}
                        action={
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                    setStreamError(null)
                                    void queryClient.invalidateQueries({ queryKey })
                                }}
                            >
                                Refresh
                            </Button>
                        }
                    />
                </div>
            ) : null}
            <MessageList room={room} messages={messages} isWorking={isWorking} />
            <Composer
                roomDisplayName={room.displayName}
                draft={draft}
                onChangeDraft={setDraft}
                onSubmit={onSubmit}
                onKeyDown={onComposerKeyDown}
                sending={sendMutation.isPending}
                stopping={abortMutation.isPending}
                canStop={isWorking && (snapshot?.capabilities.canAbortGeneration ?? true)}
                onStop={() => abortMutation.mutate()}
            />
        </div>
    )
}
