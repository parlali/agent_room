import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router'
import { ArrowRightIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import {
    AttentionBanner,
    BrandMark,
    CreateRoomForm,
    type CreateRoomFormValues,
    CredentialField,
    Page,
    PageHeader,
    Section,
} from '#/components/agent-room'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { sanitizeRuntimeError } from '#/domain/runtime-error'
import { markChatSelection } from '#/lib/browser-performance'
import { roomQueryKey } from '#/lib/room-query-keys'

import { friendlyNotice } from './-notice-copy'
import {
    getOperatorConfigServer,
    saveProviderConnectionServer,
    updateAppDefaultsServer,
} from './-operator-config-server'
import { createRoomServer, createThreadServer } from './-room-runtime-server'
import { requireRouteUser } from './-route-auth'

export const Route = createFileRoute('/onboarding')({
    beforeLoad: async () => {
        await requireRouteUser()
        const config = await getOperatorConfigServer()
        if (config.onboarding.completed) throw redirect({ to: '/' })
    },
    component: OnboardingPage,
})

const sessionFallbackNotice = 'Your room was created, but it could not start a session yet.'

function messageFromError(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) return error.message
    if (typeof error === 'string' && error.length > 0) return error
    return fallback
}

function safeOnboardingNotice(error: unknown, fallback: string): string {
    const message = messageFromError(error, fallback)
    return sanitizeRuntimeError(friendlyNotice(message) ?? message)
}

function OnboardingShell({ children }: { children: ReactNode }) {
    return (
        <Page
            width="sm"
            header={
                <PageHeader
                    eyebrow="Setup"
                    glyph={
                        <span className="flex size-10 items-center justify-center rounded-lg bg-foreground/95 text-background">
                            <BrandMark size={22} className="text-background" />
                        </span>
                    }
                    title="Welcome to Agent Room"
                    subtitle="A couple of quick steps and your first room is ready to work."
                />
            }
        >
            {children}
        </Page>
    )
}

