export interface RefreshableSession {
    reload: () => Promise<void>
}

export interface RefreshableActiveThread {
    session: RefreshableSession
    promptVersion: number
}

export interface SystemPromptRefresherOptions {
    build: () => Promise<string>
    inputSignature: () => Promise<string | null>
}

export interface SystemPromptRefresher {
    initialize: () => Promise<void>
    current: () => string
    currentVersion: () => number
    refresh: (active?: RefreshableActiveThread) => Promise<void>
}

export function createSystemPromptRefresher(
    options: SystemPromptRefresherOptions,
): SystemPromptRefresher {
    let prompt = ''
    let promptSignature: string | null = null
    let version = 0
    let initialized = false
    let rebuildChain: Promise<void> = Promise.resolve()

    async function performRebuild(): Promise<void> {
        let signature: string | null
        try {
            signature = await options.inputSignature()
        } catch {
            signature = null
        }
        if (initialized && signature !== null && signature === promptSignature) {
            return
        }
        prompt = await options.build()
        promptSignature = signature
        version += 1
        initialized = true
    }

    function rebuildCanonicalIfStale(): Promise<void> {
        const run = rebuildChain.then(performRebuild, performRebuild)
        rebuildChain = run.then(
            () => undefined,
            () => undefined,
        )
        return run
    }

    return {
        initialize: rebuildCanonicalIfStale,
        current: () => {
            if (!initialized) {
                throw new Error('System prompt requested before refresher initialization')
            }
            return prompt
        },
        currentVersion: () => version,
        refresh: async (active) => {
            await rebuildCanonicalIfStale()
            if (active && active.promptVersion !== version) {
                await active.session.reload()
                active.promptVersion = version
            }
        },
    }
}
