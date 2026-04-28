import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import {
    Cable,
    CheckCircle2,
    KeyRound,
    Palette,
    Plug,
    RotateCw,
    Settings,
    ShieldCheck,
    UserRound,
    Wrench,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
    AuthenticatedAppShell,
    formatRelativeTime,
    statusTone,
    useOperatorConfig,
} from './-app-layout'
import { requireRouteUser } from './-route-auth'
import {
    saveMcpConnectionServer,
    saveProviderConnectionServer,
    updateAppDefaultsServer,
} from './-operator-config-server'
import type { ProviderApi } from './-room-create-form'
import type {
    McpConnectionSummary,
    ProviderConnectionSummary,
} from '#/server/configuration/operator-configuration'

export const Route = createFileRoute('/settings')({
    beforeLoad: requireRouteUser,
    component: SettingsPage,
})

function connectionTypeLabel(value: McpConnectionSummary['transport']) {
    if (value === 'stdio') {
        return 'Local command'
    }
    if (value === 'streamable_http') {
        return 'Streamable HTTP'
    }
    return 'HTTP endpoint'
}

function SettingsPage() {
    const queryClient = useQueryClient()
    const configQuery = useOperatorConfig()
    const config = configQuery.data
    const providers = config?.providers ?? []
    const mcpConnections = config?.mcpConnections ?? []
    const catalog = config?.providerCatalog ?? []

    const [providerId, setProviderId] = useState<string | undefined>(undefined)
    const [providerLabel, setProviderLabel] = useState('')
    const [provider, setProvider] = useState('openrouter')
    const [providerApi, setProviderApi] = useState<ProviderApi>('openai-completions')
    const [providerBaseUrl, setProviderBaseUrl] = useState('')
    const [providerModel, setProviderModel] = useState('openrouter/auto')
    const [fallbackModels, setFallbackModels] = useState('')
    const [providerApiKey, setProviderApiKey] = useState('')
    const [makeDefault, setMakeDefault] = useState(true)
    const [providerNotice, setProviderNotice] = useState<string | null>(null)

    const [mcpId, setMcpId] = useState<string | undefined>(undefined)
    const [mcpName, setMcpName] = useState('')
    const [mcpServerKey, setMcpServerKey] = useState('')
    const [mcpTransport, setMcpTransport] = useState<'stdio' | 'http' | 'streamable_http'>('stdio')
    const [mcpCommand, setMcpCommand] = useState('')
    const [mcpArgs, setMcpArgs] = useState('')
    const [mcpUrl, setMcpUrl] = useState('')
    const [mcpHeaders, setMcpHeaders] = useState('')
    const [mcpAuthMode, setMcpAuthMode] = useState<'none' | 'bearer'>('none')
    const [mcpBearerToken, setMcpBearerToken] = useState('')
    const [mcpAllowedTools, setMcpAllowedTools] = useState('')
    const [mcpNotice, setMcpNotice] = useState<string | null>(null)

    const [defaultProviderId, setDefaultProviderId] = useState<string | null>(null)
    const [defaultModel, setDefaultModel] = useState('')

    useEffect(() => {
        if (!config) {
            return
        }
        setDefaultProviderId(config.settings.defaultProviderConnectionId)
        setDefaultModel(config.settings.defaultModel ?? '')
    }, [config])

    const selectedCatalogEntry = useMemo(
        () => catalog.find((entry) => entry.provider === provider),
        [catalog, provider],
    )
    const providerUsesOAuth =
        provider === 'openai-codex' || providerApi === 'openai-codex-responses'

    const saveProviderMutation = useMutation({
        mutationFn: async () =>
            saveProviderConnectionServer({
                data: {
                    id: providerId,
                    label: providerLabel,
                    provider,
                    api: providerApi,
                    authMode: providerUsesOAuth ? 'oauth' : 'api_key',
                    baseUrl: providerBaseUrl || null,
                    defaultModel: providerModel,
                    fallbackModels: fallbackModels
                        .split(',')
                        .map((entry) => entry.trim())
                        .filter((entry) => entry.length > 0),
                    apiKey: providerApiKey,
                    makeDefault,
                },
            }),
        onSuccess: async (saved) => {
            setProviderNotice(`${saved.label} saved`)
            setProviderId(undefined)
            setProviderLabel('')
            setProviderApiKey('')
            await queryClient.invalidateQueries({
                queryKey: ['operator-config'],
                exact: false,
            })
            await queryClient.invalidateQueries({
                queryKey: ['room-config'],
                exact: false,
            })
        },
        onError: (error) => {
            setProviderNotice(error instanceof Error ? error.message : 'Provider save failed')
        },
    })

    const saveMcpMutation = useMutation({
        mutationFn: async () =>
            saveMcpConnectionServer({
                data: {
                    id: mcpId,
                    name: mcpName,
                    serverKey: mcpServerKey,
                    transport: mcpTransport,
                    command: mcpCommand || null,
                    argsText: mcpArgs,
                    url: mcpUrl || null,
                    headersText: mcpHeaders,
                    authMode: mcpAuthMode,
                    bearerToken: mcpBearerToken,
                    allowedToolsText: mcpAllowedTools,
                },
            }),
        onSuccess: async (saved) => {
            setMcpNotice(`${saved.name} saved`)
            setMcpId(undefined)
            setMcpName('')
            setMcpServerKey('')
            setMcpCommand('')
            setMcpArgs('')
            setMcpUrl('')
            setMcpHeaders('')
            setMcpBearerToken('')
            setMcpAllowedTools('')
            await queryClient.invalidateQueries({
                queryKey: ['operator-config'],
                exact: false,
            })
            await queryClient.invalidateQueries({
                queryKey: ['room-config'],
                exact: false,
            })
        },
        onError: (error) => {
            setMcpNotice(error instanceof Error ? error.message : 'Tool save failed')
        },
    })

    const updateDefaultsMutation = useMutation({
        mutationFn: async () =>
            updateAppDefaultsServer({
                data: {
                    defaultProviderConnectionId: defaultProviderId,
                    defaultModel: defaultModel || null,
                    onboardingCompleted: true,
                },
            }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({
                queryKey: ['operator-config'],
                exact: false,
            })
        },
    })

    const editProvider = (entry: ProviderConnectionSummary) => {
        setProviderId(entry.id)
        setProviderLabel(entry.label)
        setProvider(entry.provider)
        setProviderApi(entry.api)
        setProviderBaseUrl(entry.baseUrl ?? '')
        setProviderModel(entry.defaultModel)
        setFallbackModels(entry.fallbackModels.join(', '))
        setProviderApiKey('')
        setMakeDefault(config?.settings.defaultProviderConnectionId === entry.id)
    }

    const editMcp = (entry: McpConnectionSummary) => {
        setMcpId(entry.id)
        setMcpName(entry.name)
        setMcpServerKey(entry.serverKey)
        setMcpTransport(entry.transport)
        setMcpCommand(entry.command ?? '')
        setMcpArgs(entry.args.join(' '))
        setMcpUrl(entry.url ?? '')
        setMcpHeaders(JSON.stringify(entry.headers, null, 4))
        setMcpAuthMode(entry.authMode)
        setMcpBearerToken('')
        setMcpAllowedTools(entry.allowedTools.join(', '))
    }

    const onProviderPreset = (nextProvider: string) => {
        const next = catalog.find((entry) => entry.provider === nextProvider)
        setProvider(nextProvider)
        if (next) {
            setProviderApi(next.api)
            setProviderModel(next.model)
            if (!providerLabel || providerLabel === selectedCatalogEntry?.label) {
                setProviderLabel(next.label)
            }
        }
    }

    const onProviderSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        saveProviderMutation.mutate()
    }

    const onMcpSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        saveMcpMutation.mutate()
    }

    return (
        <AuthenticatedAppShell activeSection="settings">
            <section className="page-stack">
                <header className="page-header">
                    <div>
                        <p className="section-kicker">Settings</p>
                        <h1>App settings</h1>
                        <p>Model connections, shared tools, account, theme, and defaults.</p>
                    </div>
                </header>

                <nav className="settings-tabs" aria-label="Settings sections">
                    <a href="#models" className="settings-tab active">
                        <Plug size={17} />
                        Models
                    </a>
                    <a href="#tools" className="settings-tab">
                        <Wrench size={17} />
                        Tools
                    </a>
                    <a href="#account" className="settings-tab">
                        <UserRound size={17} />
                        Account
                    </a>
                    <a href="#theme" className="settings-tab">
                        <Palette size={17} />
                        Theme
                    </a>
                </nav>

                <section className="settings-layout">
                    <section id="models" className="surface span-wide">
                        <div className="surface-heading">
                            <div>
                                <h2>Model connections</h2>
                                <p>Providers saved here can be used by any room.</p>
                            </div>
                            <KeyRound size={19} />
                        </div>
                        {providerNotice ? (
                            <p className="form-alert warning">{providerNotice}</p>
                        ) : null}
                        <div className="stack-list">
                            {providers.length === 0 ? (
                                <p className="muted">No model connections saved.</p>
                            ) : null}
                            {providers.map((entry) => (
                                <button
                                    type="button"
                                    key={entry.id}
                                    className="plain-row interactive"
                                    onClick={() => editProvider(entry)}
                                >
                                    <span className="row-icon">
                                        <Plug size={18} />
                                    </span>
                                    <span>
                                        <strong>{entry.label}</strong>
                                        <small>
                                            {entry.defaultModel} · updated{' '}
                                            {formatRelativeTime(entry.updatedAt)}
                                        </small>
                                    </span>
                                    <span className={`pill ${statusTone(entry.status)}`}>
                                        {entry.authMode === 'oauth'
                                            ? 'Browser login'
                                            : entry.hasCredential
                                              ? 'Connected'
                                              : 'Needs key'}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </section>

                    <section className="surface">
                        <div className="surface-heading">
                            <div>
                                <h2>Defaults</h2>
                                <p>Used by new rooms unless changed.</p>
                            </div>
                            <Settings size={19} />
                        </div>
                        <div className="form-grid single">
                            <label>
                                Default provider
                                <select
                                    value={defaultProviderId ?? ''}
                                    onChange={(event) =>
                                        setDefaultProviderId(event.target.value || null)
                                    }
                                >
                                    <option value="">No default</option>
                                    {providers.map((entry) => (
                                        <option key={entry.id} value={entry.id}>
                                            {entry.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label>
                                Default model
                                <input
                                    value={defaultModel}
                                    onChange={(event) => setDefaultModel(event.target.value)}
                                    placeholder="provider/model"
                                />
                            </label>
                            <button
                                type="button"
                                className="button primary"
                                onClick={() => updateDefaultsMutation.mutate()}
                                disabled={updateDefaultsMutation.isPending}
                            >
                                <ShieldCheck size={17} />
                                Save defaults
                            </button>
                        </div>
                    </section>

                    <details className="surface settings-accordion">
                        <summary className="plain-row interactive">
                            <span className="row-icon">
                                <KeyRound size={18} />
                            </span>
                            <span>
                                <strong>
                                    {providerId ? 'Edit model connection' : 'Add model connection'}
                                </strong>
                                <small>Provider, model, and write-only credential fields.</small>
                            </span>
                        </summary>
                        <form className="form-grid" onSubmit={onProviderSubmit}>
                            <label>
                                Preset
                                <select
                                    value={provider}
                                    onChange={(event) => onProviderPreset(event.target.value)}
                                >
                                    {catalog.map((entry) => (
                                        <option key={entry.provider} value={entry.provider}>
                                            {entry.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label>
                                Name
                                <input
                                    value={providerLabel}
                                    onChange={(event) => setProviderLabel(event.target.value)}
                                    placeholder="OpenRouter"
                                />
                            </label>
                            <label>
                                Provider type
                                <select
                                    value={providerApi}
                                    onChange={(event) =>
                                        setProviderApi(event.target.value as ProviderApi)
                                    }
                                >
                                    <option value="openai-completions">OpenAI compatible</option>
                                    <option value="openai-responses">OpenAI responses</option>
                                    <option value="openai-codex-responses">
                                        OpenAI Codex OAuth
                                    </option>
                                    <option value="anthropic-messages">Anthropic</option>
                                    <option value="google-generative-ai">Google</option>
                                </select>
                            </label>
                            <label>
                                Custom endpoint
                                <input
                                    value={providerBaseUrl}
                                    onChange={(event) => setProviderBaseUrl(event.target.value)}
                                    placeholder="Optional"
                                />
                            </label>
                            <label>
                                Default model
                                <input
                                    value={providerModel}
                                    onChange={(event) => setProviderModel(event.target.value)}
                                />
                            </label>
                            <label>
                                Fallback models
                                <input
                                    value={fallbackModels}
                                    onChange={(event) => setFallbackModels(event.target.value)}
                                    placeholder="provider/model, provider/model"
                                />
                            </label>
                            {providerUsesOAuth ? (
                                <div className="form-alert info span-full">
                                    OpenAI Codex uses per-room browser login. No API key is saved
                                    for this connection.
                                </div>
                            ) : (
                                <label className="span-full">
                                    API key
                                    <input
                                        type="password"
                                        value={providerApiKey}
                                        onChange={(event) => setProviderApiKey(event.target.value)}
                                        placeholder={
                                            providerId ? 'Leave blank to keep masked key' : ''
                                        }
                                    />
                                </label>
                            )}
                            <label className="check-row">
                                <input
                                    type="checkbox"
                                    checked={makeDefault}
                                    onChange={(event) => setMakeDefault(event.target.checked)}
                                />
                                <span>
                                    <strong>Use as app default</strong>
                                    <small>Rooms can inherit this connection</small>
                                </span>
                            </label>
                            <button
                                type="submit"
                                className="button primary"
                                disabled={saveProviderMutation.isPending}
                            >
                                <RotateCw size={17} />
                                {providerId ? 'Save connection' : 'Create connection'}
                            </button>
                        </form>
                    </details>

                    <section id="tools" className="surface span-wide">
                        <div className="surface-heading">
                            <div>
                                <h2>Shared tools</h2>
                                <p>Rooms can attach selected tools from this list.</p>
                            </div>
                            <Cable size={19} />
                        </div>
                        {mcpNotice ? <p className="form-alert warning">{mcpNotice}</p> : null}
                        <div className="stack-list">
                            {mcpConnections.length === 0 ? (
                                <p className="muted">No shared tools.</p>
                            ) : null}
                            {mcpConnections.map((entry) => (
                                <button
                                    type="button"
                                    key={entry.id}
                                    className="plain-row interactive"
                                    onClick={() => editMcp(entry)}
                                >
                                    <span className="row-icon">
                                        <Wrench size={18} />
                                    </span>
                                    <span>
                                        <strong>{entry.name}</strong>
                                        <small>
                                            {entry.serverKey} ·{' '}
                                            {connectionTypeLabel(entry.transport)} · updated{' '}
                                            {formatRelativeTime(entry.updatedAt)}
                                        </small>
                                    </span>
                                    <span className={`pill ${statusTone(entry.status)}`}>
                                        {entry.status}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </section>

                    <details className="surface settings-accordion span-wide">
                        <summary className="plain-row interactive">
                            <span className="row-icon">
                                <Wrench size={18} />
                            </span>
                            <span>
                                <strong>{mcpId ? 'Edit shared tool' : 'Add shared tool'}</strong>
                                <small>Connection details stay behind this edit flow.</small>
                            </span>
                        </summary>
                        <form className="form-grid" onSubmit={onMcpSubmit}>
                            <label>
                                Name
                                <input
                                    value={mcpName}
                                    onChange={(event) => setMcpName(event.target.value)}
                                    placeholder="Documentation Search"
                                />
                            </label>
                            <label>
                                Tool key
                                <input
                                    value={mcpServerKey}
                                    onChange={(event) => setMcpServerKey(event.target.value)}
                                    placeholder="docs"
                                />
                            </label>
                            <label>
                                Connection type
                                <select
                                    value={mcpTransport}
                                    onChange={(event) =>
                                        setMcpTransport(
                                            event.target.value as
                                                | 'stdio'
                                                | 'http'
                                                | 'streamable_http',
                                        )
                                    }
                                >
                                    <option value="stdio">Local command</option>
                                    <option value="http">HTTP endpoint</option>
                                    <option value="streamable_http">Streamable HTTP</option>
                                </select>
                            </label>
                            <label>
                                Local command
                                <input
                                    value={mcpCommand}
                                    onChange={(event) => setMcpCommand(event.target.value)}
                                    placeholder="uvx context7-mcp"
                                />
                            </label>
                            <label>
                                Command args
                                <input
                                    value={mcpArgs}
                                    onChange={(event) => setMcpArgs(event.target.value)}
                                    placeholder='["context7-mcp"]'
                                />
                            </label>
                            <label>
                                Endpoint URL
                                <input
                                    value={mcpUrl}
                                    onChange={(event) => setMcpUrl(event.target.value)}
                                    placeholder="https://mcp.example.com"
                                />
                            </label>
                            <label>
                                Access
                                <select
                                    value={mcpAuthMode}
                                    onChange={(event) =>
                                        setMcpAuthMode(event.target.value as 'none' | 'bearer')
                                    }
                                >
                                    <option value="none">None</option>
                                    <option value="bearer">Access token</option>
                                </select>
                            </label>
                            <label>
                                Access token
                                <input
                                    type="password"
                                    value={mcpBearerToken}
                                    onChange={(event) => setMcpBearerToken(event.target.value)}
                                    placeholder={mcpId ? 'Leave blank to keep masked token' : ''}
                                />
                            </label>
                            <label>
                                Allowed tools
                                <input
                                    value={mcpAllowedTools}
                                    onChange={(event) => setMcpAllowedTools(event.target.value)}
                                    placeholder="search, fetch"
                                />
                            </label>
                            <label className="span-full">
                                Headers
                                <textarea
                                    value={mcpHeaders}
                                    onChange={(event) => setMcpHeaders(event.target.value)}
                                    placeholder='{"X-Tenant": "agent-room"}'
                                />
                            </label>
                            <button
                                type="submit"
                                className="button primary"
                                disabled={saveMcpMutation.isPending}
                            >
                                <RotateCw size={17} />
                                {mcpId ? 'Save tool' : 'Create tool'}
                            </button>
                        </form>
                    </details>

                    <section id="account" className="surface">
                        <div className="surface-heading">
                            <div>
                                <h2>Account</h2>
                                <p>Local operator account.</p>
                            </div>
                            <UserRound size={19} />
                        </div>
                        <div className="plain-row">
                            <CheckCircle2 size={18} />
                            <span>
                                <strong>Signed in</strong>
                                <small>Session managed by Agent Room</small>
                            </span>
                        </div>
                    </section>

                    <section className="surface">
                        <div className="surface-heading">
                            <div>
                                <h2>Room settings</h2>
                                <p>Open a room to change its model, tools, secrets, and jobs.</p>
                            </div>
                            <Settings size={19} />
                        </div>
                        <Link to="/" className="plain-row interactive">
                            <span className="row-icon">
                                <Settings size={18} />
                            </span>
                            <span>
                                <strong>Choose room</strong>
                                <small>Room-specific settings live with each room.</small>
                            </span>
                        </Link>
                    </section>

                    <section id="theme" className="surface">
                        <div className="surface-heading">
                            <div>
                                <h2>Theme</h2>
                                <p>Follows your browser preference.</p>
                            </div>
                            <Palette size={19} />
                        </div>
                        <div className="plain-row">
                            <span className="status-dot ready" />
                            <span>
                                <strong>Light and dark ready</strong>
                                <small>System preference</small>
                            </span>
                        </div>
                    </section>
                </section>
            </section>
        </AuthenticatedAppShell>
    )
}
