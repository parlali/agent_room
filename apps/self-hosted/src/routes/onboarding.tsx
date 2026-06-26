import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import {
    ArrowRightIcon,
    CheckCircle2Icon,
    CircleIcon,
    KeyRoundIcon,
    SparklesIcon,
} from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'

import { AttentionBanner, BrandMark } from '#/components/agent-room'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Textarea } from '#/components/ui/textarea'
import { cn } from '#/lib/utils'
import { roomQueryKey } from '#/lib/room-query-keys'
import { markChatSelection } from '#/lib/browser-performance'

import { friendlyNotice } from './-notice-copy'
import { getOperatorConfigServer, updateAppDefaultsServer } from './-operator-config-server'
import {
    createRoomServer,
    createThreadServer,
    getRoomSetupReadinessServer,
} from './-room-runtime-server'
import { requireRouteUser } from './-route-auth'

interface ConfiguredProvider {
    id: string | null
    label: string
    defaultModel: string
}

type StepId = 'portal' | 'provider' | 'room' | 'done'
type StepState = 'complete' | 'active' | 'pending'

export const Route = createFileRoute('/onboarding')({
    beforeLoad: async () => {
        await requireRouteUser()
        const config = await getOperatorConfigServer()
        if (config.onboarding.completed) throw redirect({ to: '/' })
    },
    component: OnboardingPage,
})

function messageFromError(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) return error.message
    if (typeof error === 'string' && error.length > 0) return error
    return fallback
}

