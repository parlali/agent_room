import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CopyIcon, ExternalLinkIcon, Loader2Icon, SignalHighIcon, XIcon } from 'lucide-react'
import { AttentionBanner, Section, StateBadge } from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { copyText } from '#/lib/clipboard'
import {
    cancelCodexOAuthSessionServer,
    getCodexOAuthSessionServer,
    startCodexOAuthSessionServer,
    submitCodexOAuthRedirectServer,
} from '#/routes/-operator-config-server'

export function CodexOAuthSection({ roomId }: { roomId: string }) {
    const queryClient = useQueryClient()
    const [redirectUrl, setRedirectUrl] = useState('')

    const sessionQuery = useQuery({
        queryKey: ['codex-oauth-session', roomId],
        queryFn: () => getCodexOAuthSessionServer({ data: { roomId } }),
        refetchInterval: (query) => {
            const data = query.state.data
            return data && ['starting', 'awaiting_redirect', 'submitting'].includes(data.status)
                ? 3000
                : false
        },
    })

    const session = sessionQuery.data ?? null
    const status = session?.status ?? 'idle'

    const copyAuthUrl = async (authUrl: string) => {
        try {
            await copyText(authUrl)
            toast.success('OpenAI sign-in link copied')
        } catch {
            toast.error('Could not copy sign-in link')
        }
    }

    useEffect(() => {
        if (status !== 'awaiting_redirect') {
            setRedirectUrl('')
        }
    }, [status])

    const startMutation = useMutation({
        mutationFn: () => startCodexOAuthSessionServer({ data: { roomId } }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({
                queryKey: ['codex-oauth-session', roomId],
            })
        },
        onError: (e: unknown) =>
            toast.error('Could not start OpenAI sign-in', {
                description: e instanceof Error ? e.message : 'Unexpected error',
            }),
    })

    const submitMutation = useMutation({
        mutationFn: (value: string) =>
            submitCodexOAuthRedirectServer({
                data: { roomId, redirectUrl: value },
            }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({
                queryKey: ['codex-oauth-session', roomId],
            })
        },
        onError: (e: unknown) =>
            toast.error('Could not submit redirect URL', {
                description: e instanceof Error ? e.message : 'Unexpected error',
            }),
    })

    const cancelMutation = useMutation({
        mutationFn: () => cancelCodexOAuthSessionServer({ data: { roomId } }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({
                queryKey: ['codex-oauth-session', roomId],
            })
            toast.message('OpenAI sign-in cancelled')
        },
        onError: (e: unknown) =>
            toast.error('Could not cancel sign-in', {
                description: e instanceof Error ? e.message : 'Unexpected error',
            }),
    })

    const isActive = status !== 'idle' && status !== 'complete'

    return (
        <Section
            title="OpenAI Codex OAuth"
            description="Sign in once for this room. Tokens never leave the host."
            actions={
                isActive ? (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => cancelMutation.mutate()}
                        disabled={cancelMutation.isPending}
                    >
                        {cancelMutation.isPending ? (
                            <Loader2Icon className="animate-spin" />
                        ) : (
                            <XIcon />
                        )}
                        Cancel
                    </Button>
                ) : null
            }
        >
            <div className="space-y-3">
                {status === 'idle' ? (
                    <Button
                        onClick={() => startMutation.mutate()}
                        disabled={startMutation.isPending}
                    >
                        {startMutation.isPending ? (
                            <Loader2Icon className="animate-spin" />
                        ) : (
                            <SignalHighIcon />
                        )}
                        Connect with OpenAI
                    </Button>
                ) : null}

                {status === 'starting' ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2Icon className="size-4 animate-spin" />
                        Preparing sign-in
                    </div>
                ) : null}

                {status === 'awaiting_redirect' && session ? (
                    <div className="space-y-3">
                        {session.authUrl ? (
                            <div className="flex flex-wrap items-center gap-2">
                                <a
                                    href={session.authUrl}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                                >
                                    Open OpenAI sign-in
                                    <ExternalLinkIcon className="size-3.5" />
                                </a>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void copyAuthUrl(session.authUrl as string)}
                                >
                                    <CopyIcon />
                                    Copy link
                                </Button>
                            </div>
                        ) : null}
                        <p className="text-xs text-muted-foreground">
                            After signing in, copy the full redirect URL the browser shows (it
                            includes <code>code</code> and <code>state</code>) and paste it below.
                        </p>
                        <form
                            className="flex flex-col gap-2 sm:flex-row sm:items-end"
                            onSubmit={(e) => {
                                e.preventDefault()
                                if (!redirectUrl.trim() || submitMutation.isPending) return
                                submitMutation.mutate(redirectUrl.trim())
                            }}
                        >
                            <div className="flex-1 space-y-1.5">
                                <Label htmlFor="codex-redirect-url">Redirect URL</Label>
                                <Input
                                    id="codex-redirect-url"
                                    value={redirectUrl}
                                    onChange={(e) => setRedirectUrl(e.target.value)}
                                    placeholder="http://localhost:1455/auth/callback?code=...&state=..."
                                    required
                                />
                            </div>
                            <Button
                                type="submit"
                                disabled={!redirectUrl.trim() || submitMutation.isPending}
                            >
                                {submitMutation.isPending ? (
                                    <Loader2Icon className="animate-spin" />
                                ) : null}
                                Submit
                            </Button>
                        </form>
                    </div>
                ) : null}

                {status === 'submitting' ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2Icon className="size-4 animate-spin" />
                        Verifying with OpenAI
                    </div>
                ) : null}

                {status === 'complete' ? (
                    <div className="flex items-center gap-2">
                        <StateBadge tone="ready" label="Connected" />
                        <span className="text-sm text-muted-foreground">
                            {session?.message ?? 'OpenAI Codex profile is ready for this room.'}
                        </span>
                    </div>
                ) : null}

                {status === 'failed' || status === 'expired' || status === 'cancelled' ? (
                    <div className="space-y-2">
                        <AttentionBanner
                            tone={status === 'cancelled' ? 'muted' : 'danger'}
                            title={
                                status === 'failed'
                                    ? 'OpenAI sign-in failed'
                                    : status === 'expired'
                                      ? 'OpenAI sign-in expired'
                                      : 'OpenAI sign-in cancelled'
                            }
                            description={session?.message ?? null}
                        />
                        <Button
                            onClick={() => startMutation.mutate()}
                            disabled={startMutation.isPending}
                        >
                            {startMutation.isPending ? (
                                <Loader2Icon className="animate-spin" />
                            ) : (
                                <SignalHighIcon />
                            )}
                            Try again
                        </Button>
                    </div>
                ) : null}
            </div>
        </Section>
    )
}
