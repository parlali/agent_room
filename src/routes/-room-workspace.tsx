import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import {
    Activity,
    AlertTriangle,
    CheckCircle2,
    Clock3,
    Copy,
    Download,
    ExternalLink,
    Eye,
    FileText,
    Folder,
    Home,
    KeyRound,
    Link as LinkIcon,
    ListTodo,
    MoreHorizontal,
    PauseCircle,
    Play,
    Plus,
    RefreshCw,
    Search,
    Send,
    Settings,
    Sparkles,
    Upload,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
    extractOpenClawMessageParts,
    extractOpenClawMessageText,
    toOpenClawMessagePayload,
} from '#/lib/openclaw-message'
import type { CodexOAuthSessionSnapshot } from '#/server/configuration/codex-oauth-flow'
import type { RoomConfigSnapshot } from '#/server/configuration/operator-configuration'
import type { RoomFileEntry } from '#/server/rooms/file-store'
import type {
    RoomCronJob,
    RoomExecutionMessage,
    RoomExecutionSnapshot,
    RoomRunHistorySnapshot,
    RoomRuntimeOverview,
} from '#/server/rooms/execution-types'
import {
    AgentRoomMark,
    AuthenticatedAppShell,
    formatBytes,
    formatDateTime,
    formatRelativeTime,
    jobScheduleLabel,
    jobSchedulePresets,
    roomIconFor,
    roomStateLabel,
    roomStateTone,
    sessionStateLabel,
    statusTone,
    useRoomsList,
} from './-app-layout'
import {
    cancelCodexOAuthSessionServer,
    getCodexOAuthSessionServer,
    getRoomConfigServer,
    saveRoomConfigServer,
    saveRoomSecretServer,
    startCodexOAuthSessionServer,
    submitCodexOAuthRedirectServer,
} from './-operator-config-server'
import {
    abortMessageServer,
    createCronJobServer,
    createThreadServer,
    getRoomExecutionServer,
    listCronJobsServer,
    listRoomFilesServer,
    listRoomRunHistoryServer,
    removeCronJobServer,
    runCronJobServer,
    sendMessageServer,
    setCronEnabledServer,
    setRoomDesiredStateServer,
    updateRoomIdentityServer,
} from './-room-runtime-server'
import { friendlyNotice } from './-notice-copy'
import type { ProviderApi, ProviderMode } from './-room-create-form'
import { SettingsSurface } from './-room-settings-surface'
import { SessionSurface } from './-room-session-surface'

export type RoomSurface = 'home' | 'files' | 'jobs' | 'status' | 'settings' | 'session'

interface RoomWorkspaceProps {
    roomId: string
    surface: RoomSurface
    sessionKey?: string | null
}

interface RoomTab {
    key: Exclude<RoomSurface, 'session'>
    label: string
    icon: typeof Home
    to: string
}

const roomTabs: RoomTab[] = [
    {
        key: 'home',
        label: 'Home',
        icon: Home,
        to: '/rooms/$roomId',
    },
    {
        key: 'files',
        label: 'Files',
        icon: Folder,
        to: '/rooms/$roomId/files',
    },
    {
        key: 'jobs',
        label: 'Jobs',
        icon: ListTodo,
        to: '/rooms/$roomId/jobs',
    },
    {
        key: 'status',
        label: 'Status',
        icon: Clock3,
        to: '/rooms/$roomId/status',
    },
    {
        key: 'settings',
        label: 'Settings',
        icon: Settings,
        to: '/rooms/$roomId/settings',
    },
]

