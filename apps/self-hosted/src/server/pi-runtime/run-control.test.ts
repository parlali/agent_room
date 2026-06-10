import { describe, expect, it } from 'vitest'
import { resolveAbortDecision } from './run-control'

describe('Pi runtime run control', () => {
    it('fails closed when an abort request targets a stale run id', () => {
        expect(
            resolveAbortDecision({
                requestedRunId: 'old-run',
                activeRunId: 'new-run',
            }),
        ).toEqual({
            shouldAbort: false,
            abortedRunId: null,
            status: 'run-mismatch',
        })
    })

    it('allows current-run and no-run abort decisions', () => {
        expect(
            resolveAbortDecision({
                requestedRunId: 'run-1',
                activeRunId: 'run-1',
            }),
        ).toEqual({
            shouldAbort: true,
            abortedRunId: 'run-1',
            status: 'aborted',
        })
        expect(
            resolveAbortDecision({
                requestedRunId: null,
                activeRunId: null,
            }),
        ).toEqual({
            shouldAbort: false,
            abortedRunId: null,
            status: 'no-active-run',
        })
    })
})