function OnboardingPage() {
    const navigate = useNavigate()
    const queryClient = useQueryClient()

    const configQuery = useQuery({
        queryKey: roomQueryKey.operatorConfig,
        queryFn: () => getOperatorConfigServer(),
    })
    const readinessQuery = useQuery({
        queryKey: roomQueryKey.setupReadiness,
        queryFn: () => getRoomSetupReadinessServer(),
    })

    const blockingIssues =
        readinessQuery.data?.issues.filter((issue) => issue.severity === 'blocking') ?? []

    const [activeStep, setActiveStep] = useState<StepId>('provider')
    const [createdRoomId, setCreatedRoomId] = useState<string | null>(null)
    const [createdSessionKey, setCreatedSessionKey] = useState<string | null>(null)
    const [firstRoomBlockedReason, setFirstRoomBlockedReason] = useState<string | null>(null)

    const [roomName, setRoomName] = useState('')
    const [roomInstructions, setRoomInstructions] = useState('')
    const [roomError, setRoomError] = useState<string | null>(null)

    const readyProviders = (configQuery.data?.providers ?? []).filter(
        (provider) => provider.status === 'ready',
    )
    const defaultProvider =
        readyProviders.find(
            (provider) => provider.id === configQuery.data?.settings.defaultProviderConnectionId,
        ) ?? null
    const configuredProvider =
        defaultProvider ?? (readyProviders.length === 1 ? readyProviders[0] : null)
    const managedOpenRouterReady = configQuery.data?.onboarding.managedOpenRouterAvailable === true
    const configuredProviderSummary: ConfiguredProvider | null = configuredProvider
        ? {
              id: configuredProvider.id,
              label: configuredProvider.label,
              defaultModel: configuredProvider.defaultModel,
          }
        : managedOpenRouterReady
          ? {
                id: null,
                label: 'Hosted',
                defaultModel: 'Managed model',
            }
          : null
    const providerReady = configuredProviderSummary !== null

    useEffect(() => {
        if (providerReady && activeStep === 'provider') {
            setActiveStep('room')
        }
    }, [activeStep, providerReady])

    const createRoom = useMutation({
        mutationFn: async () => {
            const trimmed = roomName.trim()
            if (!trimmed) throw new Error('A room name is required.')
            return createRoomServer({
                data: {
                    displayName: trimmed,
                    instructions: roomInstructions.trim() || undefined,
                    startImmediately: true,
                },
            })
        },
        onSuccess: async (room) => {
            setRoomError(null)
            setCreatedRoomId(room.id)
            setFirstRoomBlockedReason(null)
            await queryClient.invalidateQueries({ queryKey: roomQueryKey.roomsList })
            try {
                const thread = await createThreadServer({
                    data: {
                        roomId: room.id,
                    },
                })
                setCreatedSessionKey(thread.key)
            } catch (error) {
                setCreatedSessionKey(null)
                setFirstRoomBlockedReason(
                    friendlyNotice(
                        messageFromError(
                            error,
                            'The room is ready for setup, but no session is ready yet.',
                        ),
                    ) ?? 'The room is ready for setup, but no session is ready yet.',
                )
            }
            setActiveStep('done')
        },
        onError: (error: unknown) => {
            setRoomError(messageFromError(error, 'Could not create the room.'))
        },
    })

    const finish = useMutation({
        mutationFn: async () => {
            if (!configuredProviderSummary) throw new Error('Provider not configured.')
            if (!createdRoomId) throw new Error('Room not created.')
            await updateAppDefaultsServer({
                data: {
                    defaultProviderConnectionId: configuredProviderSummary.id,
                    defaultModel: configuredProviderSummary.id
                        ? configuredProviderSummary.defaultModel
                        : null,
                    onboardingCompleted: true,
                },
            })
            return {
                roomId: createdRoomId,
                sessionKey: createdSessionKey,
            }
        },
        onSuccess: async (target) => {
            await queryClient.invalidateQueries({ queryKey: roomQueryKey.operatorConfig })
            if (target.sessionKey) {
                markChatSelection(target.roomId, target.sessionKey)
                await navigate({
                    to: '/rooms/$roomId/sessions/$sessionKey',
                    params: { roomId: target.roomId, sessionKey: target.sessionKey },
                })
                return
            }
            await navigate({ to: '/rooms/$roomId', params: { roomId: target.roomId } })
        },
    })

    const portalState: StepState = 'complete'
    const providerState: StepState = providerReady
        ? 'complete'
        : activeStep === 'provider'
          ? 'active'
          : 'pending'
    const roomState: StepState = createdRoomId
        ? 'complete'
        : activeStep === 'room' && providerReady
          ? 'active'
          : 'pending'
    const doneState: StepState = activeStep === 'done' ? 'active' : 'pending'

    return (
        <main className="min-h-screen bg-background px-6 py-12">
            <div className="mx-auto w-full max-w-2xl space-y-8">
                <header className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-lg bg-foreground/95 text-background">
                        <BrandMark size={22} className="text-background" />
                    </span>
                    <div>
                        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                            Setup
                        </p>
                        <h1 className="text-2xl font-semibold tracking-tight">
                            Welcome to Agent Room
                        </h1>
                        <p className="mt-0.5 text-sm text-muted-foreground">
                            A few quick steps to get your first room running.
                        </p>
                    </div>
                </header>

                {blockingIssues.length > 0 ? (
                    <AttentionBanner
                        tone="attention"
                        title="Portal needs attention"
                        description={
                            <ul className="mt-1 list-disc space-y-1 pl-4">
                                {blockingIssues.map((issue) => (
                                    <li key={issue.code}>{issue.message}</li>
                                ))}
                            </ul>
                        }
                    />
                ) : null}

                <ol className="space-y-3">
                    <Step
                        index={1}
                        state={portalState}
                        title="Portal ready"
                        description="You are signed in and the portal is reachable."
                    />

                    <Step
                        index={2}
                        state={providerState}
                        title="Add a model provider"
                        description="Configure the app-level provider rooms will use for chat and jobs."
                        summary={
                            configuredProviderSummary
                                ? `${configuredProviderSummary.label} - default model ${configuredProviderSummary.defaultModel}`
                                : null
                        }
                    >
                        {activeStep === 'provider' && !providerReady ? (
                            <ProviderSettingsPrompt
                                readyCount={readyProviders.length}
                                hasDefault={defaultProvider !== null}
                            />
                        ) : null}
                    </Step>

                    <Step
                        index={3}
                        state={roomState}
                        title="Create your first room"
                        description="A room is a persistent space where the agent works on a topic."
                        summary={createdRoomId && roomName ? `${roomName} is starting up.` : null}
                    >
                        {activeStep === 'room' && !createdRoomId ? (
                            <RoomForm
                                roomName={roomName}
                                onRoomName={setRoomName}
                                roomInstructions={roomInstructions}
                                onRoomInstructions={setRoomInstructions}
                                error={roomError}
                                pending={createRoom.isPending}
                                onSubmit={(event) => {
                                    event.preventDefault()
                                    createRoom.mutate()
                                }}
                            />
                        ) : null}
                    </Step>

                    <Step
                        index={4}
                        state={doneState}
                        title="All set"
                        description="Mark setup complete and open your new room."
                    >
                        {activeStep === 'done' ? (
                            <div className="space-y-3">
                                {firstRoomBlockedReason ? (
                                    <AttentionBanner
                                        tone="attention"
                                        title="Room created"
                                        description={firstRoomBlockedReason}
                                    />
                                ) : (
                                    <p className="text-sm text-muted-foreground">
                                        Your portal, provider, and first room are ready. Open the
                                        selected session to start work.
                                    </p>
                                )}
                                <Button
                                    onClick={() => finish.mutate()}
                                    disabled={finish.isPending}
                                    size="lg"
                                >
                                    {finish.isPending
                                        ? 'Finishing...'
                                        : createdSessionKey
                                          ? 'Open session'
                                          : 'Open room'}
                                    <ArrowRightIcon />
                                </Button>
                            </div>
                        ) : null}
                    </Step>
                </ol>
            </div>
        </main>
    )
}

