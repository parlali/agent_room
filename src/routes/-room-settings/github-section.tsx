import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { GitBranchIcon, RefreshCwIcon } from 'lucide-react'
import {
    AttentionBanner,
    EmptyState,
    LoadingRows,
    Section,
    StateBadge,
} from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import { Label } from '#/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '#/components/ui/select'
import { Switch } from '#/components/ui/switch'
import { describeProviderStatus } from '#/lib/state'
import {
    listGitHubInstallationRepositoriesServer,
    refreshGitHubInstallationsServer,
} from '#/routes/-operator-config-server'
import type { OperatorConfigSnapshot } from '#/server/configuration/operator-configuration'
import type { ConfigDraft } from './model'
import { SaveBar } from './shared'

export function GitHubSection({
    draft,
    github,
    onChange,
    onSave,
    dirty,
    pending,
}: {
    draft: ConfigDraft
    github: OperatorConfigSnapshot['github'] | null
    onChange: (patch: Partial<ConfigDraft>) => void
    onSave: () => void
    dirty: boolean
    pending: boolean
}) {
    const queryClient = useQueryClient()
    const installations = github?.installations ?? []
    const app = github?.app ?? null
    const selectedInstallation =
        installations.find(
            (installation) => installation.installationId === draft.githubInstallationId,
        ) ?? null
    const repositoriesQuery = useQuery({
        queryKey: ['github-installation-repositories', draft.githubInstallationId],
        queryFn: () =>
            listGitHubInstallationRepositoriesServer({
                data: {
                    installationId: draft.githubInstallationId,
                },
            }),
        enabled: draft.githubEnabled && Boolean(draft.githubInstallationId),
        staleTime: 30_000,
    })
    const refreshMutation = useMutation({
        mutationFn: () => refreshGitHubInstallationsServer(),
        onSuccess: async () => {
            toast.success('GitHub installations refreshed')
            await queryClient.invalidateQueries({ queryKey: ['operator-config'], exact: false })
        },
        onError: (error) =>
            toast.error(error instanceof Error ? error.message : 'GitHub refresh failed'),
    })
    const repositories = repositoriesQuery.data ?? []
    const toggleRepository = (repository: string, enabled: boolean) => {
        const next = enabled
            ? Array.from(new Set([...draft.githubRepositories, repository]))
            : draft.githubRepositories.filter((entry) => entry !== repository)
        onChange({ githubRepositories: next.sort((left, right) => left.localeCompare(right)) })
    }

    return (
        <Section
            title="GitHub"
            description="Room-scoped repository credentials for programmer work."
            actions={
                <div className="flex flex-wrap justify-end gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => refreshMutation.mutate()}
                        disabled={refreshMutation.isPending || !app?.configured}
                    >
                        <RefreshCwIcon
                            className={refreshMutation.isPending ? 'animate-spin' : ''}
                        />
                        Refresh
                    </Button>
                    <SaveBar dirty={dirty} pending={pending} onSave={onSave} />
                </div>
            }
        >
            {!app?.configured ? (
                <EmptyState
                    icon={GitBranchIcon}
                    title="GitHub App is not configured"
                    description="Create the first-party GitHub App in app settings before binding repositories."
                />
            ) : installations.length === 0 ? (
                <EmptyState
                    icon={GitBranchIcon}
                    title="No GitHub installations"
                    description="Install the GitHub App on repositories this programmer room should use."
                />
            ) : (
                <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                        <div>
                            <div className="text-sm font-medium">Enable GitHub</div>
                            <div className="text-xs text-muted-foreground">
                                Credentials are materialized only for this programmer room.
                            </div>
                        </div>
                        <Switch
                            checked={draft.githubEnabled}
                            onCheckedChange={(enabled) =>
                                onChange({
                                    githubEnabled: enabled,
                                    githubInstallationId:
                                        draft.githubInstallationId ||
                                        installations[0]?.installationId ||
                                        '',
                                })
                            }
                            aria-label="Enable GitHub for this room"
                        />
                    </div>

                    {draft.githubEnabled ? (
                        <>
                            <div className="space-y-1.5">
                                <Label htmlFor="github-installation">Installation</Label>
                                <Select
                                    value={draft.githubInstallationId}
                                    onValueChange={(installationId) =>
                                        onChange({
                                            githubInstallationId: installationId,
                                            githubRepositories: [],
                                        })
                                    }
                                >
                                    <SelectTrigger id="github-installation" className="w-full">
                                        <SelectValue placeholder="Pick an installation" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {installations.map((installation) => {
                                            const status = describeProviderStatus(
                                                installation.status,
                                            )
                                            return (
                                                <SelectItem
                                                    key={installation.installationId}
                                                    value={installation.installationId}
                                                >
                                                    {installation.accountLogin} · {status.label}
                                                </SelectItem>
                                            )
                                        })}
                                    </SelectContent>
                                </Select>
                            </div>

                            {selectedInstallation ? (
                                <div className="space-y-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <StateBadge
                                            tone={
                                                describeProviderStatus(selectedInstallation.status)
                                                    .tone
                                            }
                                            label={
                                                describeProviderStatus(selectedInstallation.status)
                                                    .label
                                            }
                                        />
                                        <span className="text-xs text-muted-foreground">
                                            {selectedInstallation.repositorySelection} repositories
                                        </span>
                                    </div>
                                    {repositoriesQuery.isLoading ? (
                                        <LoadingRows count={3} />
                                    ) : repositoriesQuery.isError ? (
                                        <AttentionBanner
                                            tone="danger"
                                            title="Could not load repositories"
                                            description={
                                                repositoriesQuery.error instanceof Error
                                                    ? repositoriesQuery.error.message
                                                    : 'Unexpected GitHub repository error'
                                            }
                                        />
                                    ) : repositories.length === 0 ? (
                                        <EmptyState
                                            icon={GitBranchIcon}
                                            title="No repositories available"
                                            description="Update the GitHub App installation to include at least one repository."
                                        />
                                    ) : (
                                        <ul className="max-h-72 divide-y divide-border/60 overflow-auto rounded-md border">
                                            {repositories.map((repository) => {
                                                const checked = draft.githubRepositories.includes(
                                                    repository.fullName,
                                                )
                                                return (
                                                    <li
                                                        key={repository.id}
                                                        className="flex items-center gap-3 px-4 py-3"
                                                    >
                                                        <div className="min-w-0 flex-1">
                                                            <div className="truncate text-sm font-medium">
                                                                {repository.fullName}
                                                            </div>
                                                            <div className="text-xs text-muted-foreground">
                                                                {repository.private
                                                                    ? 'Private'
                                                                    : 'Public'}
                                                                {repository.defaultBranch
                                                                    ? ` · ${repository.defaultBranch}`
                                                                    : ''}
                                                            </div>
                                                        </div>
                                                        <Switch
                                                            checked={checked}
                                                            onCheckedChange={(enabled) =>
                                                                toggleRepository(
                                                                    repository.fullName,
                                                                    enabled,
                                                                )
                                                            }
                                                            aria-label={`Toggle ${repository.fullName}`}
                                                        />
                                                    </li>
                                                )
                                            })}
                                        </ul>
                                    )}
                                </div>
                            ) : null}
                        </>
                    ) : null}
                </div>
            )}
        </Section>
    )
}