function buildSessionEventPath(roomId: string, sessionKey: string): string {
    return `/api/rooms/${encodeURIComponent(roomId)}/sessions/${encodeURIComponent(sessionKey)}/events`
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

function readString(record: Record<string, unknown>, key: string): string | null {
    const value = record[key]
    return typeof value === 'string' && value.trim() ? value : null
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
    const value = record[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function mergeChatStreamEvent(
    snapshot: RoomExecutionSnapshot | undefined,
    event: Record<string, unknown>,
): RoomExecutionSnapshot | undefined {
    if (!snapshot || event.event !== 'chat' || !isRecord(event.payload)) {
        return snapshot
    }

    const payload = event.payload
    const sessionKey = readString(payload, 'sessionKey')
    if (!sessionKey || sessionKey !== snapshot.selectedThreadKey) {
        return snapshot
    }

    const runId =
        readString(payload, 'runId') ?? `run-${readNumber(event, 'receivedAt') ?? Date.now()}`
    const state = readString(payload, 'state') ?? 'delta'
    const messagePayload = payload.message
    const message = toOpenClawMessagePayload(messagePayload)
    const text =
        extractOpenClawMessageText(messagePayload) ||
        (state === 'error'
            ? (readString(payload, 'errorMessage') ?? 'Generation failed')
            : state === 'aborted'
              ? 'Generation stopped'
              : '')
    if (!text && state !== 'final') {
        return snapshot
    }

    const existingMessages = snapshot.selectedThreadMessages
    const existingIndex = existingMessages.findIndex((entry) => entry.id === `stream-${runId}`)
    const existing = existingIndex >= 0 ? existingMessages[existingIndex] : null
    const nextMessage = {
        id: `stream-${runId}`,
        role: 'assistant' as const,
        text: text || existing?.text || '',
        parts: extractOpenClawMessageParts(messagePayload),
        timestamp:
            readNumber(message, 'timestamp') ??
            readNumber(event, 'receivedAt') ??
            existing?.timestamp ??
            Date.now(),
    }

    const nextMessages =
        existingIndex >= 0
            ? existingMessages.map((entry, index) =>
                  index === existingIndex ? nextMessage : entry,
              )
            : [...existingMessages, nextMessage]

    return {
        ...snapshot,
        selectedThreadMessages: nextMessages,
        threads: snapshot.threads.map((thread) =>
            thread.key === sessionKey
                ? {
                      ...thread,
                      status:
                          state === 'final' || state === 'aborted' || state === 'error'
                              ? thread.status
                              : 'working',
                      updatedAt: Date.now(),
                  }
                : thread,
        ),
    }
}

async function copyTextToClipboard(value: string) {
    try {
        await navigator.clipboard.writeText(value)
        return
    } catch {}

    const textArea = document.createElement('textarea')
    const activeElement =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
    textArea.value = value
    textArea.setAttribute('readonly', 'true')
    textArea.style.position = 'fixed'
    textArea.style.left = '-9999px'
    textArea.style.top = '0'
    document.body.appendChild(textArea)
    textArea.focus()
    textArea.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(textArea)
    activeElement?.focus()
    if (!copied) {
        throw new Error('Clipboard copy failed')
    }
}

function roomSummary(
    config: RoomConfigSnapshot | undefined,
    room: RoomRuntimeOverview | null,
    roomReady: boolean,
) {
    if (!roomReady) {
        return (
            friendlyNotice(config?.effective.blockedReasons[0] ?? null) ??
            config?.effective.codexAuth?.message ??
            'Finish room setup before starting sessions or jobs.'
        )
    }

    const instructions = config?.config.instructions.trim()
    if (instructions) {
        return instructions.split('\n')[0] ?? instructions
    }
    if (room) {
        return `${room.displayName} is ready for sessions, files, and jobs.`
    }
    return 'Room details are loading.'
}

function visibleMessages(messages: RoomExecutionMessage[]) {
    return messages.filter((message) => message.role === 'user' || message.role === 'assistant')
}

export function RoomWorkspacePage(props: RoomWorkspaceProps) {
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const [notice, setNotice] = useState<string | null>(null)
    const [draftMessage, setDraftMessage] = useState('')
    const [jobName, setJobName] = useState('')
    const [jobMessage, setJobMessage] = useState('')
    const [jobEveryMinutes, setJobEveryMinutes] = useState('1440')
    const [wakeText, setWakeText] = useState('')
    const [codexRedirectUrl, setCodexRedirectUrl] = useState('')
    const [settingsLoadedFor, setSettingsLoadedFor] = useState<string | null>(null)
    const [displayName, setDisplayName] = useState('')
    const [slug, setSlug] = useState('')
    const [instructions, setInstructions] = useState('')
    const [providerMode, setProviderMode] = useState<ProviderMode>('app_default')
    const [providerConnectionId, setProviderConnectionId] = useState('')
    const [provider, setProvider] = useState('openrouter')
    const [providerApi, setProviderApi] = useState<ProviderApi>('openai-completions')
    const [providerBaseUrl, setProviderBaseUrl] = useState('')
    const [providerModel, setProviderModel] = useState('openrouter/auto')
    const [providerApiKey, setProviderApiKey] = useState('')
    const [toolsProfile, setToolsProfile] = useState('coding')
    const [cronTimezone, setCronTimezone] = useState('UTC')
    const [selectedMcpIds, setSelectedMcpIds] = useState<string[]>([])
    const [secretLabel, setSecretLabel] = useState('')
    const [secretEnvKey, setSecretEnvKey] = useState('')
    const [secretValue, setSecretValue] = useState('')
    const [secretPurpose, setSecretPurpose] = useState<'provider_api_key' | 'generic' | 'webhook'>(
        'generic',
    )

    const roomsQuery = useRoomsList()
    const rooms = roomsQuery.data ?? []
    const activeRoom = rooms.find((room) => room.roomId === props.roomId) ?? null
    const executionQuery = useQuery<RoomExecutionSnapshot>({
        queryKey: ['room-runtime-snapshot', props.roomId, props.sessionKey ?? null],
        queryFn: async () =>
            getRoomExecutionServer({
                data: {
                    roomId: props.roomId,
                    selectedThreadKey: props.sessionKey ?? null,
                },
            }),
        enabled: activeRoom !== null,
    })
    const roomConfigQuery = useQuery<RoomConfigSnapshot>({
        queryKey: ['room-config', props.roomId],
        queryFn: async () =>
            getRoomConfigServer({
                data: {
                    roomId: props.roomId,
                },
            }),
        enabled: activeRoom !== null,
    })
    const jobsQuery = useQuery<RoomCronJob[]>({
        queryKey: ['room-runtime-cron-jobs', props.roomId],
        queryFn: async () =>
            listCronJobsServer({
                data: {
                    roomId: props.roomId,
                },
            }),
        enabled: activeRoom !== null,
    })
    const filesQuery = useQuery<RoomFileEntry[]>({
        queryKey: ['room-files', props.roomId],
        queryFn: async () =>
            listRoomFilesServer({
                data: {
                    roomId: props.roomId,
                },
            }),
        enabled: activeRoom !== null,
    })
    const runHistoryQuery = useQuery<RoomRunHistorySnapshot>({
        queryKey: ['room-runtime-run-history', props.roomId],
        queryFn: async () =>
            listRoomRunHistoryServer({
                data: {
                    roomId: props.roomId,
                    limit: 100,
                },
            }),
        enabled: activeRoom !== null,
    })

    const roomConfig = roomConfigQuery.data
    const codexAuthRequiredForQuery = roomConfig?.effective.codexAuth?.required ?? false
    const codexOAuthQuery = useQuery<CodexOAuthSessionSnapshot>({
        queryKey: ['codex-oauth-session', props.roomId],
        queryFn: async () =>
            getCodexOAuthSessionServer({
                data: {
                    roomId: props.roomId,
                },
            }),
        enabled: activeRoom !== null && codexAuthRequiredForQuery,
        refetchInterval: codexAuthRequiredForQuery ? 2_000 : false,
    })

    const snapshot = executionQuery.data
    const room = snapshot?.room ?? activeRoom
    const threads = snapshot?.threads ?? []
    const selectedThread = props.sessionKey
        ? (threads.find((thread) => thread.key === props.sessionKey) ?? null)
        : null
    const jobs = jobsQuery.data ?? []
    const files = filesQuery.data ?? []
    const runHistory = runHistoryQuery.data
    const effectiveConfig = roomConfig?.effective
    const roomReady = effectiveConfig?.ready ?? false
    const codexOAuthSession = codexOAuthQuery.data
    const codexAuthReady =
        (effectiveConfig?.codexAuth?.ready ?? false) || codexOAuthSession?.status === 'complete'
    const codexOAuthActive =
        codexOAuthSession?.status === 'starting' ||
        codexOAuthSession?.status === 'awaiting_redirect' ||
        codexOAuthSession?.status === 'submitting'
    const roomTone = roomStateTone(room)
    const invalidateRoom = async () => {
        await queryClient.invalidateQueries({
            queryKey: ['room-runtime-list'],
            exact: false,
        })
        await queryClient.invalidateQueries({
            queryKey: ['room-runtime-snapshot', props.roomId],
            exact: false,
        })
        await queryClient.invalidateQueries({
            queryKey: ['room-runtime-snapshot-sidebar', props.roomId],
            exact: false,
        })
        await queryClient.invalidateQueries({
            queryKey: ['room-runtime-cron-jobs', props.roomId],
            exact: false,
        })
        await queryClient.invalidateQueries({
            queryKey: ['room-runtime-run-history', props.roomId],
            exact: false,
        })
        await queryClient.invalidateQueries({
            queryKey: ['room-files', props.roomId],
            exact: false,
        })
        await queryClient.invalidateQueries({
            queryKey: ['room-config', props.roomId],
            exact: false,
        })
        await queryClient.invalidateQueries({
            queryKey: ['codex-oauth-session', props.roomId],
            exact: false,
        })
    }

    useEffect(() => {
        if (!roomConfig || !room || settingsLoadedFor === roomConfig.roomId) {
            return
        }
        setDisplayName(room.displayName)
        setSlug(room.slug)
        setInstructions(roomConfig.config.instructions)
        setProviderMode(roomConfig.config.providerMode)
        setProviderConnectionId(roomConfig.config.providerConnectionId ?? '')
        setProvider(roomConfig.config.provider ?? 'openrouter')
        setProviderApi(roomConfig.config.providerApi ?? 'openai-completions')
        setProviderBaseUrl(roomConfig.config.providerBaseUrl ?? '')
        setProviderModel(roomConfig.config.providerModel ?? 'openrouter/auto')
        setProviderApiKey('')
        setToolsProfile(roomConfig.config.toolsProfile)
        setCronTimezone(roomConfig.config.cronTimezone)
        setSelectedMcpIds(roomConfig.config.mcpConnectionIds)
        setSettingsLoadedFor(roomConfig.roomId)
    }, [room, roomConfig, settingsLoadedFor])

    useEffect(() => {
        if (codexOAuthQuery.data?.status === 'complete') {
            void invalidateRoom()
        }
    }, [codexOAuthQuery.data?.status])

    useEffect(() => {
        if (!props.sessionKey || activeRoom === null || typeof EventSource === 'undefined') {
            return
        }

        const source = new EventSource(buildSessionEventPath(props.roomId, props.sessionKey))
        const snapshotQueryKey = ['room-runtime-snapshot', props.roomId, props.sessionKey] as const

        const onRoomEvent = (message: MessageEvent<string>) => {
            try {
                const event = JSON.parse(message.data) as Record<string, unknown>
                queryClient.setQueryData<RoomExecutionSnapshot | undefined>(
                    snapshotQueryKey,
                    (current) => mergeChatStreamEvent(current, event),
                )
                if (
                    event.event === 'session.message' ||
                    event.event === 'sessions.changed' ||
                    event.event === 'session.tool'
                ) {
                    void invalidateRoom()
                }
            } catch (error) {
                setNotice(error instanceof Error ? error.message : 'Room stream event failed')
            }
        }

        const onStreamError = (message: MessageEvent<string>) => {
            try {
                const event = JSON.parse(message.data) as { message?: string }
                setNotice(event.message ?? 'Room stream disconnected')
            } catch {
                setNotice('Room stream disconnected')
            }
        }

        source.addEventListener('room-event', onRoomEvent)
        source.addEventListener('stream-error', onStreamError)

        return () => {
            source.removeEventListener('room-event', onRoomEvent)
            source.removeEventListener('stream-error', onStreamError)
            source.close()
        }
    }, [activeRoom?.roomId, props.roomId, props.sessionKey, queryClient])

    const createSessionMutation = useMutation({
        mutationFn: async (firstMessage?: string) =>
            createThreadServer({
                data: {
                    roomId: props.roomId,
                    firstMessage: firstMessage ?? null,
                },
            }),
        onSuccess: async (result) => {
            await invalidateRoom()
            await navigate({
                to: '/rooms/$roomId/sessions/$sessionKey',
                params: {
                    roomId: props.roomId,
                    sessionKey: result.key,
                },
            })
        },
        onError: (error) => {
            setNotice(error instanceof Error ? error.message : 'Session creation failed')
        },
    })

    const sendMessageMutation = useMutation({
        mutationFn: async (payload: { sessionKey: string; message: string }) =>
            sendMessageServer({
                data: {
                    roomId: props.roomId,
                    sessionKey: payload.sessionKey,
                    message: payload.message,
                },
            }),
        onSuccess: async () => {
            setDraftMessage('')
            await invalidateRoom()
        },
        onError: (error) => {
            setNotice(error instanceof Error ? error.message : 'Message send failed')
        },
    })

    const abortMessageMutation = useMutation({
        mutationFn: async () => {
            if (!props.sessionKey) {
                throw new Error('No session selected')
            }
            return abortMessageServer({
                data: {
                    roomId: props.roomId,
                    sessionKey: props.sessionKey,
                    runId: null,
                },
            })
        },
        onSuccess: async (result) => {
            setNotice(result.abortedRunId ? 'Generation stopped' : 'No active generation to stop')
            await invalidateRoom()
        },
        onError: (error) => {
            setNotice(error instanceof Error ? error.message : 'Stop request failed')
        },
    })

    const createJobMutation = useMutation({
        mutationFn: async () =>
            createCronJobServer({
                data: {
                    roomId: props.roomId,
                    name: jobName,
                    message: jobMessage,
                    everyMinutes: Number(jobEveryMinutes),
                },
            }),
        onSuccess: async () => {
            setJobName('')
            setJobMessage('')
            setNotice('Job created')
            await invalidateRoom()
        },
        onError: (error) => {
            setNotice(error instanceof Error ? error.message : 'Job creation failed')
        },
    })

    const setJobEnabledMutation = useMutation({
        mutationFn: async (payload: { jobId: string; enabled: boolean }) =>
            setCronEnabledServer({
                data: {
                    roomId: props.roomId,
                    jobId: payload.jobId,
                    enabled: payload.enabled,
                },
            }),
        onSuccess: async (job) => {
            setNotice(job.enabled ? 'Job enabled' : 'Job paused')
            await invalidateRoom()
        },
    })

    const runJobMutation = useMutation({
        mutationFn: async (jobId: string) =>
            runCronJobServer({
                data: {
                    roomId: props.roomId,
                    jobId,
                },
            }),
        onSuccess: async (result) => {
            setNotice(result.ran ? 'Job started' : (result.reason ?? 'Job could not start'))
            await invalidateRoom()
        },
    })

    const removeJobMutation = useMutation({
        mutationFn: async (jobId: string) =>
            removeCronJobServer({
                data: {
                    roomId: props.roomId,
                    jobId,
                },
            }),
        onSuccess: async () => {
            setNotice('Job removed')
            await invalidateRoom()
        },
    })

    const setDesiredStateMutation = useMutation({
        mutationFn: async (desiredState: 'running' | 'stopped') =>
            setRoomDesiredStateServer({
                data: {
                    roomId: props.roomId,
                    desiredState,
                },
            }),
        onSuccess: async (_, desiredState) => {
            setNotice(desiredState === 'running' ? 'Room resumed' : 'Room paused')
            await invalidateRoom()
        },
        onError: (error) => {
            setNotice(error instanceof Error ? error.message : 'Room state change failed')
        },
    })

    const wakeRoomMutation = useMutation({
        mutationFn: async () => createSessionMutation.mutateAsync(wakeText),
        onSuccess: async () => {
            setWakeText('')
        },
    })

    const updateIdentityMutation = useMutation({
        mutationFn: async () =>
            updateRoomIdentityServer({
                data: {
                    roomId: props.roomId,
                    displayName,
                    slug: slug || null,
                },
            }),
        onSuccess: async () => {
            setNotice('Room identity saved')
            await invalidateRoom()
        },
        onError: (error) => {
            setNotice(error instanceof Error ? error.message : 'Room identity save failed')
        },
    })

    const saveRoomConfigMutation = useMutation({
        mutationFn: async () =>
            saveRoomConfigServer({
                data: {
                    roomId: props.roomId,
                    instructions,
                    providerMode,
                    providerConnectionId:
                        providerMode === 'app_connection' ? providerConnectionId : null,
                    provider: providerMode === 'room_secret' ? provider : null,
                    providerApi: providerMode === 'room_secret' ? providerApi : null,
                    providerBaseUrl:
                        providerMode === 'room_secret' ? providerBaseUrl || null : null,
                    providerModel: providerMode === 'room_secret' ? providerModel : null,
                    providerApiKey: providerMode === 'room_secret' ? providerApiKey : undefined,
                    toolsProfile,
                    cronTimezone,
                    mcpConnectionIds: selectedMcpIds,
                },
            }),
        onSuccess: async () => {
            setProviderApiKey('')
            setSettingsLoadedFor(null)
            setNotice('Room settings saved')
            await invalidateRoom()
        },
        onError: (error) => {
            setNotice(error instanceof Error ? error.message : 'Room settings save failed')
        },
    })

    const saveSecretMutation = useMutation({
        mutationFn: async () =>
            saveRoomSecretServer({
                data: {
                    roomId: props.roomId,
                    label: secretLabel,
                    envKey: secretEnvKey,
                    purpose: secretPurpose,
                    provider: provider || null,
                    value: secretValue,
                },
            }),
        onSuccess: async () => {
            setSecretLabel('')
            setSecretEnvKey('')
            setSecretValue('')
            setNotice('Secret saved')
            await invalidateRoom()
        },
        onError: (error) => {
            setNotice(error instanceof Error ? error.message : 'Secret save failed')
        },
    })

    const startCodexOAuthMutation = useMutation({
        mutationFn: async () =>
            startCodexOAuthSessionServer({
                data: {
                    roomId: props.roomId,
                },
            }),
        onSuccess: async () => {
            setNotice('OpenAI Codex login link generated')
            await queryClient.invalidateQueries({
                queryKey: ['codex-oauth-session', props.roomId],
                exact: false,
            })
        },
        onError: (error) => {
            setNotice(error instanceof Error ? error.message : 'Codex login failed')
        },
    })

    const submitCodexOAuthMutation = useMutation({
        mutationFn: async () =>
            submitCodexOAuthRedirectServer({
                data: {
                    roomId: props.roomId,
                    redirectUrl: codexRedirectUrl,
                },
            }),
        onSuccess: async () => {
            setCodexRedirectUrl('')
            setNotice('OpenAI Codex login completed')
            await invalidateRoom()
        },
        onError: (error) => {
            setNotice(error instanceof Error ? error.message : 'Redirect submit failed')
        },
    })

    const cancelCodexOAuthMutation = useMutation({
        mutationFn: async () =>
            cancelCodexOAuthSessionServer({
                data: {
                    roomId: props.roomId,
                },
            }),
        onSuccess: async () => {
            setNotice('OpenAI Codex login cancelled')
            await queryClient.invalidateQueries({
                queryKey: ['codex-oauth-session', props.roomId],
                exact: false,
            })
        },
    })

    const onCreateJob = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const everyMinutes = Number(jobEveryMinutes)
        if (!Number.isInteger(everyMinutes) || everyMinutes <= 0) {
            setNotice('Job interval must be a positive whole number')
            return
        }
        if (!jobName.trim() || !jobMessage.trim()) {
            setNotice('Add a job name and task')
            return
        }
        createJobMutation.mutate()
    }

    const onSendMessage = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (!props.sessionKey || !draftMessage.trim()) {
            return
        }
        sendMessageMutation.mutate({
            sessionKey: props.sessionKey,
            message: draftMessage.trim(),
        })
    }

    const onWakeRoom = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (!wakeText.trim()) {
            setNotice('Add a task')
            return
        }
        wakeRoomMutation.mutate()
    }

    const onSaveSettings = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        updateIdentityMutation.mutate()
        saveRoomConfigMutation.mutate()
    }

    const onSaveSecret = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        saveSecretMutation.mutate()
    }

    const onSubmitCodexRedirect = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (!codexRedirectUrl.trim()) {
            setNotice('Paste the redirect URL')
            return
        }
        submitCodexOAuthMutation.mutate()
    }

    const onCopyCodexAuthUrl = async () => {
        const authUrl = codexOAuthSession?.authUrl
        if (!authUrl) {
            return
        }
        try {
            await copyTextToClipboard(authUrl)
            setNotice('Copied OpenAI Codex login URL')
        } catch {
            setNotice('Copy failed')
        }
    }

    const toggleMcp = (id: string) => {
        setSelectedMcpIds((current) =>
            current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
        )
    }

    if (roomsQuery.isLoading) {
        return (
            <AuthenticatedAppShell activeRoomId={props.roomId}>
                <section className="page-stack">
                    <div className="surface loading-panel">Loading room</div>
                </section>
            </AuthenticatedAppShell>
        )
    }

    if (!activeRoom || !room) {
        return (
            <AuthenticatedAppShell activeRoomId={props.roomId}>
                <section className="page-stack">
                    <article className="empty-panel">
                        <AgentRoomMark className="empty-mark" />
                        <h1>Room not found</h1>
                        <p>Create a room from the room list.</p>
                        <Link to="/" className="button primary">
                            Back to rooms
                        </Link>
                    </article>
                </section>
            </AuthenticatedAppShell>
        )
    }

    return (
        <AuthenticatedAppShell
            activeRoomId={props.roomId}
            activeSessionKey={props.sessionKey ?? null}
            activeSection="rooms"
        >
            {props.surface === 'session' ? (
                <SessionSurface
                    room={room}
                    roomTone={roomTone}
                    selectedThread={selectedThread}
                    messages={visibleMessages(snapshot?.selectedThreadMessages ?? [])}
                    capabilities={snapshot?.capabilities}
                    draftMessage={draftMessage}
                    setDraftMessage={setDraftMessage}
                    onSendMessage={onSendMessage}
                    onStop={() => abortMessageMutation.mutate()}
                    sendPending={sendMessageMutation.isPending}
                    stopPending={abortMessageMutation.isPending}
                    notice={notice}
                />
            ) : (
                <section className="page-stack">
                    <RoomHeader
                        room={room}
                        roomConfig={roomConfig}
                        roomReady={roomReady}
                        roomTone={roomTone}
                        activeSurface={props.surface}
                        notice={notice}
                        onRefresh={() => {
                            void invalidateRoom()
                        }}
                    />
                    {effectiveConfig && !effectiveConfig.ready ? (
                        <AttentionBanner
                            title={`${room.displayName} needs attention`}
                            text={
                                friendlyNotice(effectiveConfig.blockedReasons[0] ?? null) ??
                                'Room setup is incomplete.'
                            }
                            action={
                                <Link
                                    to="/rooms/$roomId/settings"
                                    params={{ roomId: props.roomId }}
                                    className="button secondary"
                                >
                                    Open settings
                                </Link>
                            }
                        />
                    ) : null}
                    {props.surface === 'home' ? (
                        <HomeSurface
                            room={room}
                            roomConfig={roomConfig}
                            threads={threads}
                            jobs={jobs}
                            files={files}
                            runHistory={runHistory}
                            roomReady={roomReady}
                            createSessionPending={createSessionMutation.isPending}
                            onCreateSession={() => createSessionMutation.mutate(undefined)}
                            wakeText={wakeText}
                            setWakeText={setWakeText}
                            onWakeRoom={onWakeRoom}
                            wakePending={wakeRoomMutation.isPending}
                        />
                    ) : null}
                    {props.surface === 'files' ? <FilesSurface files={files} /> : null}
                    {props.surface === 'jobs' ? (
                        <JobsSurface
                            jobs={jobs}
                            jobName={jobName}
                            setJobName={setJobName}
                            jobMessage={jobMessage}
                            setJobMessage={setJobMessage}
                            jobEveryMinutes={jobEveryMinutes}
                            setJobEveryMinutes={setJobEveryMinutes}
                            onCreateJob={onCreateJob}
                            createPending={createJobMutation.isPending}
                            onRunJob={(jobId) => runJobMutation.mutate(jobId)}
                            onToggleJob={(jobId, enabled) =>
                                setJobEnabledMutation.mutate({
                                    jobId,
                                    enabled,
                                })
                            }
                            onRemoveJob={(jobId) => removeJobMutation.mutate(jobId)}
                        />
                    ) : null}
                    {props.surface === 'status' ? (
                        <StatusSurface
                            room={room}
                            roomConfig={roomConfig}
                            jobs={jobs}
                            files={files}
                            runHistory={runHistory}
                            codexOAuthSession={codexOAuthSession ?? null}
                            codexAuthReady={codexAuthReady}
                            codexOAuthActive={codexOAuthActive}
                            codexRedirectUrl={codexRedirectUrl}
                            setCodexRedirectUrl={setCodexRedirectUrl}
                            onStartCodexOAuth={() => startCodexOAuthMutation.mutate()}
                            onCopyCodexAuthUrl={() => {
                                void onCopyCodexAuthUrl()
                            }}
                            onSubmitCodexRedirect={onSubmitCodexRedirect}
                            onCancelCodexOAuth={() => cancelCodexOAuthMutation.mutate()}
                            codexStartPending={startCodexOAuthMutation.isPending}
                            codexSubmitPending={submitCodexOAuthMutation.isPending}
                            codexCancelPending={cancelCodexOAuthMutation.isPending}
                            onPause={() => setDesiredStateMutation.mutate('stopped')}
                            onResume={() => setDesiredStateMutation.mutate('running')}
                            desiredStatePending={setDesiredStateMutation.isPending}
                        />
                    ) : null}
                    {props.surface === 'settings' ? (
                        <SettingsSurface
                            room={room}
                            roomConfig={roomConfig}
                            displayName={displayName}
                            setDisplayName={setDisplayName}
                            slug={slug}
                            setSlug={setSlug}
                            instructions={instructions}
                            setInstructions={setInstructions}
                            providerMode={providerMode}
                            setProviderMode={setProviderMode}
                            providerConnectionId={providerConnectionId}
                            setProviderConnectionId={setProviderConnectionId}
                            provider={provider}
                            setProvider={setProvider}
                            providerApi={providerApi}
                            setProviderApi={setProviderApi}
                            providerBaseUrl={providerBaseUrl}
                            setProviderBaseUrl={setProviderBaseUrl}
                            providerModel={providerModel}
                            setProviderModel={setProviderModel}
                            providerApiKey={providerApiKey}
                            setProviderApiKey={setProviderApiKey}
                            toolsProfile={toolsProfile}
                            setToolsProfile={setToolsProfile}
                            cronTimezone={cronTimezone}
                            setCronTimezone={setCronTimezone}
                            selectedMcpIds={selectedMcpIds}
                            toggleMcp={toggleMcp}
                            secretLabel={secretLabel}
                            setSecretLabel={setSecretLabel}
                            secretEnvKey={secretEnvKey}
                            setSecretEnvKey={setSecretEnvKey}
                            secretValue={secretValue}
                            setSecretValue={setSecretValue}
                            secretPurpose={secretPurpose}
                            setSecretPurpose={setSecretPurpose}
                            onSaveSettings={onSaveSettings}
                            onSaveSecret={onSaveSecret}
                            savePending={
                                updateIdentityMutation.isPending || saveRoomConfigMutation.isPending
                            }
                            secretPending={saveSecretMutation.isPending}
                        />
                    ) : null}
                </section>
            )}
        </AuthenticatedAppShell>
    )
}

