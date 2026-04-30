import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
    KeyRoundIcon,
    LogOutIcon,
    MonitorIcon,
    MoonIcon,
    PencilIcon,
    PlugIcon,
    PlusIcon,
    SunIcon,
    UserIcon,
    WrenchIcon,
} from 'lucide-react'
import { AppShell, useThemeMode } from '#/components/app-shell'
import {
    AttentionBanner,
    BrandMark,
    EmptyState,
    LoadingRows,
    PageHeader,
    Section,
    StateBadge,
} from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Textarea } from '#/components/ui/textarea'
import { Switch } from '#/components/ui/switch'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '#/components/ui/select'
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from '#/components/ui/sheet'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { describeProviderStatus } from '#/lib/state'
import { formatRelativeTime } from '#/lib/format'
import { cn } from '#/lib/utils'
import { requireRouteUser } from './-route-auth'
import { currentUserServer, logoutServer } from './-auth-server'
import {
    getOperatorConfigServer,
    saveMcpConnectionServer,
    saveProviderConnectionServer,
    updateAppDefaultsServer,
} from './-operator-config-server'
import type {
    McpConnectionSummary,
    OperatorConfigSnapshot,
    ProviderConnectionSummary,
} from '#/server/configuration/operator-configuration'

export const Route = createFileRoute('/settings')({
    beforeLoad: requireRouteUser,
    component: SettingsPage,
})

type ProviderApi = ProviderConnectionSummary['api']
type ProviderAuthMode = ProviderConnectionSummary['authMode']
type McpTransport = McpConnectionSummary['transport']
type McpAuthMode = McpConnectionSummary['authMode']

const PROVIDER_API_OPTIONS: { value: ProviderApi; label: string }[] = [
    { value: 'openai-completions', label: 'OpenAI compatible' },
    { value: 'openai-responses', label: 'OpenAI Responses' },
    { value: 'openai-codex-responses', label: 'OpenAI Codex (OAuth)' },
    { value: 'anthropic-messages', label: 'Anthropic' },
    { value: 'google-generative-ai', label: 'Google Gemini' },
]

const TRANSPORT_OPTIONS: { value: McpTransport; label: string }[] = [
    { value: 'stdio', label: 'Local command (stdio)' },
    { value: 'http', label: 'HTTP endpoint' },
    { value: 'streamable_http', label: 'Streamable HTTP' },
]

interface ProviderFormState {
    id?: string
    label: string
    provider: string
    api: ProviderApi
    authMode: ProviderAuthMode
    baseUrl: string
    defaultModel: string
    fallbackModels: string
    apiKey: string
    replaceApiKey: boolean
    hasCredential: boolean
    makeDefault: boolean
}

function resolveProviderFormProtocol(
    form: ProviderFormState,
    providerCatalog: OperatorConfigSnapshot['providerCatalog'],
): {
    selectedProvider: OperatorConfigSnapshot['providerCatalog'][number] | null
    api: ProviderApi
    authMode: ProviderAuthMode
} {
    const selectedProvider =
        providerCatalog.find((entry) => entry.provider === form.provider.trim()) ?? null
    const api = selectedProvider?.api ?? form.api
    const authMode = api === 'openai-codex-responses' ? 'oauth' : form.authMode

    return {
        selectedProvider,
        api,
        authMode,
    }
}

const EMPTY_PROVIDER_FORM: ProviderFormState = {
    label: '',
    provider: 'openrouter',
    api: 'openai-completions',
    authMode: 'api_key',
    baseUrl: '',
    defaultModel: '',
    fallbackModels: '',
    apiKey: '',
    replaceApiKey: true,
    hasCredential: false,
    makeDefault: false,
}

interface McpFormState {
    id?: string
    name: string
    serverKey: string
    transport: McpTransport
    command: string
    argsText: string
    url: string
    headersText: string
    authMode: McpAuthMode
    bearerToken: string
    replaceBearerToken: boolean
    hasCredential: boolean
    allowedToolsText: string
}
const EMPTY_MCP_FORM: McpFormState = {
    name: '',
    serverKey: '',
    transport: 'stdio',
    command: '',
    argsText: '',
    url: '',
    headersText: '',
    authMode: 'none',
    bearerToken: '',
    replaceBearerToken: true,
    hasCredential: false,
    allowedToolsText: '',
}

