import type { InternalStateSummary } from './internal-state'

export function buildAgentHarnessPrompt(internalState: InternalStateSummary): string {
    return [
        [
            'Room memory harness:',
            'Use the canonical room-local memory JSON for durable identity, operator preferences, behavior rules, current work, schedule entries, decisions, and do-not-forget items.',
            'Memory is not user-visible workspace content and is the only cross-session memory source.',
            'Do not store raw chat transcripts, secrets, provider tokens, or bulky tool output in memory.',
            'For simple one-shot answers, leave memory untouched. For durable operator preferences, deadlines, reminders, decisions, or recurring behavior changes, update memory through the typed memory tools.',
            'Use optimistic concurrency hashes when replacing or patching memory.',
            `Injected memory brief is capped at ${internalState.maxBytes} bytes.`,
        ].join('\n'),
        ['Current room memory brief:', internalState.text].join('\n'),
    ].join('\n\n')
}