function RoomHeader(props: {
    room: RoomRuntimeOverview
    roomConfig: RoomConfigSnapshot | undefined
    roomReady: boolean
    roomTone: string
    activeSurface: RoomSurface
    notice: string | null
    onRefresh: () => void
}) {
    const Icon = roomIconFor(props.room)
    const displayNotice = friendlyNotice(props.notice)
    return (
        <header className="room-page-header">
            <div className="room-title-line">
                <span className={`room-avatar ${props.roomTone}`}>
                    <Icon size={23} />
                </span>
                <div>
                    <div className="title-with-pill">
                        <h1>{props.room.displayName}</h1>
                        <span className={`pill ${props.roomTone}`}>
                            <span className={`status-dot ${props.roomTone}`} />
                            {roomStateLabel(props.room)}
                        </span>
                    </div>
                    <p>{roomSummary(props.roomConfig, props.room, props.roomReady)}</p>
                </div>
                <button
                    type="button"
                    className="icon-button header-refresh"
                    onClick={props.onRefresh}
                >
                    <RefreshCw size={17} />
                </button>
            </div>
            {displayNotice ? <p className="form-alert warning">{displayNotice}</p> : null}
            <nav className="room-tabs" aria-label="Room sections">
                {roomTabs.map((tab) => {
                    const IconComponent = tab.icon
                    return (
                        <Link
                            key={tab.key}
                            to={tab.to}
                            params={{ roomId: props.room.roomId }}
                            className={
                                props.activeSurface === tab.key ? 'room-tab active' : 'room-tab'
                            }
                        >
                            <IconComponent size={17} />
                            {tab.label}
                        </Link>
                    )
                })}
            </nav>
        </header>
    )
}