function Step({
    index,
    state,
    title,
    description,
    summary,
    children,
}: {
    index: number
    state: StepState
    title: string
    description: string
    summary?: string | null
    children?: ReactNode
}) {
    return (
        <li className="flex gap-4 rounded-xl border border-border/70 bg-card p-5 shadow-sm">
            <StepIndicator index={index} state={state} />
            <div className="flex-1 space-y-2">
                <div>
                    <h2
                        className={cn(
                            'text-base font-semibold tracking-tight',
                            state === 'pending' && 'text-muted-foreground',
                        )}
                    >
                        {title}
                    </h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
                </div>
                {summary ? <p className="text-sm font-medium text-foreground">{summary}</p> : null}
                {children ? <div className="pt-2">{children}</div> : null}
            </div>
        </li>
    )
}

function StepIndicator({ index, state }: { index: number; state: StepState }) {
    if (state === 'complete') {
        return (
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
                <CheckCircle2Icon className="size-5" />
            </span>
        )
    }
    if (state === 'active') {
        return (
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-foreground text-sm font-semibold">
                {index}
            </span>
        )
    }
    return (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border text-sm font-medium text-muted-foreground">
            <CircleIcon className="size-3" />
        </span>
    )
}

function ProviderSettingsPrompt({
    readyCount,
    hasDefault,
}: {
    readyCount: number
    hasDefault: boolean
}) {
    const description =
        readyCount > 1 && !hasDefault
            ? 'Choose an app default provider in Settings before creating rooms.'
            : 'Add an OpenRouter key or authorize Codex app server in Settings before creating rooms.'

    return (
        <div className="space-y-3">
            <Alert>
                <AlertDescription>{description}</AlertDescription>
            </Alert>
            <Button asChild>
                <Link
                    to="/settings"
                    search={{
                        installationId: '',
                        setupAction: '',
                        githubState: '',
                    }}
                >
                    <KeyRoundIcon />
                    Open settings
                </Link>
            </Button>
        </div>
    )
}

function RoomForm(props: {
    roomName: string
    onRoomName: (value: string) => void
    roomInstructions: string
    onRoomInstructions: (value: string) => void
    error: string | null
    pending: boolean
    onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
    return (
        <form className="space-y-4" onSubmit={props.onSubmit} noValidate>
            {props.error ? (
                <Alert variant="destructive">
                    <AlertDescription>{props.error}</AlertDescription>
                </Alert>
            ) : null}
            <div className="space-y-1.5">
                <Label htmlFor="room-name">Room name</Label>
                <Input
                    id="room-name"
                    value={props.roomName}
                    onChange={(event) => props.onRoomName(event.target.value)}
                    placeholder="Research"
                    autoFocus
                    required
                />
            </div>
            <div className="space-y-1.5">
                <Label htmlFor="room-instructions">
                    What is this room for? <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Textarea
                    id="room-instructions"
                    value={props.roomInstructions}
                    onChange={(event) => props.onRoomInstructions(event.target.value)}
                    placeholder="Watch competitor releases, summarize daily, draft follow-up notes."
                    rows={4}
                />
            </div>
            <Button type="submit" disabled={props.pending}>
                <SparklesIcon />
                {props.pending ? 'Creating room...' : 'Create room'}
            </Button>
        </form>
    )
}
