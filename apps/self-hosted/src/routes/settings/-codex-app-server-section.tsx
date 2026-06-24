import { ClipboardIcon, ExternalLinkIcon } from 'lucide-react'

import { LoadingRows, Section, StateBadge } from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import { describeProviderStatus } from '#/domain/state'
import type {
    CodexDeviceAuthSessionSnapshot,
    OperatorConfigSnapshot,
} from '#/server/configuration/operator-configuration'

import { FieldGroup } from './-forms'

export function CodexAppServerSection({
    config,
    session,
    loading,
    startPending,
    cancelPending,
    hostedCredentialMode,
    onStart,
    onCancel,
}: {
    config: OperatorConfigSnapshot | undefined
    session: CodexDeviceAuthSessionSnapshot | undefined
    loading: boolean
    startPending: boolean
    cancelPending: boolean
    hostedCredentialMode?: boolean
    onStart: () => void
    onCancel: () => void
}) {
    const auth = session?.auth ?? config?.codexAuth
    const status = auth?.ready ? 'ready' : 'invalid'
    const described = describeProviderStatus(status)
    const active = session?.status === 'starting' || session?.status === 'awaiting_verification'
    const copyCode = () => {
        if (!session?.userCode) return
        void navigator.clipboard.writeText(session.userCode)
    }
    const actions = hostedCredentialMode ? undefined : active ? (
        <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onCancel}
            disabled={cancelPending}
        >
            Cancel
        </Button>
    ) : (
        <Button type="button" size="sm" onClick={onStart} disabled={loading || startPending}>
            <ExternalLinkIcon />
            {startPending ? 'Starting...' : auth?.ready ? 'Reauthorize' : 'Authorize'}
        </Button>
    )

    return (
        <Section
            title="Codex app server"
            description="Authorize the app once with OpenAI token verification."
            actions={actions}
        >
            <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                    <StateBadge tone={described.tone} label={described.label} />
                    <span className="text-sm text-muted-foreground">
                        {auth?.message ?? 'Codex app server login is missing'}
                    </span>
                </div>
                {session?.verificationUrl && session.userCode ? (
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                        <FieldGroup label="OpenAI verification code">
                            <div className="flex min-h-10 items-center rounded-md border border-border bg-muted/30 px-3 font-mono text-lg tracking-normal">
                                {session.userCode}
                            </div>
                        </FieldGroup>
                        <div className="flex flex-wrap gap-2">
                            <Button type="button" variant="outline" onClick={copyCode}>
                                <ClipboardIcon />
                                Copy
                            </Button>
                            <Button type="button" asChild>
                                <a href={session.verificationUrl} target="_blank" rel="noreferrer">
                                    <ExternalLinkIcon />
                                    Verify
                                </a>
                            </Button>
                        </div>
                    </div>
                ) : null}
                {active && !session?.verificationUrl ? <LoadingRows count={1} /> : null}
            </div>
        </Section>
    )
}
