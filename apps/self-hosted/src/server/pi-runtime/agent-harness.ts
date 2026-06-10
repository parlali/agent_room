import type { InternalStateSummary } from './internal-state'

export function buildAgentHarnessPrompt(internalState: InternalStateSummary): string {
    return [
        [
            'Memory harness:',
            'Use the canonical memory JSON for durable identity, operator preferences, behavior rules, current work, schedule entries, decisions, and do-not-forget items.',
            'Memory is not user-visible workspace content and is the only cross-session memory source.',
            'Do not store raw chat transcripts, secrets, provider tokens, or bulky tool output in memory.',
            'Use memory as an internal habit after substantive work: capture durable findings, decisions, operator preferences, active goals, blockers, deadlines, reminders, and concise pointers to important workspace artifacts.',
            'Treat a run as substantive when it used multiple web search or URL fetch calls, inspected files, logs, commands, runtime state, or connected tools, created or edited artifacts, discovered durable project context, or made a durable decision.',
            'At the end of substantive runs, write 1-3 concise memory items when reusable value exists.',
            'Leave memory untouched for simple one-shot answers, transient facts, speculative conclusions, and details that only mattered for the current reply.',
            'Capture reusable value from research or investigation as concise memory items without storing large source lists, command logs, raw fetched text, or private provider/auth details.',
            'If workspace notes or long-form files are needed, store a concise memory item that points to the file and explains why it matters.',
            'Use optimistic concurrency hashes when replacing or patching memory.',
            `Injected memory brief is capped at ${internalState.maxBytes} bytes.`,
        ].join('\n'),
        ['Current memory brief:', internalState.text].join('\n'),
    ].join('\n\n')
}
