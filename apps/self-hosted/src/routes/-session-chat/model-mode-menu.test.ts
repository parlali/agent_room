import { isValidElement, type ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import type { RoomExecutionModelState } from '#/domain/room-execution-types'
import { ModelModeMenu, type ModelModeChange } from './model-mode-menu'

type TestElementProps = {
    children?: ReactNode
    value?: string
    onValueChange?: (value: string) => void
}

function codexModelState(
    overrides: Partial<RoomExecutionModelState> = {},
): RoomExecutionModelState {
    return {
        value: 'openai-codex/gpt-5.5',
        provider: 'openai-codex',
        model: 'gpt-5.5',
        label: 'GPT-5.5',
        thinkingLevel: 'high',
        availableThinkingLevels: ['low', 'medium', 'high', 'xhigh'],
        speedMode: 'normal',
        availableSpeedModes: ['normal', 'fast'],
        options: [
            {
                value: 'openai-codex/gpt-5.5',
                provider: 'openai-codex',
                model: 'gpt-5.5',
                label: 'GPT-5.5',
                supportsReasoning: true,
                availableThinkingLevels: ['low', 'medium', 'high', 'xhigh'],
                availableSpeedModes: ['normal', 'fast'],
            },
            {
                value: 'openai-codex/gpt-5.3-codex-spark',
                provider: 'openai-codex',
                model: 'gpt-5.3-codex-spark',
                label: 'GPT-5.3 Codex Spark',
                supportsReasoning: true,
                availableThinkingLevels: ['low', 'medium', 'high'],
                availableSpeedModes: ['normal', 'fast'],
            },
        ],
        ...overrides,
    }
}

function renderMenu(state: RoomExecutionModelState, changes: ModelModeChange[] = []) {
    return ModelModeMenu({
        state,
        disabled: false,
        updating: false,
        onChange: (change) => changes.push(change),
    })
}

function collectText(node: ReactNode): string[] {
    if (node === null || node === undefined || typeof node === 'boolean') return []
    if (typeof node === 'string' || typeof node === 'number') return [String(node)]
    if (Array.isArray(node)) return node.flatMap(collectText)
    if (isValidElement<TestElementProps>(node)) {
        return collectText(node.props.children)
    }
    return []
}

function findElement(
    node: ReactNode,
    predicate: (props: TestElementProps) => boolean,
): TestElementProps | null {
    if (node === null || node === undefined || typeof node === 'boolean') return null
    if (typeof node === 'string' || typeof node === 'number') return null
    if (Array.isArray(node)) {
        for (const child of node) {
            const match = findElement(child, predicate)
            if (match) return match
        }
        return null
    }
    if (!isValidElement<TestElementProps>(node)) return null
    if (predicate(node.props)) return node.props
    return findElement(node.props.children, predicate)
}

describe('ModelModeMenu', () => {
    it('renders speed as fast and normal modes when the selected model supports it', () => {
        const text = collectText(renderMenu(codexModelState()))

        expect(text).toContain('Speed')
        expect(text).toContain('Normal')
        expect(text).toContain('Fast')
    })

    it('hides speed controls when the selected model does not support them', () => {
        const text = collectText(
            renderMenu(
                codexModelState({
                    speedMode: null,
                    availableSpeedModes: [],
                }),
            ),
        )

        expect(text).not.toContain('Speed')
        expect(text).not.toContain('Normal')
        expect(text).not.toContain('Fast')
    })

    it('changes speed without changing the selected model or thinking level', () => {
        const changes: ModelModeChange[] = []
        const speedGroup = findElement(
            renderMenu(codexModelState(), changes),
            (props) => props.value === 'normal' && typeof props.onValueChange === 'function',
        )

        speedGroup?.onValueChange?.('fast')

        expect(changes).toEqual([
            {
                provider: 'openai-codex',
                model: 'gpt-5.5',
                thinkingLevel: 'high',
                speedMode: 'fast',
            },
        ])
    })
})
