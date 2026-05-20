import { useEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ExternalLinkIcon, Loader2Icon } from 'lucide-react'
import { AttentionBanner, PageHeader, Section, StateBadge } from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import { roomQueryKey } from '#/lib/room-query-keys'
import { completeGitHubCallbackServer } from './-operator-config-server'
import { requireRouteUser } from './-route-auth'

export const Route = createFileRoute('/github/app/callback')({
    beforeLoad: requireRouteUser,
    validateSearch: (search: Record<string, unknown>) => ({
        code: typeof search.code === 'string' ? search.code : '',
        state: typeof search.state === 'string' ? search.state : '',
    }),
    component: GitHubAppCallbackPage,
})

function GitHubAppCallbackPage() {
    const search = Route.useSearch()
    const queryClient = useQueryClient()
    const submittedKeyRef = useRef<string | null>(null)
    const mutation = useMutation({
        mutationFn: () =>
            completeGitHubCallbackServer({
                data: {
                    code: search.code,
                    state: search.state,
                },
            }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({
                queryKey: roomQueryKey.operatorConfig,
                exact: false,
            })
            await queryClient.invalidateQueries({ queryKey: roomQueryKey.roomsList })
        },
    })

    useEffect(() => {
        if (!search.code || !search.state) return
        const submissionKey = `${search.state}:${search.code}`
        if (submittedKeyRef.current === submissionKey) return
        submittedKeyRef.current = submissionKey
        mutation.mutate()
    }, [mutation, search.code, search.state])

    const missingParams = !search.code || !search.state
    const github = mutation.data?.github
    const installationCount = github?.installations.length ?? 0
    const installUrl = github?.app.installUrl ?? null
    const connectedLogin = github?.user.login ?? null
    return (
        <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
            <PageHeader
                title="GitHub App"
                subtitle="Completing first-party GitHub setup."
                className="border-0 px-0 py-0"
            />
            <div className="mt-6">
                {missingParams ? (
                    <AttentionBanner
                        tone="danger"
                        title="GitHub callback is incomplete"
                        description="The callback did not include the setup code and state."
                    />
                ) : mutation.isPending || mutation.isIdle ? (
                    <Section
                        title="Finishing setup"
                        description="Exchanging GitHub app credentials."
                    >
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2Icon className="size-4 animate-spin" />
                            Finishing GitHub App setup
                        </div>
                    </Section>
                ) : mutation.isError ? (
                    <AttentionBanner
                        tone="danger"
                        title="GitHub setup failed"
                        description={
                            mutation.error instanceof Error
                                ? mutation.error.message
                                : 'Unexpected GitHub setup error'
                        }
                    />
                ) : mutation.data?.kind === 'user' ? (
                    <Section
                        title="GitHub connected"
                        description={
                            connectedLogin
                                ? `Connected as ${connectedLogin}.`
                                : 'GitHub account connection is ready.'
                        }
                    >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <StateBadge tone="ready" label="Connected" />
                            <Button asChild>
                                <Link
                                    to="/settings"
                                    search={{
                                        installationId: '',
                                        setupAction: '',
                                        githubState: '',
                                    }}
                                >
                                    Back to settings
                                </Link>
                            </Button>
                        </div>
                    </Section>
                ) : installationCount === 0 ? (
                    <Section
                        title="GitHub App created"
                        description="Install it on repositories before binding rooms."
                    >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <StateBadge tone="ready" label="Ready" />
                            <div className="flex flex-wrap justify-end gap-2">
                                {installUrl ? (
                                    <Button asChild variant="outline">
                                        <a href={installUrl}>
                                            <ExternalLinkIcon />
                                            Install
                                        </a>
                                    </Button>
                                ) : null}
                                <Button asChild>
                                    <Link
                                        to="/settings"
                                        search={{
                                            installationId: '',
                                            setupAction: '',
                                            githubState: '',
                                        }}
                                    >
                                        Back to settings
                                    </Link>
                                </Button>
                            </div>
                        </div>
                    </Section>
                ) : (
                    <Section
                        title="GitHub App ready"
                        description="Programmer rooms can now bind repositories."
                    >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <StateBadge tone="ready" label="Ready" />
                            <Button asChild>
                                <Link
                                    to="/settings"
                                    search={{
                                        installationId: '',
                                        setupAction: '',
                                        githubState: '',
                                    }}
                                >
                                    Back to settings
                                </Link>
                            </Button>
                        </div>
                    </Section>
                )}
            </div>
        </div>
    )
}
