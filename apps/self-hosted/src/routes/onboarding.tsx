import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import {
    ArrowRightIcon,
    CheckCircle2Icon,
    CircleIcon,
    KeyRoundIcon,
    LoaderIcon,
    SparklesIcon,
} from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'

import { AttentionBanner, BrandMark } from '#/components/agent-room'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '#/components/ui/select'
import { Textarea } from '#/components/ui/textarea'
import { cn } from '#/lib/utils'
import type { ProviderApi } from '#/domain/domain-types'
import { roomQueryKey } from '#/lib/room-query-keys'
import { markChatSelection } from '#/lib/browser-performance'

import { currentUserServer } from './-auth-server'
import { friendlyNotice } from './-notice-copy'
import {
    getOperatorConfigServer,
    saveProviderConnectionServer,
    updateAppDefaultsServer,
} from './-operator-config-server'
import {
    createRoomServer,
    createThreadServer,
    getRoomSetupReadinessServer,
} from './-room-runtime-server'

interface CatalogEntry {
    provider: string
    label: string
    api: ProviderApi
    model: string
}

interface SavedProvider {
    id: string
    label: string
    defaultModel: string
    status: 'unchecked' | 'ready' | 'invalid'
    validationMessage: string | null
}

type StepId = 'portal' | 'provider' | 'room' | 'done'
type StepState = 'complete' | 'active' | 'pending'

export const Route = createFileRoute('/onboarding')({
    beforeLoad: async () => {
        const user = await currentUserServer()
        if (!user) throw redirect({ to: '/login' })
        const config = await getOperatorConfigServer()
        if (config.onboarding.completed) throw redirect({ to: '/' })
    },
    component: OnboardingPage,
})

