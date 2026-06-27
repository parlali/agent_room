import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { GitBranchIcon, RefreshCwIcon, SearchIcon, XIcon } from 'lucide-react'
import {
    AttentionBanner,
    EmptyState,
    LoadingRows,
    Section,
    StateBadge,
    ToggleSelector,
    mergeToggleSelectorItems,
} from '#/components/agent-room'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '#/components/ui/select'
import { Switch } from '#/components/ui/switch'
import { describeProviderStatus } from '#/domain/state'
import { roomQueryKey, roomQueryPolicy } from '#/lib/room-query-keys'
import {
    listGitHubInstallationRepositoriesServer,
    refreshGitHubInstallationsServer,
} from '#/routes/-operator-config-server'
import type { OperatorConfigSnapshot } from '#/server/configuration/operator-configuration'
import type { ConfigDraft } from './model'

type RepositorySelectorItem = {
    fullName: string
    private: boolean | null
    defaultBranch: string | null
}

export function GitHubSection({
    draft,
    github,
    onChange,
}: {
    draft: ConfigDraft
    github: OperatorConfigSnapshot['github'] | null
    onChange: (patch: Partial<ConfigDraft>) => void
}) {
    const queryClient = useQueryClient()
    const [repositorySearch, setRepositorySearch] = useState('')
    const [repositoryPage, setRepositoryPage] = useState(1)
    const installations = github?.installations ?? []
    const app = github?.app ?? null
    const selectedInstallation =
        installations.find(
            (installation) => installation.installationId === draft.githubInstallationId,
        ) ?? null
    const repositoriesQuery = useQuery({
        queryKey: roomQueryKey.githubInstallationRepositories(
            draft.githubInstallationId,
            repositorySearch,
            repositoryPage,
        ),
        queryFn: () =>
            listGitHubInstallationRepositoriesServer({
                data: {
                    installationId: draft.githubInstallationId,
                    query: repositorySearch,
                    page: repositoryPage,
                    pageSize: 25,
                },
            }),
        enabled: draft.githubEnabled && Boolean(draft.githubInstallationId),
        staleTime: roomQueryPolicy.warmStaleMs,
    })
    useEffect(() => {
        setRepositoryPage(1)
    }, [draft.githubInstallationId, repositorySearch])
    const refreshMutation = useMutation({
        mutationFn: () => refreshGitHubInstallationsServer(),
        onSuccess: async () => {
            toast.success('GitHub installations refreshed')
            await queryClient.invalidateQueries({
                queryKey: roomQueryKey.operatorConfig,
                exact: false,
            })
        },
        onError: (error) =>
            toast.error(error instanceof Error ? error.message : 'GitHub refresh failed'),
    })
    const repositoryResult = repositoriesQuery.data
    const repositories = repositoryResult?.repositories ?? []
    const repositoryRows = useMemo<RepositorySelectorItem[]>(
        () =>
            repositories.map((repository) => ({
                fullName: repository.fullName,
                private: repository.private,
                defaultBranch: repository.defaultBranch,
            })),
        [repositories],
    )
    const selectedRepositoryRows = useMemo<RepositorySelectorItem[]>(
        () =>
            draft.githubRepositories.map((repository) => ({
                fullName: repository,
                private: null,
                defaultBranch: null,
            })),
        [draft.githubRepositories],
    )
    const visibleRepositories = useMemo(() => {
        return mergeToggleSelectorItems({
            visibleItems: repositoryRows,
            selectedItems: selectedRepositoryRows,
            getValue: (repository) => repository.fullName,
        })
    }, [repositoryRows, selectedRepositoryRows])
    const toggleRepository = (repository: string, enabled: boolean) => {
        const next = enabled
            ? Array.from(new Set([...draft.githubRepositories, repository]))
            : draft.githubRepositories.filter((entry) => entry !== repository)
        onChange({ githubRepositories: next.sort((left, right) => left.localeCompare(right)) })
    }

    return (
        <Section
            title="GitHub"
            description="Room-scoped repository credentials."
            actions={
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => refreshMutation.mutate()}
                    disabled={refreshMutation.isPending || !app?.configured}
                >
                    <RefreshCwIcon className={refreshMutation.isPending ? 'animate-spin' : ''} />
                    Refresh
                </Button>
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
                    description="Install the GitHub App on repositories this room should use."
                />
            ) : (
                <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                        <div>
                            <div className="text-sm font-medium">Enable GitHub</div>
                            <div className="text-xs text-muted-foreground">
                                Credentials are materialized only for this room.
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
                                    <div className="relative">
                                        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                                        <Input
                                            value={repositorySearch}
                                            onChange={(event) =>
                                                setRepositorySearch(event.target.value)
                                            }
                                            placeholder="Search repositories"
                                            className="h-9 pl-9 pr-9"
                                        />
                                        {repositorySearch ? (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="absolute right-1 top-1/2 size-7 -translate-y-1/2"
                                                onClick={() => setRepositorySearch('')}
                                                aria-label="Clear repository search"
                                            >
                                                <XIcon />
                                            </Button>
                                        ) : null}
                                    </div>
                                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                                        <span>
                                            {draft.githubRepositories.length} selected
                                            {repositoryResult
                                                ? ` · ${repositoryResult.totalCount} available`
                                                : ''}
                                        </span>
                                        {repositoryResult?.scannedCount &&
                                        repositorySearch.trim() ? (
                                            <span>
                                                Scanned {repositoryResult.scannedCount} repositories
                                            </span>
                                        ) : null}
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
                                    ) : visibleRepositories.length === 0 ? (
                                        <EmptyState
                                            icon={GitBranchIcon}
                                            title="No repositories available"
                                            description={
                                                repositorySearch.trim()
                                                    ? 'No repositories matched this search.'
                                                    : 'Update the GitHub App installation to include at least one repository.'
                                            }
                                        />
                                    ) : (
                                        <div className="rounded-md border">
                                            <ToggleSelector
                                                items={visibleRepositories}
                                                selectedValues={draft.githubRepositories}
                                                getValue={(repository) => repository.fullName}
                                                getAriaLabel={(repository) =>
                                                    `Toggle ${repository.fullName}`
                                                }
                                                onCheckedChange={(repository, enabled) =>
                                                    toggleRepository(repository, enabled)
                                                }
                                                className="max-h-72 overflow-auto"
                                                renderItem={(repository) => (
                                                    <>
                                                        <div className="truncate text-sm font-medium">
                                                            {repository.fullName}
                                                        </div>
                                                        <div className="text-xs text-muted-foreground">
                                                            {repository.private === null
                                                                ? 'Selected'
                                                                : repository.private
                                                                  ? 'Private'
                                                                  : 'Public'}
                                                            {repository.defaultBranch
                                                                ? ` · ${repository.defaultBranch}`
                                                                : ''}
                                                        </div>
                                                    </>
                                                )}
                                            />
                                            {repositoryResult?.hasMore || repositoryPage > 1 ? (
                                                <div className="flex items-center justify-between gap-3 border-t px-4 py-2">
                                                    <span className="text-xs text-muted-foreground">
                                                        {repositorySearch.trim()
                                                            ? 'Refine search to narrow remaining repositories.'
                                                            : `Page ${repositoryPage}`}
                                                    </span>
                                                    {!repositorySearch.trim() ? (
                                                        <div className="flex items-center gap-2">
                                                            {repositoryPage > 1 ? (
                                                                <Button
                                                                    type="button"
                                                                    variant="outline"
                                                                    size="sm"
                                                                    onClick={() =>
                                                                        setRepositoryPage(
                                                                            repositoryPage - 1,
                                                                        )
                                                                    }
                                                                >
                                                                    Previous
                                                                </Button>
                                                            ) : null}
                                                            {repositoryResult?.nextPage ? (
                                                                <Button
                                                                    type="button"
                                                                    variant="outline"
                                                                    size="sm"
                                                                    onClick={() =>
                                                                        setRepositoryPage(
                                                                            repositoryResult.nextPage ??
                                                                                1,
                                                                        )
                                                                    }
                                                                >
                                                                    Next
                                                                </Button>
                                                            ) : null}
                                                        </div>
                                                    ) : null}
                                                </div>
                                            ) : null}
                                        </div>
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
