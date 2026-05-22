export function resolveAbortDecision(input: {
    requestedRunId: string | null
    activeRunId: string | null
}): {
    shouldAbort: boolean
    abortedRunId: string | null
    status: 'aborted' | 'no-active-run' | 'run-mismatch'
} {
    if (input.requestedRunId && input.requestedRunId !== input.activeRunId) {
        return {
            shouldAbort: false,
            abortedRunId: null,
            status: 'run-mismatch',
        }
    }

    return {
        shouldAbort: input.activeRunId !== null,
        abortedRunId: input.activeRunId,
        status: input.activeRunId ? 'aborted' : 'no-active-run',
    }
}
