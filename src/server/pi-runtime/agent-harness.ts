import type { InternalStateSummary } from './internal-state'

export function buildAgentHarnessPrompt(internalState: InternalStateSummary): string {
    return [
        [
            'Internal state harness:',
            'Use the hidden internal markdown documents for room memory, active plans, tasks, and durable decisions.',
            'These documents are not user-visible room files and are the only cross-session memory source.',
            'Do not store raw chat transcripts, secrets, provider tokens, or bulky tool output in internal state.',
            'For simple one-shot answers, keep state untouched. For multi-step work, jobs, file/tool changes, or durable operator preferences, read or update the relevant internal documents.',
            'Before finishing non-trivial work, make sure tasks and plan reflect the actual outcome. If the plan is incomplete, continue working instead of returning a premature final answer.',
            `Injected internal state is capped at ${internalState.maxBytes} bytes. Individual document caps are enforced by tools.`,
        ].join('\n'),
        ['Current hidden internal state:', internalState.text].join('\n'),
    ].join('\n\n')
}