function FieldGroup({
    label,
    htmlFor,
    hint,
    children,
    className,
}: {
    label: ReactNode
    htmlFor?: string
    hint?: ReactNode
    children: ReactNode
    className?: string
}) {
    return (
        <div className={cn('flex flex-col gap-1.5', className)}>
            <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
                {label}
            </Label>
            {children}
            {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
    )
}

function TextField({
    label,
    id,
    value,
    onChange,
    placeholder,
    hint,
}: {
    label: string
    id: string
    value: string
    onChange: (value: string) => void
    placeholder?: string
    hint?: ReactNode
}) {
    return (
        <FieldGroup label={label} htmlFor={id} hint={hint}>
            <Input
                id={id}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
            />
        </FieldGroup>
    )
}

function SelectField<T extends string>({
    label,
    id,
    value,
    onChange,
    options,
}: {
    label: string
    id: string
    value: T
    onChange: (value: T) => void
    options: { value: T; label: string }[]
}) {
    return (
        <FieldGroup label={label} htmlFor={id}>
            <Select value={value} onValueChange={(v) => onChange(v as T)}>
                <SelectTrigger id={id} className="w-full">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                            {option.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </FieldGroup>
    )
}

function MaskedSecretField({
    label,
    id,
    hasCredential,
    replace,
    onToggleReplace,
    value,
    onChange,
    placeholder,
}: {
    label: string
    id: string
    hasCredential: boolean
    replace: boolean
    onToggleReplace: (replace: boolean) => void
    value: string
    onChange: (value: string) => void
    placeholder?: string
}) {
    if (hasCredential && !replace) {
        return (
            <FieldGroup label={label}>
                <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-sm">
                    <span className="font-mono tracking-widest text-muted-foreground">
                        ••••••••••••
                    </span>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onToggleReplace(true)}
                    >
                        Replace
                    </Button>
                </div>
            </FieldGroup>
        )
    }
    return (
        <FieldGroup
            label={label}
            htmlFor={id}
            hint={hasCredential ? 'Submitting will overwrite the saved value.' : undefined}
        >
            <div className="flex items-center gap-2">
                <Input
                    id={id}
                    type="password"
                    autoComplete="off"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                />
                {hasCredential ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onToggleReplace(false)}
                    >
                        Cancel
                    </Button>
                ) : null}
            </div>
        </FieldGroup>
    )
}

function ConnectionRow({
    title,
    badges,
    meta,
    onEdit,
}: {
    title: string
    badges: ReactNode
    meta: ReactNode
    onEdit: () => void
}) {
    return (
        <div className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{title}</span>
                    {badges}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">{meta}</div>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
                <PencilIcon />
                Edit
            </Button>
        </div>
    )
}

function ChipBadge({ children }: { children: ReactNode }) {
    return (
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {children}
        </span>
    )
}

function ConnectionsSection<T extends { id: string }>({
    title,
    description,
    addLabel,
    emptyIcon,
    emptyTitle,
    emptyDescription,
    loading,
    items,
    onAdd,
    renderRow,
}: {
    title: string
    description: string
    addLabel: string
    emptyIcon: typeof PlugIcon
    emptyTitle: string
    emptyDescription: string
    loading: boolean
    items: T[]
    onAdd: () => void
    renderRow: (item: T) => ReactNode
}) {
    const addButton = (
        <Button type="button" size="sm" onClick={onAdd}>
            <PlusIcon />
            {addLabel}
        </Button>
    )
    return (
        <Section title={title} description={description} actions={addButton} bodyClassName="p-0">
            {loading ? (
                <div className="p-4">
                    <LoadingRows count={2} />
                </div>
            ) : items.length === 0 ? (
                <div className="p-4">
                    <EmptyState
                        icon={emptyIcon}
                        title={emptyTitle}
                        description={emptyDescription}
                        action={addButton}
                    />
                </div>
            ) : (
                <div className="divide-y divide-border/60">{items.map(renderRow)}</div>
            )}
        </Section>
    )
}