function AttentionBanner(props: { title: string; text: string; action: ReactNode }) {
    return (
        <section className="attention-banner">
            <AlertTriangle size={20} />
            <span>
                <strong>{props.title}</strong>
                <small>{props.text}</small>
            </span>
            {props.action}
        </section>
    )
}

function HomeSurface(props: {
    room: RoomRuntimeOverview
    roomConfig: RoomConfigSnapshot | undefined
    threads: RoomExecutionSnapshot['threads']
    jobs: RoomCronJob[]
    files: RoomFileEntry[]
    runHistory: RoomRunHistorySnapshot | undefined
    roomReady: boolean
    createSessionPending: boolean
    onCreateSession: () => void
    wakeText: string
    setWakeText: (value: string) => void
    onWakeRoom: (event: FormEvent<HTMLFormElement>) => void
    wakePending: boolean
}) {
    const activeThreads = props.threads.slice(0, 4)
    const recentFiles = props.files.filter((file) => file.kind === 'file').slice(0, 4)
    const upcomingJob = props.jobs.find((job) => job.enabled) ?? null
    const latestRun = props.runHistory?.entries[0] ?? null
    const attentionText =
        friendlyNotice(props.roomConfig?.effective.blockedReasons[0] ?? null) ??
        friendlyNotice(latestRun?.error ?? null)
    const HeroIcon = props.roomReady ? CheckCircle2 : AlertTriangle

    return (
        <section className="room-home-grid">
            <section className={`room-hero surface ${props.roomReady ? 'ready' : 'attention'}`}>
                <HeroIcon size={28} />
                <span>
                    <h2>
                        {props.room.displayName}{' '}
                        {props.roomReady
                            ? `is working on ${activeThreads.length + props.jobs.filter((job) => job.enabled).length} things`
                            : 'needs setup'}
                    </h2>
                    <p>
                        {props.roomReady
                            ? 'Sessions, jobs, and files are ready in this room.'
                            : 'Connect a model before this room starts sessions or jobs.'}
                    </p>
                </span>
                <div className="button-row">
                    <button
                        type="button"
                        className="button primary"
                        onClick={props.onCreateSession}
                        disabled={props.createSessionPending || !props.roomReady}
                    >
                        <Plus size={17} />
                        Start session
                    </button>
                    <Link
                        to="/rooms/$roomId/jobs"
                        params={{ roomId: props.room.roomId }}
                        className="button secondary"
                    >
                        <ListTodo size={17} />
                        Add job
                    </Link>
                </div>
            </section>

            <section className="surface">
                <div className="surface-heading">
                    <div>
                        <h2>Active sessions</h2>
                        <p>{activeThreads.length} recent sessions</p>
                    </div>
                    <Link
                        to="/rooms/$roomId"
                        params={{ roomId: props.room.roomId }}
                        className="text-link"
                    >
                        View room
                    </Link>
                </div>
                <div className="stack-list">
                    {activeThreads.length === 0 ? <p className="muted">No sessions yet.</p> : null}
                    {activeThreads.map((thread) => (
                        <Link
                            key={thread.key}
                            to="/rooms/$roomId/sessions/$sessionKey"
                            params={{ roomId: props.room.roomId, sessionKey: thread.key }}
                            className="plain-row"
                        >
                            <span className={`status-dot ${statusTone(thread.status)}`} />
                            <span>
                                <strong>{thread.title}</strong>
                                <small>
                                    {thread.lastMessagePreview ?? sessionStateLabel(thread)}
                                </small>
                            </span>
                            <small>{formatRelativeTime(thread.updatedAt)}</small>
                        </Link>
                    ))}
                </div>
            </section>

            <section className="surface">
                <div className="surface-heading">
                    <div>
                        <h2>Next job</h2>
                        <p>{upcomingJob ? upcomingJob.scheduleSummary : 'No job scheduled'}</p>
                    </div>
                    <Clock3 size={19} />
                </div>
                {upcomingJob ? (
                    <div className="feature-block">
                        <strong>{upcomingJob.name}</strong>
                        <p>
                            {upcomingJob.payloadSummary ??
                                upcomingJob.description ??
                                'Scheduled work'}
                        </p>
                        <small>Next run {formatDateTime(upcomingJob.nextRunAt)}</small>
                    </div>
                ) : (
                    <Link
                        to="/rooms/$roomId/jobs"
                        params={{ roomId: props.room.roomId }}
                        className="button secondary"
                    >
                        <Plus size={17} />
                        Create job
                    </Link>
                )}
            </section>

            <section className="surface">
                <div className="surface-heading">
                    <div>
                        <h2>Recent files</h2>
                        <p>{recentFiles.length} files</p>
                    </div>
                    <Link
                        to="/rooms/$roomId/files"
                        params={{ roomId: props.room.roomId }}
                        className="text-link"
                    >
                        View all
                    </Link>
                </div>
                <div className="stack-list">
                    {recentFiles.length === 0 ? <p className="muted">No files yet.</p> : null}
                    {recentFiles.map((file) => (
                        <div key={`${file.surface}:${file.relativePath}`} className="plain-row">
                            <span className="file-icon">
                                <FileText size={18} />
                            </span>
                            <span>
                                <strong>{file.name}</strong>
                                <small>
                                    {formatBytes(file.byteLength)} ·{' '}
                                    {formatRelativeTime(file.updatedAt)}
                                </small>
                            </span>
                        </div>
                    ))}
                </div>
            </section>

            <section className="surface span-wide">
                <div className="surface-heading">
                    <div>
                        <h2>{props.roomReady ? 'Send a task' : 'Start work after setup'}</h2>
                        <p>
                            {props.roomReady
                                ? 'Starts a session in this room.'
                                : 'Tasks stay disabled until the model connection is ready.'}
                        </p>
                    </div>
                    <Send size={19} />
                </div>
                {props.roomReady ? (
                    <form className="inline-task-form" onSubmit={props.onWakeRoom}>
                        <textarea
                            value={props.wakeText}
                            onChange={(event) => props.setWakeText(event.target.value)}
                            placeholder={`Ask ${props.room.displayName} to do something`}
                        />
                        <button
                            type="submit"
                            className="button primary"
                            disabled={props.wakePending || !props.wakeText.trim()}
                        >
                            <Send size={17} />
                            Send
                        </button>
                    </form>
                ) : (
                    <Link
                        to="/rooms/$roomId/settings"
                        params={{ roomId: props.room.roomId }}
                        className="button secondary"
                    >
                        <Settings size={17} />
                        Open settings
                    </Link>
                )}
            </section>

            <section className="surface span-wide">
                <div className="surface-heading">
                    <div>
                        <h2>Needs attention</h2>
                        <p>{attentionText ? 'One thing needs a look.' : 'No attention needed.'}</p>
                    </div>
                    <AlertTriangle size={19} />
                </div>
                {attentionText ? (
                    <div className="plain-row">
                        <span className="status-dot attention" />
                        <span>
                            <strong>Room needs setup</strong>
                            <small>{attentionText}</small>
                        </span>
                        <Link
                            to="/rooms/$roomId/status"
                            params={{ roomId: props.room.roomId }}
                            className="button compact"
                        >
                            Open status
                        </Link>
                    </div>
                ) : (
                    <div className="plain-row">
                        <span className="status-dot ready" />
                        <span>
                            <strong>Everything looks ready</strong>
                            <small>Jobs and sessions can run when you start them.</small>
                        </span>
                    </div>
                )}
            </section>

            <section className="plain-row room-tip">
                <Sparkles size={18} />
                <span>
                    <strong>Tip</strong>
                    <small>Add files and instructions to help {props.room.displayName} work.</small>
                </span>
                <Link
                    to="/rooms/$roomId/files"
                    params={{ roomId: props.room.roomId }}
                    className="button compact"
                >
                    Upload files
                </Link>
            </section>
        </section>
    )
}

