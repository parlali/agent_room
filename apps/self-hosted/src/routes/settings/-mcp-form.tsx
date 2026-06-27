import type { FormEvent } from 'react'
import { WrenchIcon } from 'lucide-react'

import { Textarea } from '#/components/ui/textarea'

import { TRANSPORT_OPTIONS, type McpAuthMode, type McpFormState } from './-form-model'
import {
    CredentialField as MaskedSecretField,
    FieldGroup,
    FormShell,
    SelectField,
    TextField,
} from '#/components/agent-room/form'

export function McpForm({
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