function OnboardingPage() {
    const navigate = useNavigate()
    const queryClient = useQueryClient()

    const configQuery = useQuery({
        queryKey: roomQueryKey.operatorConfig,
        queryFn: () => getOperatorConfigServer(),
    })

    const [apiKey, setApiKey] = useState('')
    const [keyError, setKeyError] = useState<string | null>(null)
    const [roomError, setRoomError] = useState<string | null>(null)
    const [createdRoomId, setCreatedRoomId] = useState<string | null>(null)
    const [blockedReason, setBlockedReason] = useState<string | null>(null)

    const config = configQuery.data
    const readyProviders = (config?.providers ?? []).filter(
        (provider) => provider.status === 'ready',
    )
    const defaultProvider =
        readyProviders.find(
            (provider) => provider.id === config?.settings.defaultProviderConnectionId,
        ) ?? (readyProviders.length === 1 ? readyProviders[0] : null)
    const managedModelReady = config?.onboarding.managedOpenRouterAvailable === true
    const modelAvailable = managedModelReady || readyProviders.length > 0

    const finishDefaults = defaultProvider
        ? {
              defaultProviderConnectionId: defaultProvider.id,
              defaultModel: defaultProvider.defaultModel,
          }
        : {
              defaultProviderConnectionId: null,
              defaultModel: null,
          }

    const byokEntry =
        config?.providerCatalog.find((entry) => entry.provider === 'openrouter') ?? null

    const saveKey = useMutation({
        mutationFn: async () => {
            if (!byokEntry) {
                throw new Error('This build cannot accept a model key here.')
            }
            const key = apiKey.trim()
            if (!key) throw new Error('Paste your model key to continue.')
            return saveProviderConnectionServer({
                data: {
                    label: byokEntry.label,
                    provider: byokEntry.provider,
                    defaultModel: byokEntry.model,
                    apiKey: key,
                    makeDefault: true,
                },
            })
        },
        onSuccess: async () => {
            setApiKey('')
            setKeyError(null)
            await queryClient.invalidateQueries({ queryKey: roomQueryKey.operatorConfig })
        },
        onError: (error: unknown) => {
            setKeyError(safeOnboardingNotice(error, 'Could not save your model key.'))
        },
    })

    const startRoom = useMutation({
        mutationFn: async (values: CreateRoomFormValues) => {
            const room = await createRoomServer({
                data: {
                    displayName: values.displayName,
                    instructions: values.instructions || undefined,
                    roomMode: values.roomMode,
                    startImmediately: true,
                },
            })
            await queryClient.invalidateQueries({ queryKey: roomQueryKey.roomsList })
            await finishOnboardingDefaults()
            let sessionKey: string
            try {
                const thread = await createThreadServer({ data: { roomId: room.id } })
                sessionKey = thread.key
            } catch (error) {
                return {
                    ok: false as const,
                    roomId: room.id,
                    reason: safeOnboardingNotice(error, sessionFallbackNotice),
                }
            }
            return { ok: true as const, roomId: room.id, sessionKey }
        },
        onSuccess: (result) => {
            if (result.ok) {
                markChatSelection(result.roomId, result.sessionKey)
                void navigate({
                    to: '/rooms/$roomId/sessions/$sessionKey',
                    params: { roomId: result.roomId, sessionKey: result.sessionKey },
                })
                return
            }
            setCreatedRoomId(result.roomId)
            setBlockedReason(result.reason)
        },
        onError: (error: unknown) => {
            setRoomError(safeOnboardingNotice(error, 'Could not create the room.'))
        },
    })

    const retrySession = useMutation({
        mutationFn: async () => {
            if (!createdRoomId) throw new Error('No room is waiting to start.')
            const thread = await createThreadServer({ data: { roomId: createdRoomId } })
            await finishOnboardingDefaults()
            return { roomId: createdRoomId, sessionKey: thread.key }
        },
        onSuccess: (target) => {
            markChatSelection(target.roomId, target.sessionKey)
            void navigate({
                to: '/rooms/$roomId/sessions/$sessionKey',
                params: { roomId: target.roomId, sessionKey: target.sessionKey },
            })
        },
        onError: (error: unknown) => {
            setBlockedReason(safeOnboardingNotice(error, sessionFallbackNotice))
        },
    })

    async function finishOnboardingDefaults(): Promise<void> {
        try {
            await updateAppDefaultsServer({
                data: {
                    defaultProviderConnectionId: finishDefaults.defaultProviderConnectionId,
                    defaultModel: finishDefaults.defaultModel,
                    onboardingCompleted: true,
                },
            })
            await queryClient.invalidateQueries({ queryKey: roomQueryKey.operatorConfig })
        } catch (error) {
            console.warn(
                'Onboarding session started but defaults finalization failed',
                error instanceof Error ? error.message : error,
            )
        }
    }

    if (configQuery.isLoading) {
        return (
            <OnboardingShell>
                <Section title="Getting things ready">
                    <div className="space-y-3">
                        <Skeleton className="h-4 w-2/3" />
                        <Skeleton className="h-9 w-full" />
                        <Skeleton className="h-24 w-full" />
                        <Skeleton className="h-9 w-40" />
                    </div>
                </Section>
            </OnboardingShell>
        )
    }

    if (configQuery.isError || !config) {
        return (
            <OnboardingShell>
                <AttentionBanner
                    tone="danger"
                    title="We could not load setup"
                    description="Something went wrong while preparing your workspace."
                    action={
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => configQuery.refetch()}
                            disabled={configQuery.isFetching}
                        >
                            {configQuery.isFetching ? 'Retrying...' : 'Retry'}
                        </Button>
                    }
                />
            </OnboardingShell>
        )
    }

    if (createdRoomId && blockedReason) {
        return (
            <OnboardingShell>
                <Section
                    title="Almost there"
                    description="Your room was created but still needs setup before it can start working."
                >
                    <div className="space-y-4">
                        <AttentionBanner
                            tone="attention"
                            title="Setup required"
                            description={blockedReason}
                        />
                        <div className="flex flex-wrap items-center gap-3">
                            <Button
                                type="button"
                                onClick={() => retrySession.mutate()}
                                disabled={retrySession.isPending}
                            >
                                {retrySession.isPending ? 'Starting...' : 'Try again'}
                                <ArrowRightIcon />
                            </Button>
                            <Button asChild variant="ghost" size="sm">
                                <Link to="/settings" hash="advanced">
                                    Open advanced setup
                                </Link>
                            </Button>
                        </div>
                    </div>
                </Section>
            </OnboardingShell>
        )
    }

    if (!modelAvailable) {
        return (
            <OnboardingShell>
                <Section
                    title="Connect your model"
                    description="Agent Room needs a model key to think, chat, and run scheduled tasks. Your key stays on this server."
                >
                    <form
                        className="space-y-4"
                        onSubmit={(event) => {
                            event.preventDefault()
                            saveKey.mutate()
                        }}
                        noValidate
                    >
                        {keyError ? (
                            <Alert variant="destructive">
                                <AlertDescription>{keyError}</AlertDescription>
                            </Alert>
                        ) : null}
                        <CredentialField
                            label="Model key"
                            id="onboarding-model-key"
                            hasCredential={false}
                            replace
                            onToggleReplace={() => {}}
                            value={apiKey}
                            onChange={setApiKey}
                            placeholder="Paste your model key"
                        />
                        <Button
                            type="submit"
                            disabled={saveKey.isPending || apiKey.trim().length === 0}
                        >
                            {saveKey.isPending ? 'Saving...' : 'Save and continue'}
                            <ArrowRightIcon />
                        </Button>
                    </form>
                </Section>
            </OnboardingShell>
        )
    }

    return (
        <OnboardingShell>
            <Section
                title="Name your first room"
                description="A room is a persistent space where your AI coworker works on a topic, with its own files, memory, and history."
            >
                <div className="space-y-4">
                    {managedModelReady ? (
                        <p className="text-sm text-muted-foreground">
                            Your model and web access are included. Just name your room and start
                            working.
                        </p>
                    ) : null}
                    <CreateRoomForm
                        variant="embedded"
                        onSubmit={(values) => startRoom.mutate(values)}
                        pending={startRoom.isPending}
                        error={roomError}
                        submitLabel="Create room and start"
                        submittingLabel="Starting your room..."
                    />
                </div>
            </Section>
        </OnboardingShell>
    )
}