function FilesSurface(props: { files: RoomFileEntry[] }) {
    const [searchText, setSearchText] = useState('')
    const [fileFilter, setFileFilter] = useState('all')
    const allFiles = props.files.filter((file) => file.kind === 'file')
    const normalizedSearch = searchText.trim().toLowerCase()
    const recentFiles = allFiles
        .filter((file) => {
            const extension = file.name.split('.').pop()?.toLowerCase() ?? 'file'
            const matchesFilter = fileFilter === 'all' || extension === fileFilter
            const matchesSearch =
                !normalizedSearch ||
                `${file.name} ${file.relativePath}`.toLowerCase().includes(normalizedSearch)
            return matchesFilter && matchesSearch
        })
        .slice(0, 4)
    const createdFiles = allFiles.filter((file) => {
        const extension = file.name.split('.').pop()?.toLowerCase() ?? 'file'
        return fileFilter === 'all' || extension === fileFilter
    })
    const fileTypes = Array.from(
        new Set(allFiles.map((file) => file.name.split('.').pop()?.toLowerCase() ?? 'file')),
    )

    return (
        <section className="files-layout">
            <section className="upload-drop surface">
                <Upload size={30} />
                <span>
                    <h2>Upload files to this room</h2>
                    <p>Drag files here, or choose files to add to the room workspace.</p>
                </span>
                <button type="button" className="button secondary" disabled>
                    <Upload size={17} />
                    Upload files
                </button>
            </section>
            <section className="file-toolbar">
                <label>
                    <Search size={18} />
                    <input
                        value={searchText}
                        onChange={(event) => setSearchText(event.target.value)}
                        placeholder="Search files"
                    />
                </label>
                <label>
                    <select
                        value={fileFilter}
                        onChange={(event) => setFileFilter(event.target.value)}
                        aria-label="File type"
                    >
                        <option value="all">All files</option>
                        {fileTypes.map((type) => (
                            <option key={type} value={type}>
                                {type.toUpperCase()}
                            </option>
                        ))}
                    </select>
                </label>
            </section>
            <section className="surface span-wide">
                <div className="surface-heading">
                    <div>
                        <h2>Recent files</h2>
                        <p>Files opened or changed recently.</p>
                    </div>
                    <LinkIcon size={19} />
                </div>
                <div className="file-card-grid">
                    {recentFiles.length === 0 ? <p className="muted">No recent files.</p> : null}
                    {recentFiles.map((file) => (
                        <article
                            key={`recent:${file.surface}:${file.relativePath}`}
                            className="file-card"
                        >
                            <span className="file-icon">
                                <FileText size={18} />
                            </span>
                            <span>
                                <strong>{file.name}</strong>
                                <small>
                                    {formatBytes(file.byteLength)} ·{' '}
                                    {formatRelativeTime(file.updatedAt)}
                                </small>
                            </span>
                            <button
                                type="button"
                                className="icon-button"
                                disabled
                                aria-label="File actions"
                            >
                                <MoreHorizontal size={16} />
                            </button>
                        </article>
                    ))}
                </div>
            </section>
            <section className="surface span-wide">
                <div className="surface-heading">
                    <div>
                        <h2>Uploads</h2>
                        <p>Files added by the operator appear here.</p>
                    </div>
                    <Upload size={19} />
                </div>
                <p className="muted">Upload support is ready for the room file flow.</p>
            </section>
            <section className="surface span-wide table-surface">
                <div className="surface-heading">
                    <div>
                        <h2>Created by room</h2>
                        <p>{createdFiles.length} files</p>
                    </div>
                    <Folder size={19} />
                </div>
                <div className="responsive-table file-table">
                    <div className="table-header">
                        <span>Name</span>
                        <span>Type</span>
                        <span>Size</span>
                        <span>Updated</span>
                        <span>Actions</span>
                    </div>
                    {createdFiles.length === 0 ? (
                        <p className="muted table-empty">No files yet.</p>
                    ) : null}
                    {createdFiles.map((file) => (
                        <div key={`${file.surface}:${file.relativePath}`} className="table-row">
                            <span>
                                <strong>{file.name}</strong>
                                <small>{file.relativePath}</small>
                            </span>
                            <span>{file.name.split('.').pop()?.toUpperCase() ?? 'File'}</span>
                            <span>{formatBytes(file.byteLength)}</span>
                            <span>{formatRelativeTime(file.updatedAt)}</span>
                            <span className="table-actions">
                                <button type="button" className="button compact" disabled>
                                    <Eye size={15} />
                                    Preview
                                </button>
                                <button type="button" className="button compact" disabled>
                                    <Download size={15} />
                                    Download
                                </button>
                                <button type="button" className="button compact" disabled>
                                    <LinkIcon size={15} />
                                    Attach
                                </button>
                            </span>
                        </div>
                    ))}
                </div>
            </section>
        </section>
    )
}