function EditSheet({
    open,
    onOpenChange,
    title,
    description,
    children,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    description: string
    children: ReactNode
}) {
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="flex w-full flex-col gap-0 sm:max-w-lg">
                <SheetHeader className="border-b border-border/60">
                    <SheetTitle>{title}</SheetTitle>
                    <SheetDescription>{description}</SheetDescription>
                </SheetHeader>
                {children}
            </SheetContent>
        </Sheet>
    )
}

function ThemeChoice({
    active,
    icon,
    label,
    onClick,
}: {
    active: boolean
    icon: ReactNode
    label: string
    onClick: () => void
}) {
    return (
        <Button
            type="button"
            variant="outline"
            onClick={onClick}
            data-active={active}
            className="h-auto justify-between gap-2 px-3 py-2.5 text-sm font-normal data-[active=true]:border-primary data-[active=true]:bg-primary/5"
        >
            <span className="flex items-center gap-2">
                {icon}
                {label}
            </span>
            <span
                aria-hidden
                className={cn(
                    'size-2 rounded-full ring-1 ring-border',
                    active && 'bg-primary ring-primary',
                )}
            />
        </Button>
    )
}

function FormShell({
    onSubmit,
    onCancel,
    pending,
    submitLabel,
    submitIcon,
    children,
}: {
    onSubmit: (event: FormEvent<HTMLFormElement>) => void
    onCancel: () => void
    pending: boolean
    submitLabel: string
    submitIcon: ReactNode
    children: ReactNode
}) {
    return (
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
            <div className="flex-1 space-y-4 overflow-y-auto p-4">{children}</div>
            <SheetFooter className="border-t border-border/60">
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button type="submit" disabled={pending}>
                        {submitIcon}
                        {submitLabel}
                    </Button>
                </div>
            </SheetFooter>
        </form>
    )
}

function ProviderForm({
    form,
    setForm,
    onSubmit,
    onCancel,
    pending,
    providerCatalog,
}: {
    form: ProviderFormState
    setForm: (patch: Partial<ProviderFormState>) => void
    onSubmit: (event: FormEvent<HTMLFormElement>) => void
    onCancel: () => void
    pending: boolean
    providerCatalog: OperatorConfigSnapshot['providerCatalog']
}) {
    const protocol = resolveProviderFormProtocol(form, providerCatalog)
    const usesOAuth = protocol.authMode === 'oauth' || protocol.api === 'openai-codex-responses'
    const providerOptions = providerCatalog.map((entry) => ({
        value: entry.provider,
        label: entry.label,
    }))
    const providerApiOptions = protocol.selectedProvider
        ? PROVIDER_API_OPTIONS.filter((option) => option.value === protocol.selectedProvider?.api)
        : PROVIDER_API_OPTIONS
    return (
        <FormShell
            onSubmit={onSubmit}
            onCancel={onCancel}
            pending={pending}
            submitLabel={form.id ? 'Save provider' : 'Create provider'}
            submitIcon={<KeyRoundIcon />}
        >
            <TextField
                id="provider-label"
                label="Label"
                value={form.label}
                onChange={(label) => setForm({ label })}
                placeholder="OpenRouter"
            />
            <div className="grid gap-3 sm:grid-cols-2">
                <SelectField
                    id="provider-key"
                    label="Provider"
                    value={form.provider}
                    onChange={(provider) => {
                        const selected = providerCatalog.find(
                            (entry) => entry.provider === provider,
                        )
                        setForm({
                            provider,
                            api: selected?.api ?? form.api,
                            authMode:
                                selected?.api === 'openai-codex-responses'
                                    ? 'oauth'
                                    : form.authMode === 'oauth'
                                      ? 'api_key'
                                      : form.authMode,
                            defaultModel: selected?.model ?? form.defaultModel,
                        })
                    }}
                    options={providerOptions}
                />
                <SelectField
                    id="provider-api"
                    label="API"
                    value={protocol.api}
                    onChange={(api) => setForm({ api })}
                    options={providerApiOptions}
                />
            </div>
            <SelectField<ProviderAuthMode>
                id="provider-auth"
                label="Auth mode"
                value={protocol.authMode}
                onChange={(authMode) => setForm({ authMode })}
                options={[
                    { value: 'api_key', label: 'API key' },
                    { value: 'oauth', label: 'OAuth (browser)' },
                ]}
            />
            <TextField
                id="provider-base-url"
                label="Base URL"
                value={form.baseUrl}
                onChange={(baseUrl) => setForm({ baseUrl })}
                placeholder="https://"
                hint="Optional override for OpenRouter, Ollama, or LM Studio endpoints."
            />
            <TextField
                id="provider-default-model"
                label="Default model"
                value={form.defaultModel}
                onChange={(defaultModel) => setForm({ defaultModel })}
                placeholder="provider/model"
            />
            <TextField
                id="provider-fallback-models"
                label="Fallback models"
                value={form.fallbackModels}
                onChange={(fallbackModels) => setForm({ fallbackModels })}
                placeholder="provider/model, provider/model"
                hint="Comma separated. Used in order if the default fails."
            />
            {usesOAuth ? (
                <AttentionBanner
                    tone="info"
                    title="Browser login"
                    description="OAuth providers complete sign-in per room. No API key is stored."
                />
            ) : (
                <MaskedSecretField
                    label="API key"
                    id="provider-api-key"
                    hasCredential={form.hasCredential}
                    replace={form.replaceApiKey}
                    onToggleReplace={(replace) =>
                        setForm({ replaceApiKey: replace, apiKey: replace ? form.apiKey : '' })
                    }
                    value={form.apiKey}
                    onChange={(apiKey) => setForm({ apiKey })}
                    placeholder="sk-..."
                />
            )}
            <label className="flex items-start justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground">Use as app default</div>
                    <p className="text-xs text-muted-foreground">
                        New rooms inherit this connection unless overridden.
                    </p>
                </div>
                <Switch
                    checked={form.makeDefault}
                    onCheckedChange={(makeDefault) => setForm({ makeDefault })}
                />
            </label>
        </FormShell>
    )
}

