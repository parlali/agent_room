import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { imageModelOptionsForProvider } from '#/domain/model-options'
import { roomQueryKey } from '#/lib/room-query-keys'
import {
    cancelCodexDeviceAuthSessionServer,
    deleteMcpConnectionServer,
    deleteProviderConnectionServer,
    disconnectGitHubUserAuthorizationServer,
    getOperatorConfigServer,
    getCodexDeviceAuthSessionServer,
    refreshGitHubInstallationsServer,
    resetGitHubAppConfigurationServer,
    saveMcpConnectionServer,
    saveProviderConnectionServer,
    startCodexDeviceAuthSessionServer,
    startGitHubAppManifestServer,
    startGitHubUserAuthorizationServer,
    updateAppCapabilitySettingsServer,
    updateAppDefaultsServer,
} from '../-operator-config-server'
import type {
    McpConnectionSummary,
    OperatorConfigSnapshot,
    ProviderConnectionSummary,
} from '#/server/configuration/operator-configuration'
import {
    EditSheet,
    EMPTY_MCP_FORM,
    EMPTY_PROVIDER_FORM,
    McpForm,
    type McpFormState,
    ProviderForm,
    type ProviderFormState,
    capabilityDefaultsEqual,
    type DeleteConnectionTarget,
    resolveProviderFormProtocol,
} from './-forms'
import {
    AppDefaultsSection,
    CapabilitiesSection,
    DeleteConnectionDialog,
    GitHubAppSection,
    McpConnectionsSection,
    ProviderConnectionsSection,
    SetupBanner,
    type AppCapabilityDefaults,
    type AppImageProvider,
    type AppSearchDraft,
} from './-sections'
import { CodexAppServerSection } from './-codex-app-server-section'

export interface GitHubReturn {
    installationId: string
    setupAction: string
    githubState: string
}

function toSearchDraft(search: OperatorConfigSnapshot['settings']['search']): AppSearchDraft {
    return {
        enabled: search.enabled,
        backendUrl: search.backendUrl,
        defaultResultCount: search.defaultResultCount,
        timeoutMs: search.timeoutMs,
        maxSearchesPerRun: search.maxSearchesPerRun,
        brave: {
            enabled: search.brave.enabled,
            country: search.brave.country ?? '',
            searchLang: search.brave.searchLang ?? '',
            safeSearch: search.brave.safeSearch,
            timeoutMs: search.brave.timeoutMs,
            resultCount: search.brave.resultCount,
            apiKey: '',
            hasCredential: search.brave.hasCredential,
            replaceApiKey: !search.brave.hasCredential,
        },
        browserbase: {
            enabled: search.browserbase.enabled,
            timeoutMs: search.browserbase.timeoutMs,
            resultCount: search.browserbase.resultCount,
            apiKey: '',
            hasCredential: search.browserbase.hasCredential,
            replaceApiKey: !search.browserbase.hasCredential,
        },
    }
}

function searchDraftDirty(
    draft: AppSearchDraft,
    saved: OperatorConfigSnapshot['settings']['search'],
): boolean {
    return (
        draft.enabled !== saved.enabled ||
        draft.backendUrl.trim() !== saved.backendUrl ||
        draft.defaultResultCount !== saved.defaultResultCount ||
        draft.timeoutMs !== saved.timeoutMs ||
        draft.maxSearchesPerRun !== saved.maxSearchesPerRun ||
        draft.brave.enabled !== saved.brave.enabled ||
        draft.brave.country.trim() !== (saved.brave.country ?? '') ||
        draft.brave.searchLang.trim() !== (saved.brave.searchLang ?? '') ||
        draft.brave.safeSearch !== saved.brave.safeSearch ||
        draft.brave.timeoutMs !== saved.brave.timeoutMs ||
        draft.brave.resultCount !== saved.brave.resultCount ||
        (draft.brave.enabled &&
            draft.brave.replaceApiKey &&
            draft.brave.apiKey.trim().length > 0) ||
        draft.browserbase.enabled !== saved.browserbase.enabled ||
        draft.browserbase.timeoutMs !== saved.browserbase.timeoutMs ||
        draft.browserbase.resultCount !== saved.browserbase.resultCount ||
        (draft.browserbase.enabled &&
            draft.browserbase.replaceApiKey &&
            draft.browserbase.apiKey.trim().length > 0)
    )
}

