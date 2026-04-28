import { Plus } from 'lucide-react'
import type { FormEvent } from 'react'
import type {
    McpConnectionSummary,
    ProviderConnectionSummary,
} from '#/server/configuration/operator-configuration'
import type { RoomSetupReadinessSnapshot } from '#/server/rooms/runtime-readiness'
import { friendlyNotice } from './-notice-copy'
import { jobSchedulePresets } from './-app-layout'

export type ProviderMode = 'app_default' | 'app_connection' | 'room_secret'
export type ProviderApi =
    | 'openai-responses'
    | 'openai-completions'
    | 'openai-codex-responses'
    | 'anthropic-messages'
    | 'google-generative-ai'

interface RoomCreateFormProps {
    blockingIssues: RoomSetupReadinessSnapshot['issues']
    createPending: boolean
    defaultProvider: ProviderConnectionSummary | undefined
    displayName: string
    initialJobEnabled: boolean
    initialJobEveryMinutes: string
    initialJobMessage: string
    initialJobName: string
    instructions: string
    mcpConnections: McpConnectionSummary[]
    notice: string | null
    onSubmit: (event: FormEvent<HTMLFormElement>) => void
    onToggleMcp: (id: string) => void
    provider: string
    providerApi: ProviderApi
    providerApiKey: string
    providerBaseUrl: string
    providerConnectionId: string
    providerMode: ProviderMode
    providerModel: string
    providers: ProviderConnectionSummary[]
    selectedMcpIds: string[]
    selectedProviderUsesOAuth: boolean
    setCronTimezone: (value: string) => void
    setDisplayName: (value: string) => void
    setInitialJobEnabled: (value: boolean) => void
    setInitialJobEveryMinutes: (value: string) => void
    setInitialJobMessage: (value: string) => void
    setInitialJobName: (value: string) => void
    setInstructions: (value: string) => void
    setProvider: (value: string) => void
    setProviderApi: (value: ProviderApi) => void
    setProviderApiKey: (value: string) => void
    setProviderBaseUrl: (value: string) => void
    setProviderConnectionId: (value: string) => void
    setProviderMode: (value: ProviderMode) => void
    setProviderModel: (value: string) => void
    setSlug: (value: string) => void
    setStartImmediately: (value: boolean) => void
    setToolsProfile: (value: string) => void
    slug: string
    startImmediately: boolean
    toolsProfile: string
    cronTimezone: string
}

