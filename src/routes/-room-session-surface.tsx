import { Link } from '@tanstack/react-router'
import {
    ArrowLeft,
    CheckCircle2,
    FileText,
    Link as LinkIcon,
    MoreHorizontal,
    Send,
    Square,
} from 'lucide-react'
import type { FormEvent } from 'react'
import type {
    RoomExecutionMessage,
    RoomExecutionMessagePart,
    RoomExecutionSnapshot,
    RoomRuntimeOverview,
} from '#/server/rooms/execution-types'
import {
    AgentRoomMark,
    formatDateTime,
    roomInitials,
    roomStateLabel,
    sessionStateLabel,
    statusTone,
} from './-app-layout'
import { friendlyNotice } from './-notice-copy'

function friendlyStepTitle(part: RoomExecutionMessagePart, index: number): string {
    const name = part.toolName?.toLowerCase() ?? ''
    if (name.includes('file') || name.includes('read')) {
        return 'Reading files'
    }
    if (name.includes('write') || name.includes('save')) {
        return 'Saving output'
    }
    if (name.includes('search') || name.includes('web')) {
        return 'Searching'
    }
    if (name.includes('shell') || name.includes('exec') || name.includes('command')) {
        return 'Running task'
    }
    if (name.includes('mcp')) {
        return 'Using connected tool'
    }
    return `Working step ${index + 1}`
}

function stepStatus(part: RoomExecutionMessagePart): 'ready' | 'working' | 'attention' | 'muted' {
    if (part.status) {
        return statusTone(part.status)
    }
    if (part.type === 'tool_result') {
        return 'ready'
    }
    if (part.type === 'tool_call') {
        return 'working'
    }
    return 'muted'
}

function fileChipsForMessage(message: RoomExecutionMessage): string[] {
    const candidates = new Set<string>()
    for (const part of message.parts) {
        const text = `${part.text} ${JSON.stringify(part.result)}`
        for (const match of text.matchAll(
            /[A-Za-z0-9_.-]+\.(?:pdf|csv|md|txt|json|docx|xlsx|pptx)/gi,
        )) {
            candidates.add(match[0])
        }
    }
    return Array.from(candidates).slice(0, 4)
}

export function SessionSurface(props: {
    room: RoomRuntimeOverview
    roomTone: string
    selectedThread: RoomExecutionSnapshot['threads'][number] | null
    messages: RoomExecutionMessage[]
    capabilities: RoomExecutionSnapshot['capabilities'] | undefined
    draftMessage: string
    setDraftMessage: (value: string) => void
    onSendMessage: (event: FormEvent<HTMLFormElement>) => void
    onStop: () => void
    sendPending: boolean
    stopPending: boolean
    notice: string | null
}) {
    const displayNotice = friendlyNotice(props.notice)

    return (
        <section className="session-screen">
            <header className="session-header">
                <Link
                    to="/rooms/$roomId"
                    params={{ roomId: props.room.roomId }}
                    className="button ghost"
                >
                    <ArrowLeft size={18} />
                    View room
                </Link>
                <div>
                    <h1>
                        {props.room.displayName}
                        {props.selectedThread ? ` / ${props.selectedThread.title}` : ''}
                    </h1>
                    <p>
                        <span className={`status-dot ${props.roomTone}`} />
                        {props.selectedThread
                            ? sessionStateLabel(props.selectedThread)
                            : roomStateLabel(props.room)}
                    </p>
                </div>
                <button type="button" className="icon-button" aria-label="More session actions">
                    <MoreHorizontal size={18} />
                </button>
            </header>

            {displayNotice ? (
                <p className="form-alert warning session-notice">{displayNotice}</p>
            ) : null}

            <div className="message-scroll">
                {!props.selectedThread ? (
                    <article className="empty-panel">
                        <AgentRoomMark className="empty-mark" />
                        <h2>Session not found</h2>
                        <p>
                            Choose a session from this room or start a new one from the room home.
                        </p>
                        <Link
                            to="/rooms/$roomId"
                            params={{ roomId: props.room.roomId }}
                            className="button secondary"
                        >
                            Back to room
                        </Link>
                    </article>
                ) : null}
                {props.selectedThread && props.messages.length === 0 ? (
                    <article className="empty-panel">
                        <FileText size={24} />
                        <h2>No messages yet</h2>
                        <p>Send the first message to this room.</p>
                    </article>
                ) : null}
                {props.messages.map((message) => (
                    <MessageBubble key={message.id} room={props.room} message={message} />
                ))}
            </div>

            <form className="session-composer" onSubmit={props.onSendMessage}>
                <button type="button" className="icon-button" disabled aria-label="Attach file">
                    <LinkIcon size={19} />
                </button>
                <textarea
                    value={props.draftMessage}
                    onChange={(event) => props.setDraftMessage(event.target.value)}
                    placeholder={`Message ${props.room.displayName}`}
                />
                {props.capabilities?.canAbortGeneration ? (
                    <button
                        type="button"
                        className="button secondary composer-stop"
                        onClick={props.onStop}
                        disabled={props.stopPending || !props.selectedThread}
                    >
                        <Square size={17} />
                        Stop
                    </button>
                ) : null}
                <button
                    type="submit"
                    className="button primary composer-send"
                    disabled={
                        props.sendPending || !props.draftMessage.trim() || !props.selectedThread
                    }
                >
                    <Send size={17} />
                    Send
                </button>
            </form>
        </section>
    )
}

function MessageBubble(props: { room: RoomRuntimeOverview; message: RoomExecutionMessage }) {
    const isUser = props.message.role === 'user'
    const progressParts = props.message.parts.filter(
        (part) => part.type === 'tool_call' || part.type === 'tool_result',
    )
    const fileChips = fileChipsForMessage(props.message)

    return (
        <article className={isUser ? 'message-bubble user' : 'message-bubble assistant'}>
            {!isUser ? (
                <span className="message-avatar">{roomInitials(props.room.displayName)}</span>
            ) : null}
            <div className="message-body">
                <header>
                    <strong>{isUser ? 'You' : props.room.displayName}</strong>
                    <small>{formatDateTime(props.message.timestamp)}</small>
                </header>
                {props.message.text ? <p>{props.message.text}</p> : null}
                {fileChips.length > 0 ? (
                    <div className="file-chip-row">
                        {fileChips.map((file) => (
                            <span key={file} className="pill muted">
                                <FileText size={14} />
                                {file}
                            </span>
                        ))}
                    </div>
                ) : null}
                {progressParts.length > 0 ? (
                    <div className="progress-card">
                        {progressParts.map((part, index) => {
                            const tone = stepStatus(part)
                            return (
                                <button
                                    type="button"
                                    key={`${props.message.id}:${index}:${part.toolCallId ?? part.type}`}
                                    className="progress-step"
                                >
                                    <span className={`step-state ${tone}`}>
                                        {tone === 'ready' ? <CheckCircle2 size={18} /> : null}
                                    </span>
                                    <span>
                                        <strong>{friendlyStepTitle(part, index)}</strong>
                                        <small>
                                            {tone === 'ready'
                                                ? 'Completed'
                                                : tone === 'attention'
                                                  ? 'Needs attention'
                                                  : tone === 'working'
                                                    ? 'In progress'
                                                    : 'Pending'}
                                        </small>
                                    </span>
                                </button>
                            )
                        })}
                    </div>
                ) : null}
            </div>
        </article>
    )
}
