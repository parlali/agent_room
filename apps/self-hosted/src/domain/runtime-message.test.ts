import { describe, expect, it } from 'vitest'
import { describeSessionState } from './state'
import {
    extractTextFromRuntimeContent,
    runtimeTextPhaseFromSignature,
    toRuntimeSerializable,
} from './runtime-message'

describe('runtime message helpers', () => {
    it('keeps runtime payloads JSON-compatible', () => {
        expect(
            toRuntimeSerializable({
                missing: undefined,
                infinite: Infinity,
                nested: [Number.NaN, 'ok'],
            }),
        ).toEqual({
            missing: null,
            infinite: null,
            nested: [null, 'ok'],
        })
    })

    it('does not expose provider thinking blocks as visible message text', () => {
        expect(
            extractTextFromRuntimeContent([
                {
                    type: 'thinking',
                    thinking: 'private chain of thought',
                },
                {
                    type: 'text',
                    text: 'visible answer',
                },
            ]),
        ).toBe('visible answer')
    })

    it('treats compaction as a visible working state', () => {
        expect(describeSessionState('compacting')).toEqual({
            label: 'Compacting',
            tone: 'working',
        })
    })

    it('extracts OpenAI text phases from runtime signatures', () => {
        expect(runtimeTextPhaseFromSignature('{"v":1,"id":"msg-1","phase":"commentary"}')).toBe(
            'commentary',
        )
        expect(runtimeTextPhaseFromSignature('{"v":1,"id":"msg-2","phase":"final_answer"}')).toBe(
            'final_answer',
        )
        expect(runtimeTextPhaseFromSignature('legacy-message-id')).toBeNull()
    })
})