function McpForm({
    form,
    setForm,
    onSubmit,
    onCancel,
    pending,
}: {
    form: McpFormState
    setForm: (patch: Partial<McpFormState>) => void
    onSubmit: (event: FormEvent<HTMLFormElement>) => void
    onCancel: () => void
    pending: boolean
}) {
    return (
        <FormShell
            onSubmit={onSubmit}
            onCancel={onCancel}
            pending={pending}
            submitLabel={form.id ? 'Save tool' : 'Create tool'}
            submitIcon={<WrenchIcon />}
        >
            <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                    id="mcp-name"
                    label="Name"
                    value={form.name}
                    onChange={(name) => setForm({ name })}
                    placeholder="Documentation Search"
                />
                <TextField
                    id="mcp-server-key"
                    label="Server key"
                    value={form.serverKey}
                    onChange={(serverKey) => setForm({ serverKey })}
                    placeholder="docs"
                />
            </div>
            <SelectField
                id="mcp-transport"
                label="Transport"
                value={form.transport}
                onChange={(transport) => setForm({ transport })}
                options={TRANSPORT_OPTIONS}
            />
            {form.transport === 'stdio' ? (
                <>
                    <TextField
                        id="mcp-command"
                        label="Command"
                        value={form.command}
                        onChange={(command) => setForm({ command })}
                        placeholder="uvx context7-mcp"
                    />
                    <TextField
                        id="mcp-args"
                        label="Arguments"
                        value={form.argsText}
                        onChange={(argsText) => setForm({ argsText })}
                        placeholder='["--flag", "value"]'
                        hint='JSON array or shell-style ("--flag", value).'
                    />
                </>
            ) : (
                <TextField
                    id="mcp-url"
                    label="Endpoint URL"
                    value={form.url}
                    onChange={(url) => setForm({ url })}
                    placeholder="https://mcp.example.com"
                />
            )}
            <FieldGroup
                label="Headers"
                htmlFor="mcp-headers"
                hint="JSON object of header names to values."
            >
                <Textarea
                    id="mcp-headers"
                    rows={3}
                    value={form.headersText}
                    onChange={(e) => setForm({ headersText: e.target.value })}
                    placeholder='{"X-Tenant": "agent-room"}'
                />
            </FieldGroup>
            <SelectField<McpAuthMode>
                id="mcp-auth"
                label="Auth mode"
                value={form.authMode}
                onChange={(authMode) => setForm({ authMode })}
                options={[
                    { value: 'none', label: 'None' },
                    { value: 'bearer', label: 'Bearer token' },
                ]}
            />
            {form.authMode === 'bearer' ? (
                <MaskedSecretField
                    label="Bearer token"
                    id="mcp-bearer-token"
                    hasCredential={form.hasCredential}
                    replace={form.replaceBearerToken}
                    onToggleReplace={(replace) =>
                        setForm({
                            replaceBearerToken: replace,
                            bearerToken: replace ? form.bearerToken : '',
                        })
                    }
                    value={form.bearerToken}
                    onChange={(bearerToken) => setForm({ bearerToken })}
                />
            ) : null}
            <TextField
                id="mcp-allowed-tools"
                label="Allowed tools"
                value={form.allowedToolsText}
                onChange={(allowedToolsText) => setForm({ allowedToolsText })}
                placeholder="search, fetch"
                hint="Comma separated. Empty allows all advertised tools."
            />
        </FormShell>
    )
}