export function RoomCreateForm(props: RoomCreateFormProps) {
    const displayNotice = friendlyNotice(props.notice)

    return (
        <section id="create-room" className="surface form-surface">
            <div className="surface-heading">
                <div>
                    <h2>Create room</h2>
                    <p>Choose its purpose, model, tools, and first job.</p>
                </div>
                <Plus size={19} />
            </div>

            {displayNotice ? <p className="form-alert danger">{displayNotice}</p> : null}
            {props.blockingIssues.length > 0 ? (
                <div className="form-alert danger">
                    {props.blockingIssues.map((issue) => (
                        <p key={issue.code}>{issue.message}</p>
                    ))}
                </div>
            ) : null}
            {!props.defaultProvider && props.providerMode === 'app_default' ? (
                <p className="form-alert warning">Add an app model connection or use a room key.</p>
            ) : null}

            <form className="form-grid" onSubmit={props.onSubmit}>
                <label>
                    Room name
                    <input
                        value={props.displayName}
                        onChange={(event) => props.setDisplayName(event.target.value)}
                        placeholder="Startup"
                    />
                </label>
                <label>
                    Slug
                    <input
                        value={props.slug}
                        onChange={(event) => props.setSlug(event.target.value)}
                        placeholder="startup"
                    />
                </label>
                <label className="span-full">
                    What this room is for
                    <textarea
                        value={props.instructions}
                        onChange={(event) => props.setInstructions(event.target.value)}
                        placeholder="Work on investor updates, market research, and follow-ups."
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
                            onChange={(event) => props.setProviderConnectionId(event.target.value)}
                        >
                            <option value="">Choose connection</option>
                            {props.providers.map((entry) => (
                                <option key={entry.id} value={entry.id}>
                                    {entry.label}
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
                                onChange={(event) => props.setProviderBaseUrl(event.target.value)}
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
                            API key
                            <input
                                type="password"
                                value={props.providerApiKey}
                                onChange={(event) => props.setProviderApiKey(event.target.value)}
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
                    <legend>Tools</legend>
                    {props.mcpConnections.length === 0 ? <p>No shared tools saved.</p> : null}
                    {props.mcpConnections.map((connection) => (
                        <label key={connection.id} className="check-row">
                            <input
                                type="checkbox"
                                checked={props.selectedMcpIds.includes(connection.id)}
                                onChange={() => props.onToggleMcp(connection.id)}
                            />
                            <span>
                                <strong>{connection.name}</strong>
                                <small>{connection.serverKey}</small>
                            </span>
                        </label>
                    ))}
                </fieldset>
                <fieldset className="span-full option-box">
                    <legend>First job</legend>
                    <label className="check-row">
                        <input
                            type="checkbox"
                            checked={props.initialJobEnabled}
                            onChange={(event) => props.setInitialJobEnabled(event.target.checked)}
                        />
                        <span>
                            <strong>Add a scheduled job</strong>
                            <small>Optional</small>
                        </span>
                    </label>
                    {props.initialJobEnabled ? (
                        <div className="nested-grid">
                            <label>
                                Job name
                                <input
                                    value={props.initialJobName}
                                    onChange={(event) =>
                                        props.setInitialJobName(event.target.value)
                                    }
                                    placeholder="Daily brief"
                                />
                            </label>
                            <fieldset className="option-box span-full">
                                <legend>When should it run?</legend>
                                <div className="schedule-choice-grid">
                                    {jobSchedulePresets.map((preset) => (
                                        <label key={preset.value} className="schedule-option">
                                            <input
                                                type="radio"
                                                name="initial-job-schedule"
                                                checked={
                                                    preset.value === 'custom'
                                                        ? !jobSchedulePresets.some(
                                                              (entry) =>
                                                                  entry.value !== 'custom' &&
                                                                  entry.value ===
                                                                      props.initialJobEveryMinutes,
                                                          )
                                                        : props.initialJobEveryMinutes ===
                                                          preset.value
                                                }
                                                onChange={() => {
                                                    if (preset.value !== 'custom') {
                                                        props.setInitialJobEveryMinutes(
                                                            preset.value,
                                                        )
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
                                    value={props.initialJobEveryMinutes}
                                    onChange={(event) =>
                                        props.setInitialJobEveryMinutes(event.target.value)
                                    }
                                    aria-label="Custom interval in minutes"
                                />
                            </fieldset>
                            <label className="span-full">
                                Task
                                <textarea
                                    value={props.initialJobMessage}
                                    onChange={(event) =>
                                        props.setInitialJobMessage(event.target.value)
                                    }
                                    placeholder="Prepare the morning brief."
                                />
                            </label>
                        </div>
                    ) : null}
                </fieldset>
                <label className="check-row span-full">
                    <input
                        type="checkbox"
                        checked={props.startImmediately}
                        disabled={props.selectedProviderUsesOAuth}
                        onChange={(event) => props.setStartImmediately(event.target.checked)}
                    />
                    <span>
                        <strong>Start room after create</strong>
                        <small>
                            {props.selectedProviderUsesOAuth
                                ? 'Complete Codex login from the room status page'
                                : 'Runs when setup is ready'}
                        </small>
                    </span>
                </label>
                <button
                    type="submit"
                    className="button primary span-full"
                    disabled={props.createPending || !props.displayName.trim()}
                >
                    <Plus size={17} />
                    {props.createPending ? 'Creating room' : 'Create room'}
                </button>
            </form>
        </section>
    )
}