function GroupHeading({ title, description }: { title: string; description: string }) {
    return (
        <div className="space-y-0.5">
            <h3 className="text-sm font-semibold tracking-tight text-foreground">{title}</h3>
            <p className="text-xs text-muted-foreground">{description}</p>
        </div>
    )
}

function Group({
    title,
    description,
    children,
}: {
    title: string
    description: string
    children: ReactNode
}) {
    return (
        <section className="space-y-3">
            <GroupHeading title={title} description={description} />
            {children}
        </section>
    )
}

export function ProvidersIntegrationsSection({ githubReturn }: { githubReturn: GitHubReturn }) {
    const queryClient = useQueryClient()

    const configQuery = useQuery<OperatorConfigSnapshot>({
        queryKey: roomQueryKey.operatorConfig,
        queryFn: () => getOperatorConfigServer(),
    })
    const codexAuthQuery = useQuery({
        queryKey: roomQueryKey.codexDeviceAuthSession,
        queryFn: () => getCodexDeviceAuthSessionServer(),
        refetchInterval: (query) => {
            const status = query.state.data?.status
            return status === 'starting' || status === 'awaiting_verification' ? 1000 : false
        },
    })
    const config = configQuery.data
    const providers = config?.providers ?? []
    const mcpConnections = config?.mcpConnections ?? []
    const onboardingCompleted = config?.onboarding.completed ?? null
    const hostedCodexCredentialMode =
        config?.codexAuth.requiresStoredCredential ??
        codexAuthQuery.data?.auth.requiresStoredCredential ??
        false

    const [providerSheetOpen, setProviderSheetOpen] = useState(false)
    const [providerForm, setProviderForm] = useState<ProviderFormState>(EMPTY_PROVIDER_FORM)
    const [mcpSheetOpen, setMcpSheetOpen] = useState(false)
    const [mcpForm, setMcpForm] = useState<McpFormState>(EMPTY_MCP_FORM)
    const [deleteTarget, setDeleteTarget] = useState<DeleteConnectionTarget | null>(null)
    const [defaultProviderId, setDefaultProviderId] = useState<string | null>(null)
    const [capabilityDefaults, setCapabilityDefaults] = useState<AppCapabilityDefaults | null>(null)
    const [appImageProvider, setAppImageProvider] = useState<AppImageProvider>('none')
    const [appImageModel, setAppImageModel] = useState('')
    const [appImageApiKey, setAppImageApiKey] = useState('')
    const [appImageReplaceApiKey, setAppImageReplaceApiKey] = useState(true)
    const [appImageHasCredential, setAppImageHasCredential] = useState(false)
    const [appSearch, setAppSearch] = useState<AppSearchDraft | null>(null)
    const [githubPublicOrigin, setGithubPublicOrigin] = useState('')
    const [githubTargetOwner, setGithubTargetOwner] = useState('')
    const autoGitHubRefreshKeyRef = useRef<string | null>(null)

    useEffect(() => {
        if (!config) return
        const imageProvider = config.settings.image.provider ?? 'none'
        const imageOptions =
            imageProvider === 'none'
                ? []
                : imageModelOptionsForProvider(imageProvider, config.settings.image.model)
        setDefaultProviderId(config.settings.defaultProviderConnectionId)
        setCapabilityDefaults({ ...config.settings.capabilityDefaults })
        setAppImageProvider(imageProvider)
        setAppImageModel(config.settings.image.model ?? imageOptions[0]?.value ?? '')
        setAppImageApiKey('')
        setAppImageReplaceApiKey(!config.settings.image.hasCredential)
        setAppImageHasCredential(config.settings.image.hasCredential)
        setAppSearch(toSearchDraft(config.settings.search))
        if (!githubPublicOrigin && typeof window !== 'undefined') {
            setGithubPublicOrigin(window.location.origin)
        }
    }, [config, githubPublicOrigin])

    const updateProviderForm = (patch: Partial<ProviderFormState>) =>
        setProviderForm((c) => ({ ...c, ...patch }))
    const updateMcpForm = (patch: Partial<McpFormState>) => setMcpForm((c) => ({ ...c, ...patch }))
    const invalidateConfig = async () => {
        await queryClient.invalidateQueries({ queryKey: roomQueryKey.operatorConfig, exact: false })
        await queryClient.invalidateQueries({ queryKey: ['rooms'], exact: false })
    }

    const openNewProvider = () => {
        setProviderForm(EMPTY_PROVIDER_FORM)
        setProviderSheetOpen(true)
    }
    const openEditProvider = (entry: ProviderConnectionSummary) => {
        setProviderForm({
            id: entry.id,
            label: entry.label,
            provider: entry.provider,
            defaultModel: entry.defaultModel,
            fallbackModels: entry.fallbackModels.join(', '),
            apiKey: '',
            replaceApiKey: !entry.hasCredential,
            hasCredential: entry.hasCredential,
        })
        setProviderSheetOpen(true)
    }
    const openNewMcp = () => {
        setMcpForm(EMPTY_MCP_FORM)
        setMcpSheetOpen(true)
    }
    const openEditMcp = (entry: McpConnectionSummary) => {
        setMcpForm({
            id: entry.id,
            name: entry.name,
            serverKey: entry.serverKey,
            transport: entry.transport,
            command: entry.command ?? '',
            argsText: entry.args.join(' '),
            url: entry.url ?? '',
            headersText: Object.keys(entry.headers).length
                ? JSON.stringify(entry.headers, null, 2)
                : '',
            authMode: entry.authMode,
            bearerToken: '',
            replaceBearerToken: entry.authMode === 'bearer' ? !entry.hasCredential : true,
            hasCredential: entry.hasCredential,
            allowedToolsText: entry.allowedTools.join(', '),
        })
        setMcpSheetOpen(true)
    }

    const saveProviderMutation = useMutation({
        mutationFn: async () => {
            const fallbackModels = providerForm.fallbackModels
                .split(',')
                .map((entry) => entry.trim())
                .filter((entry) => entry.length > 0)
            const protocol = resolveProviderFormProtocol(
                providerForm,
                config?.providerCatalog ?? [],
            )
            const usesOAuth =
                protocol.authMode === 'oauth' || protocol.api === 'openai-codex-responses'
            const allowOAuthCredential =
                hostedCodexCredentialMode && protocol.api === 'openai-codex-responses'
            return saveProviderConnectionServer({
                data: {
                    id: providerForm.id,
                    label: providerForm.label.trim(),
                    provider: providerForm.provider.trim(),
                    defaultModel: providerForm.defaultModel.trim(),
                    fallbackModels,
                    apiKey:
                        (!usesOAuth || allowOAuthCredential) &&
                        providerForm.replaceApiKey &&
                        providerForm.apiKey.trim()
                            ? providerForm.apiKey.trim()
                            : undefined,
                },
            })
        },
        onSuccess: async (saved) => {
            toast.success(`${saved.label} saved`)
            setProviderSheetOpen(false)
            await invalidateConfig()
        },
        onError: (error) =>
            toast.error(error instanceof Error ? error.message : 'Provider save failed'),
    })

    const saveMcpMutation = useMutation({
        mutationFn: async () =>
            saveMcpConnectionServer({
                data: {
                    id: mcpForm.id,
                    name: mcpForm.name.trim(),
                    serverKey: mcpForm.serverKey.trim(),
                    transport: mcpForm.transport,
                    command: mcpForm.command.trim() ? mcpForm.command.trim() : null,
                    argsText: mcpForm.argsText,
                    url: mcpForm.url.trim() ? mcpForm.url.trim() : null,
                    headersText: mcpForm.headersText,
                    authMode: mcpForm.authMode,
                    bearerToken:
                        mcpForm.authMode === 'bearer' &&
                        mcpForm.replaceBearerToken &&
                        mcpForm.bearerToken
                            ? mcpForm.bearerToken
                            : undefined,
                    allowedToolsText: mcpForm.allowedToolsText,
                },
            }),
        onSuccess: async (saved) => {
            toast.success(`${saved.name} saved`)
            setMcpSheetOpen(false)
            await invalidateConfig()
        },
        onError: (error) =>
            toast.error(error instanceof Error ? error.message : 'Tool save failed'),
    })

    const startCodexAuthMutation = useMutation({
        mutationFn: async () => startCodexDeviceAuthSessionServer(),
        onSuccess: async () => {
            await queryClient.invalidateQueries({
                queryKey: roomQueryKey.codexDeviceAuthSession,
                exact: false,
            })
            await invalidateConfig()
        },
        onError: (error) =>
            toast.error(error instanceof Error ? error.message : 'Codex authorization failed'),
    })

    const cancelCodexAuthMutation = useMutation({
        mutationFn: async () => cancelCodexDeviceAuthSessionServer(),
        onSuccess: async () => {
            await queryClient.invalidateQueries({
                queryKey: roomQueryKey.codexDeviceAuthSession,
                exact: false,
            })
        },
        onError: (error) =>
            toast.error(error instanceof Error ? error.message : 'Codex cancellation failed'),
    })

    const deleteProviderMutation = useMutation({
        mutationFn: async (id: string) =>
            deleteProviderConnectionServer({
                data: {
                    id,
                },
            }),
        onSuccess: async () => {
            toast.success('Provider deleted')
            setDeleteTarget(null)
            await invalidateConfig()
        },
        onError: (error) =>
            toast.error(error instanceof Error ? error.message : 'Provider delete failed'),
    })

    const deleteMcpMutation = useMutation({
        mutationFn: async (id: string) =>
            deleteMcpConnectionServer({
                data: {
                    id,
                },
            }),
        onSuccess: async () => {
            toast.success('Connected tool deleted')
            setDeleteTarget(null)
            await invalidateConfig()
        },
        onError: (error) =>
            toast.error(error instanceof Error ? error.message : 'Tool delete failed'),
    })

    const updateDefaultsMutation = useMutation({
        mutationFn: async () =>
            updateAppDefaultsServer({
                data: {
                    defaultProviderConnectionId: defaultProviderId,
                    defaultModel: null,
                    onboardingCompleted,
                },
            }),
        onSuccess: async () => {
            toast.success('App defaults saved')
            await queryClient.invalidateQueries({
                queryKey: roomQueryKey.operatorConfig,
                exact: false,
            })
        },
        onError: (error) =>
            toast.error(error instanceof Error ? error.message : 'Defaults save failed'),
    })

    const updateCapabilitiesMutation = useMutation({
        mutationFn: async () => {
            if (!capabilityDefaults) throw new Error('Capability defaults are not loaded')
            if (!appSearch) throw new Error('Search defaults are not loaded')
            return updateAppCapabilitySettingsServer({
                data: {
                    capabilityDefaults,
                    search: {
                        enabled: appSearch.enabled,
                        backendUrl: appSearch.backendUrl.trim(),
                        defaultResultCount: appSearch.defaultResultCount,
                        timeoutMs: appSearch.timeoutMs,
                        maxSearchesPerRun: appSearch.maxSearchesPerRun,
                        brave: {
                            enabled: appSearch.brave.enabled,
                            country: appSearch.brave.country.trim() || null,
                            searchLang: appSearch.brave.searchLang.trim() || null,
                            safeSearch: appSearch.brave.safeSearch,
                            timeoutMs: appSearch.brave.timeoutMs,
                            resultCount: appSearch.brave.resultCount,
                            apiKey:
                                appSearch.brave.enabled &&
                                appSearch.brave.replaceApiKey &&
                                appSearch.brave.apiKey.trim()
                                    ? appSearch.brave.apiKey
                                    : undefined,
                        },
                        browserbase: {
                            enabled: appSearch.browserbase.enabled,
                            timeoutMs: appSearch.browserbase.timeoutMs,
                            resultCount: appSearch.browserbase.resultCount,
                            apiKey:
                                appSearch.browserbase.enabled &&
                                appSearch.browserbase.replaceApiKey &&
                                appSearch.browserbase.apiKey.trim()
                                    ? appSearch.browserbase.apiKey
                                    : undefined,
                        },
                    },
                    image: {
                        provider: appImageProvider === 'none' ? null : appImageProvider,
                        model: appImageModel.trim() ? appImageModel.trim() : null,
                        apiKey:
                            appImageProvider !== 'none' &&
                            appImageReplaceApiKey &&
                            appImageApiKey.trim()
                                ? appImageApiKey
                                : undefined,
                    },
                },
            })
        },
        onSuccess: async () => {
            toast.success('Capabilities saved')
            await invalidateConfig()
        },
        onError: (error) =>
            toast.error(error instanceof Error ? error.message : 'Capability save failed'),
    })

    const startGitHubManifestMutation = useMutation({
        mutationFn: async () =>
            startGitHubAppManifestServer({
                data: {
                    publicOrigin:
                        githubPublicOrigin.trim() ||
                        (typeof window === 'undefined' ? '' : window.location.origin),
                    targetOwner: githubTargetOwner.trim() || null,
                },
            }),
        onSuccess: (flow) => {
            const form = document.createElement('form')
            form.method = 'post'
            form.action = flow.postUrl
            const input = document.createElement('input')
            input.type = 'hidden'
            input.name = 'manifest'
            input.value = flow.manifest
            form.appendChild(input)
            document.body.appendChild(form)
            form.submit()
        },
        onError: (error) =>
            toast.error(error instanceof Error ? error.message : 'GitHub App setup failed'),
    })

    const startGitHubUserAuthorizationMutation = useMutation({
        mutationFn: async () =>
            startGitHubUserAuthorizationServer({
                data: {
                    publicOrigin:
                        githubPublicOrigin.trim() ||
                        (typeof window === 'undefined' ? '' : window.location.origin),
                },
            }),
        onSuccess: (flow) => {
            window.location.assign(flow.authorizeUrl)
        },
        onError: (error) =>
            toast.error(
                error instanceof Error ? error.message : 'GitHub account connection failed',
            ),
    })

    const refreshGitHubMutation = useMutation({
        mutationFn: async (_input?: { silent?: boolean }) => refreshGitHubInstallationsServer(),
        onSuccess: async (_result, input) => {
            if (!input?.silent) {
                toast.success('GitHub installations refreshed')
            }
            await invalidateConfig()
        },
        onError: (error) =>
            toast.error(
                error instanceof Error ? error.message : 'GitHub installation refresh failed',
            ),
    })

    const disconnectGitHubUserMutation = useMutation({
        mutationFn: async () => disconnectGitHubUserAuthorizationServer(),
        onSuccess: async () => {
            toast.success('GitHub account disconnected')
            await invalidateConfig()
        },
        onError: (error) =>
            toast.error(
                error instanceof Error ? error.message : 'GitHub account disconnect failed',
            ),
    })

    const resetGitHubMutation = useMutation({
        mutationFn: async () => resetGitHubAppConfigurationServer(),
        onSuccess: async () => {
            toast.success('GitHub App configuration removed')
            await invalidateConfig()
        },
        onError: (error) =>
            toast.error(error instanceof Error ? error.message : 'GitHub App reset failed'),
    })
    const refreshGitHubMutate = refreshGitHubMutation.mutate
    const refreshGitHubPending = refreshGitHubMutation.isPending

    useEffect(() => {
        if (!config?.github.app.configured) return
        const redirectKey =
            githubReturn.installationId || githubReturn.setupAction || githubReturn.githubState
                ? `redirect:${githubReturn.installationId}:${githubReturn.setupAction}:${githubReturn.githubState}`
                : 'settings-load'
        if (autoGitHubRefreshKeyRef.current === redirectKey || refreshGitHubPending) return
        autoGitHubRefreshKeyRef.current = redirectKey
        refreshGitHubMutate({
            silent: redirectKey === 'settings-load',
        })
    }, [
        config?.github.app.configured,
        refreshGitHubMutate,
        refreshGitHubPending,
        githubReturn.githubState,
        githubReturn.installationId,
        githubReturn.setupAction,
    ])

    useEffect(() => {
        if (codexAuthQuery.data?.status !== 'complete') return
        void invalidateConfig()
    }, [codexAuthQuery.data?.status])

    const onSubmitProvider = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (!providerForm.label.trim()) return toast.error('Connection name is required')
        if (!providerForm.provider.trim()) return toast.error('Provider key is required')
        if (!providerForm.defaultModel.trim()) return toast.error('Default model is required')
        saveProviderMutation.mutate()
    }
    const onSubmitMcp = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (!mcpForm.name.trim()) return toast.error('Tool name is required')
        if (!mcpForm.serverKey.trim()) return toast.error('Tool key is required')
        if (mcpForm.transport === 'stdio' && !mcpForm.command.trim())
            return toast.error('Local command is required for stdio')
        if (mcpForm.transport !== 'stdio' && !mcpForm.url.trim())
            return toast.error('Endpoint URL is required for HTTP transports')
        saveMcpMutation.mutate()
    }

    const onDeleteProvider = (entry: ProviderConnectionSummary) => {
        setDeleteTarget({ kind: 'provider', entry })
    }

    const onDeleteMcp = (entry: McpConnectionSummary) => {
        setDeleteTarget({ kind: 'mcp', entry })
    }

    const onConfirmDeleteConnection = () => {
        if (!deleteTarget) return
        if (deleteTarget.kind === 'provider') {
            deleteProviderMutation.mutate(deleteTarget.entry.id)
        } else {
            deleteMcpMutation.mutate(deleteTarget.entry.id)
        }
    }

    const onSaveCapabilities = () => {
        if (!appSearch) {
            toast.error('Search defaults are not loaded')
            return
        }
        if (appSearch.enabled && !appSearch.backendUrl.trim()) {
            toast.error('Web search backend is not configured')
            return
        }
        if (appSearch.brave.enabled) {
            if (
                appSearch.brave.replaceApiKey &&
                !appSearch.brave.apiKey.trim() &&
                !appSearch.brave.hasCredential
            ) {
                toast.error('Brave Search API key is required')
                return
            }
            if (
                appSearch.brave.replaceApiKey &&
                appSearch.brave.hasCredential &&
                !appSearch.brave.apiKey.trim()
            ) {
                toast.error('Enter a new Brave Search API key or cancel replacement')
                return
            }
        }
        if (appSearch.browserbase.enabled) {
            if (
                appSearch.browserbase.replaceApiKey &&
                !appSearch.browserbase.apiKey.trim() &&
                !appSearch.browserbase.hasCredential
            ) {
                toast.error('Browserbase API key is required')
                return
            }
            if (
                appSearch.browserbase.replaceApiKey &&
                appSearch.browserbase.hasCredential &&
                !appSearch.browserbase.apiKey.trim()
            ) {
                toast.error('Enter a new Browserbase API key or cancel replacement')
                return
            }
        }
        if (appImageProvider !== 'none') {
            if (!appImageModel.trim()) {
                toast.error('Default image model is required')
                return
            }
            if (appImageReplaceApiKey && !appImageApiKey.trim() && !appImageHasCredential) {
                toast.error('Image API key is required')
                return
            }
            if (appImageReplaceApiKey && appImageHasCredential && !appImageApiKey.trim()) {
                toast.error('Enter a new image API key or cancel replacement')
                return
            }
        }
        updateCapabilitiesMutation.mutate()
    }

    const defaultsDirty = useMemo(() => {
        if (!config) return false
        return (
            (defaultProviderId ?? null) !== config.settings.defaultProviderConnectionId ||
            config.settings.defaultModel !== null
        )
    }, [config, defaultProviderId])
    const capabilitiesDirty = useMemo(() => {
        if (!config || !capabilityDefaults || !appSearch) return false
        return (
            !capabilityDefaultsEqual(capabilityDefaults, config.settings.capabilityDefaults) ||
            searchDraftDirty(appSearch, config.settings.search) ||
            (appImageProvider === 'none' ? null : appImageProvider) !==
                config.settings.image.provider ||
            appImageModel.trim() !== (config.settings.image.model ?? '') ||
            (appImageProvider !== 'none' &&
                appImageReplaceApiKey &&
                appImageApiKey.trim().length > 0)
        )
    }, [
        appImageApiKey,
        appImageModel,
        appImageProvider,
        appImageReplaceApiKey,
        appSearch,
        capabilityDefaults,
        config,
    ])
    const deleteTargetPending =
        deleteTarget?.kind === 'provider'
            ? deleteProviderMutation.isPending
            : deleteTarget?.kind === 'mcp'
              ? deleteMcpMutation.isPending
              : false
    const deleteTargetName =
        deleteTarget?.kind === 'provider'
            ? deleteTarget.entry.label
            : deleteTarget?.kind === 'mcp'
              ? deleteTarget.entry.name
              : ''
    const deleteTargetTitle =
        deleteTarget?.kind === 'provider' ? 'Delete this provider?' : 'Delete this connected tool?'
    const deleteTargetDescription =
        deleteTarget?.kind === 'provider'
            ? 'This removes the provider connection and its stored credential if present. Rooms using it must be changed first.'
            : 'This removes the connected tool and its stored credential if present. Rooms using it must be changed first.'
    const selectedDefaultProvider =
        providers.find((entry) => entry.id === defaultProviderId) ?? null

    return (
        <div className="flex flex-col gap-8">
            <SetupBanner onboardingCompleted={onboardingCompleted} />

            <Group
                title="AI models"
                description="The AI connections your rooms use and the default new rooms inherit."
            >
                <ProviderConnectionsSection
                    providers={providers}
                    defaultProviderId={config?.settings.defaultProviderConnectionId}
                    loading={configQuery.isLoading}
                    deletingProviderId={
                        deleteProviderMutation.isPending
                            ? deleteProviderMutation.variables
                            : undefined
                    }
                    onAdd={openNewProvider}
                    onEdit={openEditProvider}
                    onDelete={onDeleteProvider}
                />

                <CodexAppServerSection
                    config={config}
                    session={codexAuthQuery.data}
                    loading={codexAuthQuery.isLoading}
                    startPending={startCodexAuthMutation.isPending}
                    cancelPending={cancelCodexAuthMutation.isPending}
                    hostedCredentialMode={hostedCodexCredentialMode}
                    onStart={() => startCodexAuthMutation.mutate()}
                    onCancel={() => cancelCodexAuthMutation.mutate()}
                />

                <AppDefaultsSection
                    providers={providers}
                    defaultProviderId={defaultProviderId}
                    selectedDefaultProvider={selectedDefaultProvider}
                    defaultsDirty={defaultsDirty}
                    pending={updateDefaultsMutation.isPending}
                    onChangeDefaultProvider={setDefaultProviderId}
                    onSave={() => updateDefaultsMutation.mutate()}
                />
            </Group>

            <Group
                title="Connected tools"
                description="Tools any room can be granted access to."
            >
                <McpConnectionsSection
                    mcpConnections={mcpConnections}
                    loading={configQuery.isLoading}
                    deletingMcpId={
                        deleteMcpMutation.isPending ? deleteMcpMutation.variables : undefined
                    }
                    onAdd={openNewMcp}
                    onEdit={openEditMcp}
                    onDelete={onDeleteMcp}
                />
            </Group>

            <Group
                title="GitHub"
                description="Connect a GitHub account and install the room-scoped GitHub App."
            >
                <GitHubAppSection
                    config={config}
                    publicOrigin={githubPublicOrigin}
                    targetOwner={githubTargetOwner}
                    setupPending={startGitHubManifestMutation.isPending}
                    accountConnectPending={startGitHubUserAuthorizationMutation.isPending}
                    refreshPending={refreshGitHubMutation.isPending}
                    disconnectAccountPending={disconnectGitHubUserMutation.isPending}
                    resetPending={resetGitHubMutation.isPending}
                    onChangePublicOrigin={setGithubPublicOrigin}
                    onChangeTargetOwner={setGithubTargetOwner}
                    onStartSetup={() => startGitHubManifestMutation.mutate()}
                    onConnectAccount={() => startGitHubUserAuthorizationMutation.mutate()}
                    onRefresh={() => refreshGitHubMutation.mutate({})}
                    onDisconnectAccount={() => disconnectGitHubUserMutation.mutate()}
                    onReset={() => resetGitHubMutation.mutate()}
                />
            </Group>

            <Group
                title="Advanced runtime settings"
                description="Defaults new rooms inherit, web access backends, and image generation. Most workspaces never change these."
            >
                <CapabilitiesSection
                    config={config}
                    capabilityDefaults={capabilityDefaults}
                    appImageProvider={appImageProvider}
                    appImageModel={appImageModel}
                    appImageApiKey={appImageApiKey}
                    appImageHasCredential={appImageHasCredential}
                    appImageReplaceApiKey={appImageReplaceApiKey}
                    appSearch={appSearch}
                    savePending={updateCapabilitiesMutation.isPending}
                    capabilitiesDirty={capabilitiesDirty}
                    setCapabilityDefaults={setCapabilityDefaults}
                    setAppImageProvider={setAppImageProvider}
                    setAppImageModel={setAppImageModel}
                    setAppImageApiKey={setAppImageApiKey}
                    setAppImageHasCredential={setAppImageHasCredential}
                    setAppImageReplaceApiKey={setAppImageReplaceApiKey}
                    setAppSearch={setAppSearch}
                    onSaveCapabilities={onSaveCapabilities}
                />
            </Group>

            <DeleteConnectionDialog
                target={deleteTarget}
                pending={deleteTargetPending}
                targetName={deleteTargetName}
                title={deleteTargetTitle}
                description={deleteTargetDescription}
                onCancel={() => setDeleteTarget(null)}
                onConfirm={onConfirmDeleteConnection}
            />

            <EditSheet
                open={providerSheetOpen}
                onOpenChange={setProviderSheetOpen}
                title={providerForm.id ? 'Edit provider' : 'Add provider'}
                description="Connection details persist across rooms. Credentials are write-only."
            >
                <ProviderForm
                    form={providerForm}
                    setForm={updateProviderForm}
                    onSubmit={onSubmitProvider}
                    onCancel={() => setProviderSheetOpen(false)}
                    pending={saveProviderMutation.isPending}
                    providerCatalog={config?.providerCatalog ?? []}
                    allowOAuthCredential={
                        hostedCodexCredentialMode &&
                        resolveProviderFormProtocol(providerForm, config?.providerCatalog ?? [])
                            .api === 'openai-codex-responses'
                    }
                />
            </EditSheet>

            <EditSheet
                open={mcpSheetOpen}
                onOpenChange={setMcpSheetOpen}
                title={mcpForm.id ? 'Edit tool' : 'Add tool'}
                description="Tools exposed to rooms. Bearer tokens are write-only."
            >
                <McpForm
                    form={mcpForm}
                    setForm={updateMcpForm}
                    onSubmit={onSubmitMcp}
                    onCancel={() => setMcpSheetOpen(false)}
                    pending={saveMcpMutation.isPending}
                />
            </EditSheet>
        </div>
    )
}
