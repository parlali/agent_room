import { KeyRound, Save, Settings } from 'lucide-react'
import type { FormEvent } from 'react'
import type { RoomConfigSnapshot } from '#/server/configuration/operator-configuration'
import type { RoomRuntimeOverview } from '#/server/rooms/execution-types'
import { formatRelativeTime } from './-app-layout'
import type { ProviderApi, ProviderMode } from './-room-create-form'

export function SettingsSurface(props: {
    room: RoomRuntimeOverview
    roomConfig: RoomConfigSnapshot | undefined
    displayName: string
    setDisplayName: (value: string) => void
    slug: string
    setSlug: (value: string) => void
    instructions: string
    setInstructions: (value: string) => void
    providerMode: ProviderMode
    setProviderMode: (value: ProviderMode) => void
    providerConnectionId: string
    setProviderConnectionId: (value: string) => void
    provider: string
    setProvider: (value: string) => void
    providerApi: ProviderApi
    setProviderApi: (value: ProviderApi) => void
    providerBaseUrl: string
    setProviderBaseUrl: (value: string) => void
    providerModel: string
    setProviderModel: (value: string) => void
    providerApiKey: string
    setProviderApiKey: (value: string) => void
    toolsProfile: string
    setToolsProfile: (value: string) => void
    cronTimezone: string
    setCronTimezone: (value: string) => void
    selectedMcpIds: string[]
    toggleMcp: (id: string) => void
    secretLabel: string
    setSecretLabel: (value: string) => void
    secretEnvKey: string
    setSecretEnvKey: (value: string) => void
    secretValue: string
    setSecretValue: (value: string) => void
    secretPurpose: 'provider_api_key' | 'generic' | 'webhook'
    setSecretPurpose: (value: 'provider_api_key' | 'generic' | 'webhook') => void
    onSaveSettings: (event: FormEvent<HTMLFormElement>) => void
    onSaveSecret: (event: FormEvent<HTMLFormElement>) => void
    savePending: boolean
    secretPending: boolean
}) {
    const providers = props.roomConfig?.providers ?? []
    const mcpConnections = props.roomConfig?.mcpConnections ?? []
    const roomSecrets = props.roomConfig?.roomSecrets ?? []

    return (
        <section className="settings-layout">
            <section className="surface span-wide">
                <div className="surface-heading">
                    <div>
                        <h2>{props.room.displayName} settings</h2>
                        <p>Room identity, instructions, model, tools, and secrets.</p>
                    </div>
                    <Settings size={19} />
                </div>
                <form className="form-grid" onSubmit={props.onSaveSettings}>
                    <label>
                        Room name
                        <input
                            value={props.displayName}
                            onChange={(event) => props.setDisplayName(event.target.value)}
                        />
                    </label>
                    <label>
                        Slug
                        <input
                            value={props.slug}
                            onChange={(event) => props.setSlug(event.target.value)}
                        />
                    </label>
                    <label className="span-full">
                        Instructions
                        <textarea
                            value={props.instructions}
                            onChange={(event) => props.setInstructions(event.target.value)}
                        />
                    </label>
                    <label>
                        Model connection
                        <select
                            value={props.providerMode}
                            onChange={(event) =>
                                props.setProviderMode(event.target.value as ProviderMode)
                            }
                        >
                            <option value="app_default">Use app default</option>
                            <option value="app_connection">Choose saved connection</option>
                            <option value="room_secret">Use room key</option>
                        </select>
                    </label>
                    {props.providerMode === 'app_connection' ? (
                        <label>
                            Saved connection
                            <select
                                value={props.providerConnectionId}
                                onChange={(event) =>
                                    props.setProviderConnectionId(event.target.value)
                                }
                            >
                                <option value="">Choose connection</option>
                                {providers.map((provider) => (
                                    <option key={provider.id} value={provider.id}>
                                        {provider.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                    ) : null}
                    {props.providerMode === 'room_secret' ? (
                        <>
                            <label>
                                Provider
                                <input
                                    value={props.provider}
                                    onChange={(event) => props.setProvider(event.target.value)}
                                />
                            </label>
                            <label>
                                Provider type
                                <select
                                    value={props.providerApi}
                                    onChange={(event) =>
                                        props.setProviderApi(event.target.value as ProviderApi)
                                    }
                                >
                                    <option value="openai-completions">OpenAI compatible</option>
                                    <option value="openai-responses">OpenAI responses</option>
                                    <option value="anthropic-messages">Anthropic</option>
                                    <option value="google-generative-ai">Google</option>
                                </select>
                            </label>
                            <label>
                                Custom endpoint
                                <input
                                    value={props.providerBaseUrl}
                                    onChange={(event) =>
                                        props.setProviderBaseUrl(event.target.value)
                                    }
                                    placeholder="Optional"
                                />
                            </label>
                            <label>
                                Model
                                <input
                                    value={props.providerModel}
                                    onChange={(event) => props.setProviderModel(event.target.value)}
                                />
                            </label>
                            <label className="span-full">
                                Replace API key
                                <input
                                    type="password"
                                    value={props.providerApiKey}
                                    onChange={(event) =>
                                        props.setProviderApiKey(event.target.value)
                                    }
                                    placeholder={
                                        props.roomConfig?.config.hasRoomProviderSecret
                                            ? 'Leave blank to keep masked key'
                                            : ''
                                    }
                                />
                            </label>
                        </>
                    ) : null}
                    <label>
                        Tool profile
                        <select
                            value={props.toolsProfile}
                            onChange={(event) => props.setToolsProfile(event.target.value)}
                        >
                            <option value="coding">Coding</option>
                            <option value="research">Research</option>
                            <option value="ops">Operations</option>
                        </select>
                    </label>
                    <label>
                        Job timezone
                        <input
                            value={props.cronTimezone}
                            onChange={(event) => props.setCronTimezone(event.target.value)}
                        />
                    </label>
                    <fieldset className="span-full option-box">
                        <legend>Connected tools</legend>
                        {mcpConnections.length === 0 ? <p>No shared tools saved.</p> : null}
                        {mcpConnections.map((connection) => (
                            <label key={connection.id} className="check-row">
                                <input
                                    type="checkbox"
                                    checked={props.selectedMcpIds.includes(connection.id)}
                                    onChange={() => props.toggleMcp(connection.id)}
                                />
                                <span>
                                    <strong>{connection.name}</strong>
                                    <small>{connection.serverKey}</small>
                                </span>
                            </label>
                        ))}
                    </fieldset>
                    <button
                        type="submit"
                        className="button primary span-full"
                        disabled={props.savePending}
                    >
                        <Save size={17} />
                        Save room settings
                    </button>
                </form>
            </section>

            <section className="surface">
                <div className="surface-heading">
                    <div>
                        <h2>Room secrets</h2>
                        <p>Write-only after save.</p>
                    </div>
                    <KeyRound size={19} />
                </div>
                <form className="form-grid single" onSubmit={props.onSaveSecret}>
                    <label>
                        Label
                        <input
                            value={props.secretLabel}
                            onChange={(event) => props.setSecretLabel(event.target.value)}
                        />
                    </label>
                    <label>
                        Environment key
                        <input
                            value={props.secretEnvKey}
                            onChange={(event) => props.setSecretEnvKey(event.target.value)}
                        />
                    </label>
                    <label>
                        Purpose
                        <select
                            value={props.secretPurpose}
                            onChange={(event) =>
                                props.setSecretPurpose(
                                    event.target.value as
                                        | 'provider_api_key'
                                        | 'generic'
                                        | 'webhook',
                                )
                            }
                        >
                            <option value="generic">Generic</option>
                            <option value="provider_api_key">Provider key</option>
                            <option value="webhook">Webhook</option>
                        </select>
                    </label>
                    <label>
                        Secret value
                        <input
                            type="password"
                            value={props.secretValue}
                            onChange={(event) => props.setSecretValue(event.target.value)}
                        />
                    </label>
                    <button
                        type="submit"
                        className="button primary"
                        disabled={
                            props.secretPending ||
                            !props.secretLabel.trim() ||
                            !props.secretEnvKey.trim() ||
                            !props.secretValue
                        }
                    >
                        <KeyRound size={17} />
                        Save secret
                    </button>
                </form>
            </section>

            <section className="surface">
                <div className="surface-heading">
                    <div>
                        <h2>Saved secrets</h2>
                        <p>{roomSecrets.length} masked secrets</p>
                    </div>
                </div>
                <div className="stack-list">
                    {roomSecrets.length === 0 ? (
                        <p className="muted">No room secrets saved.</p>
                    ) : null}
                    {roomSecrets.map((secret) => (
                        <article key={secret.id} className="plain-row">
                            <KeyRound size={18} />
                            <span>
                                <strong>{secret.label}</strong>
                                <small>
                                    {secret.envKey} · {secret.purpose} ·{' '}
                                    {formatRelativeTime(secret.updatedAt)}
                                </small>
                            </span>
                            <span className="pill ready">Masked</span>
                        </article>
                    ))}
                </div>
            </section>
        </section>
    )
}