function JobsSurface(props: {
    jobs: RoomCronJob[]
    jobName: string
    setJobName: (value: string) => void
    jobMessage: string
    setJobMessage: (value: string) => void
    jobEveryMinutes: string
    setJobEveryMinutes: (value: string) => void
    onCreateJob: (event: FormEvent<HTMLFormElement>) => void
    createPending: boolean
    onRunJob: (jobId: string) => void
    onToggleJob: (jobId: string, enabled: boolean) => void
    onRemoveJob: (jobId: string) => void
}) {
    return (
        <section className="jobs-layout">
            <section className="surface span-wide table-surface">
                <div className="surface-heading">
                    <div>
                        <h2>Jobs</h2>
                        <p>Recurring work for this room.</p>
                    </div>
                    <ListTodo size={19} />
                </div>
                <div className="responsive-table jobs-table">
                    <div className="table-header">
                        <span>Job</span>
                        <span>Status</span>
                        <span>Next run</span>
                        <span>Last result</span>
                        <span>Actions</span>
                    </div>
                    {props.jobs.length === 0 ? (
                        <p className="muted table-empty">No jobs yet.</p>
                    ) : null}
                    {props.jobs.map((job) => (
                        <div key={job.id} className="table-row">
                            <span>
                                <strong>{job.name}</strong>
                                <small>
                                    {job.payloadSummary ?? job.description ?? 'Scheduled room work'}
                                </small>
                            </span>
                            <span className={`pill ${job.enabled ? 'ready' : 'muted'}`}>
                                {job.enabled ? 'Enabled' : 'Paused'}
                            </span>
                            <span>
                                <strong>{job.scheduleSummary}</strong>
                                <small>{formatDateTime(job.nextRunAt)}</small>
                            </span>
                            <span className={`pill ${statusTone(job.lastRunStatus)}`}>
                                {job.lastRunStatus ?? 'not run'}
                            </span>
                            <span className="table-actions">
                                <button
                                    type="button"
                                    className="button compact"
                                    onClick={() => props.onRunJob(job.id)}
                                >
                                    <Play size={15} />
                                    Run now
                                </button>
                                <button
                                    type="button"
                                    className="button compact"
                                    onClick={() => props.onToggleJob(job.id, !job.enabled)}
                                >
                                    {job.enabled ? 'Pause' : 'Enable'}
                                </button>
                                <button
                                    type="button"
                                    className="icon-button"
                                    onClick={() => props.onRemoveJob(job.id)}
                                    aria-label="Remove job"
                                >
                                    <MoreHorizontal size={16} />
                                </button>
                            </span>
                        </div>
                    ))}
                </div>
            </section>

            <section className="surface span-wide">
                <div className="surface-heading">
                    <div>
                        <h2>Create a new job</h2>
                        <p>Tell the room what to do and when.</p>
                    </div>
                    <Plus size={19} />
                </div>
                <form className="job-create-grid" onSubmit={props.onCreateJob}>
                    <label>
                        1. What should this room do?
                        <textarea
                            value={props.jobMessage}
                            onChange={(event) => props.setJobMessage(event.target.value)}
                            placeholder="Example: Send a weekly progress summary to our investors."
                        />
                    </label>
                    <fieldset className="option-box">
                        <legend>2. When should it happen?</legend>
                        <div className="schedule-choice-grid">
                            {jobSchedulePresets.map((preset) => (
                                <label key={preset.value} className="schedule-option">
                                    <input
                                        type="radio"
                                        name="job-schedule"
                                        checked={
                                            preset.value === 'custom'
                                                ? !jobSchedulePresets.some(
                                                      (entry) =>
                                                          entry.value !== 'custom' &&
                                                          entry.value === props.jobEveryMinutes,
                                                  )
                                                : props.jobEveryMinutes === preset.value
                                        }
                                        onChange={() => {
                                            if (preset.value !== 'custom') {
                                                props.setJobEveryMinutes(preset.value)
                                            }
                                        }}
                                    />
                                    <span>
                                        <strong>{preset.label}</strong>
                                        <small>{preset.helper}</small>
                                    </span>
                                </label>
                            ))}
                        </div>
                        <input
                            type="number"
                            min="1"
                            step="1"
                            value={props.jobEveryMinutes}
                            onChange={(event) => props.setJobEveryMinutes(event.target.value)}
                            aria-label="Custom interval in minutes"
                        />
                    </fieldset>
                    <div className="nested-grid">
                        <label>
                            3. Review and create
                            <input
                                value={props.jobName}
                                onChange={(event) => props.setJobName(event.target.value)}
                                placeholder="Weekly summary"
                            />
                            <small className="input-hint">
                                {jobScheduleLabel(props.jobEveryMinutes)}
                            </small>
                        </label>
                        <button
                            type="submit"
                            className="button primary"
                            disabled={
                                props.createPending ||
                                !props.jobName.trim() ||
                                !props.jobMessage.trim()
                            }
                        >
                            <Plus size={17} />
                            Create job
                        </button>
                    </div>
                </form>
            </section>
        </section>
    )
}

