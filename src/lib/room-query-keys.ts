export const roomQueryKey = {
    authUser: ['auth', 'current-user'] as const,
    operatorConfig: ['operator-config'] as const,
    roomsList: ['rooms', 'list'] as const,
    setupReadiness: ['rooms', 'setup-readiness'] as const,
    globalUsage: (limit?: number) => ['usage', 'global', limit ?? 'default'] as const,
    githubInstallationRepositories: (installationId: string, search: string, page: number) =>
        ['github', 'installation-repositories', installationId, search, page] as const,
    roomExecution: (roomId: string) => ['rooms', roomId, 'execution'] as const,
    roomSidebar: (roomId: string) => ['rooms', roomId, 'sidebar'] as const,
    roomConfig: (roomId: string) => ['rooms', roomId, 'config'] as const,
    roomCodexOAuthSession: (roomId: string) => ['rooms', roomId, 'codex-oauth-session'] as const,
    roomCronJobs: (roomId: string) => ['rooms', roomId, 'cron-jobs'] as const,
    roomFiles: (roomId: string) => ['rooms', roomId, 'files'] as const,
    roomFileTree: (roomId: string) => ['rooms', roomId, 'file-tree'] as const,
    roomDirectory: (roomId: string, surface?: string, path?: string) =>
        surface === undefined
            ? (['rooms', roomId, 'directory'] as const)
            : (['rooms', roomId, 'directory', surface, path ?? ''] as const),
    roomFilePreview: (roomId: string, surface?: string | null, path?: string | null) =>
        surface === undefined
            ? (['rooms', roomId, 'file-preview'] as const)
            : (['rooms', roomId, 'file-preview', surface ?? 'none', path ?? 'none'] as const),
    roomMemory: (roomId: string) => ['rooms', roomId, 'memory'] as const,
    roomPersonality: (roomId: string) => ['rooms', roomId, 'personality'] as const,
    roomUsage: (roomId: string, scope?: string) =>
        ['rooms', roomId, 'usage', scope ?? 'room'] as const,
    roomRunHistory: (roomId: string) => ['rooms', roomId, 'run-history'] as const,
    roomTruth: (roomId: string) => ['rooms', roomId, 'truth'] as const,
    sessionShell: (roomId: string, sessionKey: string) =>
        ['rooms', roomId, 'sessions', sessionKey, 'shell'] as const,
    sessionWindow: (roomId: string, sessionKey: string) =>
        ['rooms', roomId, 'sessions', sessionKey, 'window'] as const,
    sessionArtifacts: (roomId: string, sessionKey: string) =>
        ['rooms', roomId, 'sessions', sessionKey, 'artifacts'] as const,
    sessionComposer: (roomId: string, sessionKey: string) =>
        ['rooms', roomId, 'sessions', sessionKey, 'composer'] as const,
    sessionStream: (roomId: string, sessionKey: string) =>
        ['rooms', roomId, 'sessions', sessionKey, 'stream'] as const,
}

export const roomQueryPolicy = {
    hotStaleMs: 5_000,
    warmStaleMs: 30_000,
    coldStaleMs: 60_000,
    retainedSessionMs: 5 * 60_000,
    sidebarPollMs: 60_000,
}