function SettingsPage() {
    const queryClient = useQueryClient()
    const navigate = useNavigate()
    const [themeMode, setThemeMode] = useThemeMode()

    const configQuery = useQuery<OperatorConfigSnapshot>({
        queryKey: ['operator-config'],
        queryFn: () => getOperatorConfigServer(),
    })
    const userQuery = useQuery({
        queryKey: ['auth-current-user'],
        queryFn: () => currentUserServer(),
        staleTime: 60_000,
    })

    const config = configQuery.data
    const providers = config?.providers ?? []
    const mcpConnections = config?.mcpConnections ?? []
    const onboardingCompleted = Boolean(config?.onboarding.completed)

    const [providerSheetOpen, setProviderSheetOpen] = useState(false)
    const [providerForm, setProviderForm] = useState<ProviderFormState>(EMPTY_PROVIDER_FORM)
    const [mcpSheetOpen, setMcpSheetOpen] = useState(false)
    const [mcpForm, setMcpForm] = useState<McpFormState>(EMPTY_MCP_FORM)
    const [defaultProviderId, setDefaultProviderId] = useState<string | null>(null)
    const [defaultModel, setDefaultModel] = useState('')

    useEffect(() => {
        if (!config) return
        setDefaultProviderId(config.settings.defaultProviderConnectionId)
        setDefaultModel(config.settings.defaultModel ?? '')
    }, [config])

    const updateProviderForm = (patch: Partial<ProviderFormState>) =>
        setProviderForm((c) => ({ ...c, ...patch }))
    const updateMcpForm = (patch: Partial<McpFormState>) => setMcpForm((c) => ({ ...c, ...patch }))
    const invalidateConfig = async () => {
        await queryClient.invalidateQueries({ queryKey: ['operator-config'], exact: false })
        await queryClient.invalidateQueries({ queryKey: ['room-config'], exact: false })
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
            api: entry.api,
            authMode: entry.authMode,
            baseUrl: entry.baseUrl ?? '',
            defaultModel: entry.defaultModel,
            fallbackModels: entry.fallbackModels.join(', '),
            apiKey: '',
            replaceApiKey: !entry.hasCredential,
            hasCredential: entry.hasCredential,
            makeDefault: config?.settings.defaultProviderConnectionId === entry.id,
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
            return saveProviderConnectionServer({
                data: {
                    id: providerForm.id,
                    label: providerForm.label.trim(),
                    provider: providerForm.provider.trim(),
                    api: protocol.api,
                    authMode: usesOAuth ? 'oauth' : 'api_key',
                    baseUrl: providerForm.baseUrl.trim() ? providerForm.baseUrl.trim() : null,
                    defaultModel: providerForm.defaultModel.trim(),
                    fallbackModels,
                    apiKey:
                        providerForm.replaceApiKey && providerForm.apiKey
                            ? providerForm.apiKey
                            : undefined,
                    makeDefault: providerForm.makeDefault,
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

    const updateDefaultsMutation = useMutation({
        mutationFn: async () =>
            updateAppDefaultsServer({
                data: {
                    defaultProviderConnectionId: defaultProviderId,
                    defaultModel: defaultModel.trim() ? defaultModel.trim() : null,
                    onboardingCompleted,
                },
            }),
        onSuccess: async () => {
            toast.success('App defaults saved')
            await queryClient.invalidateQueries({ queryKey: ['operator-config'], exact: false })
        },
        onError: (error) =>
            toast.error(error instanceof Error ? error.message : 'Defaults save failed'),
    })

    const logoutMutation = useMutation({
        mutationFn: async () => logoutServer(),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['auth-current-user'] })
            await navigate({ to: '/login' })
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : 'Sign out failed'),
    })

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

    const defaultsDirty = useMemo(() => {
        if (!config) return false
        return (
            (defaultProviderId ?? null) !== config.settings.defaultProviderConnectionId ||
            defaultModel.trim() !== (config.settings.defaultModel ?? '')
        )
    }, [config, defaultProviderId, defaultModel])

    return (
        <AppShell>
            <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
                <PageHeader
                    title="Settings"
                    subtitle="Provider connections, tools, and account preferences."
                    className="border-0 px-0 py-0"
                />

                <div className="mt-6 flex flex-col gap-5">
                    {!onboardingCompleted ? (
                        <AttentionBanner
                            tone="info"
                            title="Finish setup"
                            description="Add a provider connection and pick an app default to enable rooms."
                        />
                    ) : null}

                    <ConnectionsSection
                        title="Provider connections"
                        description="Saved providers can be used by any room."
                        addLabel="Add provider"
                        emptyIcon={PlugIcon}
                        emptyTitle="No provider connections"
                        emptyDescription="Add an OpenAI, Anthropic, or compatible provider to enable rooms."
                        loading={configQuery.isLoading}
                        items={providers}
                        onAdd={openNewProvider}
                        renderRow={(entry) => {
                            const status = describeProviderStatus(entry.status)
                            const isDefault =
                                config?.settings.defaultProviderConnectionId === entry.id
                            return (
                                <ConnectionRow
                                    key={entry.id}
                                    title={entry.label}
                                    badges={
                                        <>
                                            {isDefault ? <ChipBadge>Default</ChipBadge> : null}
                                            <StateBadge tone={status.tone} label={status.label} />
                                        </>
                                    }
                                    meta={
                                        <>
                                            <div className="truncate">
                                                {entry.provider} · {entry.api} ·{' '}
                                                {entry.defaultModel}
                                            </div>
                                            <div className="mt-0.5">
                                                Updated {formatRelativeTime(entry.updatedAt)}
                                            </div>
                                        </>
                                    }
                                    onEdit={() => openEditProvider(entry)}
                                />
                            )
                        }}
                    />

                    <ConnectionsSection
                        title="Connected tools"
                        description="MCP servers exposed to rooms."
                        addLabel="Add tool"
                        emptyIcon={WrenchIcon}
                        emptyTitle="No tools connected"
                        emptyDescription="Attach MCP servers so rooms can call external tools."
                        loading={configQuery.isLoading}
                        items={mcpConnections}
                        onAdd={openNewMcp}
                        renderRow={(entry) => {
                            const status = describeProviderStatus(entry.status)
                            return (
                                <ConnectionRow
                                    key={entry.id}
                                    title={entry.name}
                                    badges={
                                        <>
                                            <ChipBadge>{entry.transport}</ChipBadge>
                                            <StateBadge tone={status.tone} label={status.label} />
                                        </>
                                    }
                                    meta={
                                        <>
                                            <div className="truncate">{entry.serverKey}</div>
                                            <div className="mt-0.5">
                                                Updated {formatRelativeTime(entry.updatedAt)}
                                            </div>
                                        </>
                                    }
                                    onEdit={() => openEditMcp(entry)}
                                />
                            )
                        }}
                    />

                    <Section
                        title="App defaults"
                        description="New rooms inherit these unless overridden."
                    >
                        <div className="grid gap-3 sm:grid-cols-2">
                            <FieldGroup label="Default provider" htmlFor="default-provider">
                                <Select
                                    value={defaultProviderId ?? '__none'}
                                    onValueChange={(value) =>
                                        setDefaultProviderId(value === '__none' ? null : value)
                                    }
                                >
                                    <SelectTrigger id="default-provider" className="w-full">
                                        <SelectValue placeholder="No default" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="__none">No default</SelectItem>
                                        {providers.map((entry) => (
                                            <SelectItem key={entry.id} value={entry.id}>
                                                {entry.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </FieldGroup>
                            <TextField
                                id="default-model"
                                label="Default model"
                                value={defaultModel}
                                onChange={setDefaultModel}
                                placeholder="provider/model"
                                hint="Override the provider default when creating rooms."
                            />
                        </div>
                        <div className="mt-4 flex justify-end">
                            <Button
                                type="button"
                                onClick={() => updateDefaultsMutation.mutate()}
                                disabled={updateDefaultsMutation.isPending || !defaultsDirty}
                            >
                                Save defaults
                            </Button>
                        </div>
                    </Section>

                    <Section title="Account" description="Local operator account.">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-center gap-3">
                                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                                    <UserIcon className="size-5" aria-hidden />
                                </span>
                                <div className="min-w-0">
                                    <div className="truncate text-sm font-medium text-foreground">
                                        {userQuery.data?.email ?? 'Unknown'}
                                    </div>
                                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                                        {userQuery.data?.role ?? '—'}
                                    </div>
                                </div>
                            </div>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => logoutMutation.mutate()}
                                disabled={logoutMutation.isPending}
                            >
                                <LogOutIcon />
                                Sign out
                            </Button>
                        </div>
                    </Section>

                    <Section title="Theme" description="Choose how Agent Room renders.">
                        <div className="grid gap-2 sm:grid-cols-3">
                            <ThemeChoice
                                active={themeMode === 'light'}
                                icon={<SunIcon className="size-4" />}
                                label="Light"
                                onClick={() => setThemeMode('light')}
                            />
                            <ThemeChoice
                                active={themeMode === 'dark'}
                                icon={<MoonIcon className="size-4" />}
                                label="Dark"
                                onClick={() => setThemeMode('dark')}
                            />
                            <ThemeChoice
                                active={themeMode === 'system'}
                                icon={<MonitorIcon className="size-4" />}
                                label="System"
                                onClick={() => setThemeMode('system')}
                            />
                        </div>
                    </Section>

                    <Card>
                        <CardHeader>
                            <div className="flex items-center gap-3">
                                <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-foreground">
                                    <BrandMark size={20} />
                                </span>
                                <div className="min-w-0">
                                    <CardTitle className="text-sm">Agent Room</CardTitle>
                                    <CardDescription className="text-xs">
                                        Self-hosted agent orchestration. Rooms keep instructions,
                                        tools, secrets, and sessions in one auditable workspace.
                                    </CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="px-4 pb-4 pt-0">
                            <Link
                                to="/about"
                                className="text-xs font-medium text-primary hover:underline"
                            >
                                Learn more about Agent Room
                            </Link>
                        </CardContent>
                    </Card>
                </div>
            </div>

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
                />
            </EditSheet>

            <EditSheet
                open={mcpSheetOpen}
                onOpenChange={setMcpSheetOpen}
                title={mcpForm.id ? 'Edit tool' : 'Add tool'}
                description="MCP servers exposed to rooms. Bearer tokens are write-only."
            >
                <McpForm
                    form={mcpForm}
                    setForm={updateMcpForm}
                    onSubmit={onSubmitMcp}
                    onCancel={() => setMcpSheetOpen(false)}
                    pending={saveMcpMutation.isPending}
                />
            </EditSheet>
        </AppShell>
    )
}