function StatusSurface(props: {
    room: RoomRuntimeOverview
    roomConfig: RoomConfigSnapshot | undefined
    jobs: RoomCronJob[]
    files: RoomFileEntry[]
    runHistory: RoomRunHistorySnapshot | undefined
    codexOAuthSession: CodexOAuthSessionSnapshot | null
    codexAuthReady: boolean
    codexOAuthActive: boolean
    codexRedirectUrl: string
    setCodexRedirectUrl: (value: string) => void
    onStartCodexOAuth: () => void
    onCopyCodexAuthUrl: () => void
    onSubmitCodexRedirect: (event: FormEvent<HTMLFormElement>) => void
    onCancelCodexOAuth: () => void
    codexStartPending: boolean
    codexSubmitPending: boolean
    codexCancelPending: boolean
    onPause: () => void
    onResume: () => void
    desiredStatePending: boolean
}) {
    const modelReady = props.roomConfig?.effective.ready ?? false
    const jobFailure = props.jobs.find((job) => job.lastError)
    const latestSuccess = props.runHistory?.entries.find(
        (entry) => statusTone(entry.status) === 'ready',
    )
    const latestFailure = props.runHistory?.entries.find(
        (entry) => statusTone(entry.status) === 'attention',
    )
    const codexRequired = props.roomConfig?.effective.codexAuth?.required ?? false

    return (
        <section className="status-grid">
            <StatusCard
                title="Model connection"
                value={modelReady ? 'Connected' : 'Needs setup'}
                tone={modelReady ? 'ready' : 'attention'}
                text={
                    props.roomConfig?.effective.providerLabel ??
                    friendlyNotice(props.roomConfig?.effective.blockedReasons[0] ?? null) ??
                    'No model connection selected'
                }
            />
            <StatusCard
                title="Jobs"
                value={jobFailure ? 'Needs attention' : 'Running normally'}
                tone={jobFailure ? 'attention' : 'ready'}
                text={
                    friendlyNotice(jobFailure?.lastError ?? null) ??
                    `${props.jobs.filter((job) => job.enabled).length} enabled jobs`
                }
            />
            <StatusCard
                title="Files"
                value="Available"
                tone="ready"
                text={`${props.files.filter((file) => file.kind === 'file').length} files found`}
            />
            <StatusCard
                title="Room setup"
                value={roomStateLabel(props.room)}
                tone={roomStateTone(props.room)}
                text={friendlyNotice(props.room.lastError) ?? 'Ready for sessions and jobs'}
            />

            {codexRequired ? (
                <section className="surface span-wide">
                    <div className="surface-heading">
                        <div>
                            <h2>OpenAI Codex login</h2>
                            <p>
                                {props.codexOAuthSession?.message ??
                                    props.roomConfig?.effective.codexAuth?.message ??
                                    'Complete login for this room.'}
                            </p>
                        </div>
                        <span className={`pill ${props.codexAuthReady ? 'ready' : 'attention'}`}>
                            {props.codexAuthReady ? 'Connected' : 'Needs login'}
                        </span>
                    </div>
                    {!props.codexAuthReady ? (
                        <div className="codex-flow">
                            <div className="button-row">
                                <button
                                    type="button"
                                    className="button primary"
                                    onClick={props.onStartCodexOAuth}
                                    disabled={props.codexStartPending || props.codexOAuthActive}
                                >
                                    <KeyRound size={17} />
                                    Generate login link
                                </button>
                                {props.codexOAuthSession?.authUrl ? (
                                    <>
                                        <a
                                            className="button secondary"
                                            href={props.codexOAuthSession.authUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                        >
                                            <ExternalLink size={17} />
                                            Open
                                        </a>
                                        <button
                                            type="button"
                                            className="button secondary"
                                            onClick={props.onCopyCodexAuthUrl}
                                        >
                                            <Copy size={17} />
                                            Copy
                                        </button>
                                    </>
                                ) : null}
                                {props.codexOAuthActive ? (
                                    <button
                                        type="button"
                                        className="button danger"
                                        onClick={props.onCancelCodexOAuth}
                                        disabled={props.codexCancelPending}
                                    >
                                        Cancel
                                    </button>
                                ) : null}
                            </div>
                            {props.codexOAuthSession?.authUrl ? (
                                <form
                                    className="form-grid single"
                                    onSubmit={props.onSubmitCodexRedirect}
                                >
                                    <label>
                                        Redirect URL
                                        <textarea
                                            value={props.codexRedirectUrl}
                                            onChange={(event) =>
                                                props.setCodexRedirectUrl(event.target.value)
                                            }
                                            placeholder="Paste the redirected browser URL"
                                        />
                                    </label>
                                    <button
                                        type="submit"
                                        className="button primary"
                                        disabled={
                                            props.codexSubmitPending ||
                                            !props.codexRedirectUrl.trim()
                                        }
                                    >
                                        Submit redirect
                                    </button>
                                </form>
                            ) : null}
                        </div>
                    ) : null}
                </section>
            ) : null}

            <section className="surface span-wide">
                <div className="surface-heading">
                    <div>
                        <h2>Room controls</h2>
                        <p>Pause or resume sessions and jobs for this room.</p>
                    </div>
                    <PauseCircle size={19} />
                </div>
                <div className="button-row">
                    <button
                        type="button"
                        className="button secondary"
                        onClick={props.onPause}
                        disabled={
                            props.desiredStatePending || props.room.desiredState === 'stopped'
                        }
                    >
                        <PauseCircle size={17} />
                        Pause room
                    </button>
                    <button
                        type="button"
                        className="button primary"
                        onClick={props.onResume}
                        disabled={
                            props.desiredStatePending || props.room.desiredState === 'running'
                        }
                    >
                        <Play size={17} />
                        Resume room
                    </button>
                </div>
            </section>

            <section className="surface span-wide">
                <div className="surface-heading">
                    <div>
                        <h2>Last work</h2>
                        <p>Recent successful and failed runs.</p>
                    </div>
                    <Activity size={19} />
                </div>
                <div className="stack-list">
                    <div className="plain-row">
                        <CheckCircle2 size={18} />
                        <span>
                            <strong>Last successful work</strong>
                            <small>
                                {latestSuccess
                                    ? `${latestSuccess.jobName ?? 'Session'} · ${formatDateTime(latestSuccess.ts)}`
                                    : 'No successful run yet'}
                            </small>
                        </span>
                    </div>
                    <div className="plain-row">
                        <AlertTriangle size={18} />
                        <span>
                            <strong>Last failed work</strong>
                            <small>
                                {latestFailure
                                    ? (friendlyNotice(latestFailure.error ?? null) ??
                                      latestFailure.summary ??
                                      'Failed')
                                    : 'No failed run'}
                            </small>
                        </span>
                    </div>
                </div>
            </section>
        </section>
    )
}

function StatusCard(props: {
    title: string
    value: string
    text: string
    tone: 'ready' | 'working' | 'attention' | 'muted'
}) {
    return (
        <article className="status-card surface">
            <span className={`status-dot ${props.tone}`} />
            <span>
                <h2>{props.title}</h2>
                <strong>{props.value}</strong>
                <p>{props.text}</p>
            </span>
        </article>
    )
}
