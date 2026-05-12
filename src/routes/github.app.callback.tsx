import { useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Loader2Icon } from 'lucide-react'
import { AttentionBanner, PageHeader, Section, StateBadge } from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import { roomQueryKey } from '#/lib/room-query-keys'
import { completeGitHubAppManifestServer } from './-operator-config-server'
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
    const mutation = useMutation({
        mutationFn: () =>
            completeGitHubAppManifestServer({
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
        if (search.code && search.state && mutation.isIdle) {
            mutation.mutate()
        }
    }, [mutation, search.code, search.state])

    const missingParams = !search.code || !search.state
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
                ) : mutation.isPending ? (
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
                ) : (
                    <Section
                        title="GitHub App ready"
                        description="Programmer rooms can now bind repositories."
                    >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <StateBadge tone="ready" label="Ready" />
                            <Button asChild>
                                <Link to="/settings">Back to settings</Link>
                            </Button>
                        </div>
                    </Section>
                )}
            </div>
        </div>
    )
}
