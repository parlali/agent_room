import { describe, expect, it } from 'vitest'

import {
    estimateHostedManagedModelCostMicros,
    hostedManagedModelInputCostMicrosPerMillionTokens,
    hostedManagedModelOutputCostMicrosPerMillionTokens,
    hostedManagedModelPreflightSpendEstimateCents,
    hostedManagedModelRequestReservationDefaultCents,
} from './hosted-model-policy'

describe('estimateHostedManagedModelCostMicros', () => {
    it('returns null when no token counts are present', () => {
        expect(
            estimateHostedManagedModelCostMicros({
                inputTokens: null,
                cachedTokens: null,
                outputTokens: null,
                reasoningTokens: null,
            }),
        ).toBeNull()
        expect(
            estimateHostedManagedModelCostMicros({
                inputTokens: 0,
                cachedTokens: 0,
                outputTokens: 0,
                reasoningTokens: 0,
            }),
        ).toBeNull()
    })

    it('prices prompt tokens at the input rate and completion tokens at the output rate', () => {
        const micros = estimateHostedManagedModelCostMicros({
            inputTokens: 1_000_000,
            cachedTokens: 0,
            outputTokens: 1_000_000,
            reasoningTokens: 0,
        })
        expect(micros).toBe(
            hostedManagedModelInputCostMicrosPerMillionTokens +
                hostedManagedModelOutputCostMicrosPerMillionTokens,
        )
    })

    it('treats cached and reasoning tokens as subsets and never double-counts them', () => {
        const micros = estimateHostedManagedModelCostMicros({
            inputTokens: 1_000_000,
            cachedTokens: 600_000,
            outputTokens: 1_000_000,
            reasoningTokens: 400_000,
        })
        expect(micros).toBe(
            hostedManagedModelInputCostMicrosPerMillionTokens +
                hostedManagedModelOutputCostMicrosPerMillionTokens,
        )
    })

    it('falls back to the subset counts when only cached or reasoning tokens are reported', () => {
        const micros = estimateHostedManagedModelCostMicros({
            inputTokens: null,
            cachedTokens: 1_000_000,
            outputTokens: null,
            reasoningTokens: 1_000_000,
        })
        expect(micros).toBe(
            hostedManagedModelInputCostMicrosPerMillionTokens +
                hostedManagedModelOutputCostMicrosPerMillionTokens,
        )
    })

    it('estimates a realistic small cost for a typical short reply (no leak fallback)', () => {
        const micros = estimateHostedManagedModelCostMicros({
            inputTokens: 1200,
            cachedTokens: 0,
            outputTokens: 40,
            reasoningTokens: 10,
        })
        expect(micros).not.toBeNull()
        expect(micros!).toBeGreaterThan(0)
        expect(micros!).toBeLessThan(10_000)
    })
})

describe('hosted managed spend-cap invariants', () => {
    it('keeps the preflight spend estimate well below the per-request reservation', () => {
        expect(hostedManagedModelPreflightSpendEstimateCents).toBeGreaterThan(0)
        expect(hostedManagedModelPreflightSpendEstimateCents).toBeLessThan(
            hostedManagedModelRequestReservationDefaultCents,
        )
    })
})
