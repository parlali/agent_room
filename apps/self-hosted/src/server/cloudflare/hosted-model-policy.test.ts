import { describe, expect, it } from 'vitest'

import {
    estimateHostedManagedModelCostMicros,
    hostedManagedModelInputCostMicrosPerMillionTokens,
    hostedManagedModelOutputCostMicrosPerMillionTokens,
    hostedManagedModelPreflightSpendEstimateCents,
    hostedManagedModelRequestReservationCents,
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

    it('counts cached tokens as prompt and reasoning tokens as completion', () => {
        const micros = estimateHostedManagedModelCostMicros({
            inputTokens: 500_000,
            cachedTokens: 500_000,
            outputTokens: 500_000,
            reasoningTokens: 500_000,
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
            hostedManagedModelRequestReservationCents,
        )
    })
})