function makeCatalogKey(entry: CatalogEntry): string {
    return `${entry.provider}::${entry.api}`
}

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

    const catalog = (configQuery.data?.providerCatalog ?? []) as CatalogEntry[]
    const blockingIssues =
        readinessQuery.data?.issues.filter((issue) => issue.severity === 'blocking') ?? []

    const [activeStep, setActiveStep] = useState<StepId>('provider')
    const [savedProvider, setSavedProvider] = useState<SavedProvider | null>(null)
    const [createdRoomId, setCreatedRoomId] = useState<string | null>(null)
    const [createdSessionKey, setCreatedSessionKey] = useState<string | null>(null)
    const [firstRoomBlockedReason, setFirstRoomBlockedReason] = useState<string | null>(null)

    const [providerKey, setProviderKey] = useState<string>('')
    const [providerLabel, setProviderLabel] = useState('')
    const [defaultModel, setDefaultModel] = useState('')
    const [baseUrl, setBaseUrl] = useState('')
    const [apiKey, setApiKey] = useState('')
    const [providerError, setProviderError] = useState<string | null>(null)

    const [roomName, setRoomName] = useState('')
    const [roomInstructions, setRoomInstructions] = useState('')
    const [roomError, setRoomError] = useState<string | null>(null)

    const fallbackEntry = catalog[0] ?? null
    const selectedEntry =
        catalog.find((entry) => makeCatalogKey(entry) === providerKey) ?? fallbackEntry
    const effectiveLabel = providerLabel || selectedEntry?.label || ''
    const effectiveModel = defaultModel || selectedEntry?.model || ''
    const providerUsesOAuth = selectedEntry?.api === 'openai-codex-responses'

    const saveProvider = useMutation({
        mutationFn: async () => {
            if (!selectedEntry) throw new Error('Choose a provider to continue.')
            if (!effectiveLabel.trim()) throw new Error('Give the connection a label.')
            if (!effectiveModel.trim()) throw new Error('A default model is required.')
            const summary = await saveProviderConnectionServer({
                data: {
                    label: effectiveLabel.trim(),
                    provider: selectedEntry.provider,
                    api: selectedEntry.api,
                    baseUrl: baseUrl.trim() ? baseUrl.trim() : null,
                    defaultModel: effectiveModel.trim(),
                    fallbackModels: [],
                    apiKey: apiKey ? apiKey : undefined,
                    makeDefault: true,
                },
            })
            await updateAppDefaultsServer({
                data: {
                    defaultProviderConnectionId: summary.id,
                    defaultModel: summary.defaultModel,
                    onboardingCompleted: false,
                },
            })
            return summary
        },
        onSuccess: async (summary) => {
            setProviderError(null)
            setSavedProvider({
                id: summary.id,
                label: summary.label,
                defaultModel: summary.defaultModel,
                status: summary.status,
                validationMessage: summary.validationMessage,
            })
            await queryClient.invalidateQueries({ queryKey: roomQueryKey.operatorConfig })
            setActiveStep('room')
        },
        onError: (error: unknown) => {
            setProviderError(messageFromError(error, 'Could not save provider.'))
        },
    })

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
            if (!savedProvider) throw new Error('Provider not configured.')
            if (!createdRoomId) throw new Error('Room not created.')
            await updateAppDefaultsServer({
                data: {
                    defaultProviderConnectionId: savedProvider.id,
                    defaultModel: savedProvider.defaultModel,
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
    const providerState: StepState = savedProvider
        ? 'complete'
        : activeStep === 'provider'
          ? 'active'
          : 'pending'
    const roomState: StepState = createdRoomId
        ? 'complete'
        : activeStep === 'room'
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
                        description="Connect the provider rooms will use for chat and jobs."
                        summary={
                            savedProvider
                                ? `${savedProvider.label} - default model ${savedProvider.defaultModel}`
                                : null
                        }
                    >
                        {activeStep === 'provider' && !savedProvider ? (
                            <ProviderForm
                                catalog={catalog}
                                providerKey={
                                    providerKey ||
                                    (fallbackEntry ? makeCatalogKey(fallbackEntry) : '')
                                }
                                onProviderKey={(value) => {
                                    setProviderKey(value)
                                    const entry = catalog.find(
                                        (item) => makeCatalogKey(item) === value,
                                    )
                                    if (entry) {
                                        setProviderLabel((current) => current || entry.label)
                                        setDefaultModel(entry.model)
                                    }
                                }}
                                providerLabel={providerLabel}
                                onProviderLabel={setProviderLabel}
                                defaultModel={defaultModel}
                                onDefaultModel={setDefaultModel}
                                baseUrl={baseUrl}
                                onBaseUrl={setBaseUrl}
                                apiKey={apiKey}
                                onApiKey={setApiKey}
                                usesOAuth={providerUsesOAuth}
                                placeholderLabel={selectedEntry?.label ?? 'OpenAI'}
                                placeholderModel={selectedEntry?.model ?? ''}
                                error={providerError}
                                pending={saveProvider.isPending}
                                onSubmit={(event) => {
                                    event.preventDefault()
                                    saveProvider.mutate()
                                }}
                            />
                        ) : null}
                        {savedProvider ? (
                            <ProviderResult
                                status={savedProvider.status}
                                message={savedProvider.validationMessage}
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

function ProviderForm(props: {
    catalog: CatalogEntry[]
    providerKey: string
    onProviderKey: (value: string) => void
    providerLabel: string
    onProviderLabel: (value: string) => void
    defaultModel: string
    onDefaultModel: (value: string) => void
    baseUrl: string
    onBaseUrl: (value: string) => void
    apiKey: string
    onApiKey: (value: string) => void
    usesOAuth: boolean
    placeholderLabel: string
    placeholderModel: string
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
                <Label htmlFor="provider-choice">Provider</Label>
                <Select value={props.providerKey} onValueChange={props.onProviderKey}>
                    <SelectTrigger id="provider-choice" className="w-full">
                        <SelectValue placeholder="Choose a provider" />
                    </SelectTrigger>
                    <SelectContent>
                        {props.catalog.map((entry) => (
                            <SelectItem key={makeCatalogKey(entry)} value={makeCatalogKey(entry)}>
                                {entry.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                    <Label htmlFor="provider-label">Label</Label>
                    <Input
                        id="provider-label"
                        value={props.providerLabel}
                        onChange={(event) => props.onProviderLabel(event.target.value)}
                        placeholder={props.placeholderLabel}
                    />
                </div>
                <div className="space-y-1.5">
                    <Label htmlFor="provider-model">Default model</Label>
                    <Input
                        id="provider-model"
                        value={props.defaultModel}
                        onChange={(event) => props.onDefaultModel(event.target.value)}
                        placeholder={props.placeholderModel}
                    />
                </div>
            </div>

            <div className="space-y-1.5">
                <Label htmlFor="provider-base-url">
                    Base URL <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                    id="provider-base-url"
                    value={props.baseUrl}
                    onChange={(event) => props.onBaseUrl(event.target.value)}
                    placeholder="Optional endpoint override"
                />
            </div>

            {props.usesOAuth ? null : (
                <div className="space-y-1.5">
                    <Label htmlFor="provider-api-key">API key</Label>
                    <Input
                        id="provider-api-key"
                        type="password"
                        value={props.apiKey}
                        onChange={(event) => props.onApiKey(event.target.value)}
                        autoComplete="new-password"
                        placeholder="sk-..."
                    />
                    <p className="text-xs text-muted-foreground">
                        Stored encrypted on this server. Never sent to the browser.
                    </p>
                </div>
            )}

            <Button type="submit" disabled={props.pending}>
                <KeyRoundIcon />
                {props.pending ? 'Testing connection...' : 'Save and test connection'}
            </Button>
        </form>
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

function ProviderResult({
    status,
    message,
}: {
    status: 'unchecked' | 'ready' | 'invalid'
    message: string | null
}) {
    if (status === 'ready') {
        return (
            <Alert>
                <AlertDescription>
                    Connection looks good. Continue to create your first room.
                </AlertDescription>
            </Alert>
        )
    }
    if (status === 'invalid') {
        return (
            <Alert variant="destructive">
                <AlertDescription>
                    {message ?? 'The provider rejected the credentials. Update and try again.'}
                </AlertDescription>
            </Alert>
        )
    }
    return (
        <Alert>
            <AlertDescription className="flex items-center gap-2">
                <LoaderIcon className="size-4" />
                Provider saved. Continue when ready.
            </AlertDescription>
        </Alert>
    )
}
