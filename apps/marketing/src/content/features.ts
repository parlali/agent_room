import type { Capability, FeatureGroup } from './types'

export const problem = {
    eyebrow: 'The problem',
    title: 'One assistant with every permission is a liability.',
    monolith: {
        label: 'Monolithic assistant',
        points: [
            'One memory holds personal notes next to production secrets.',
            'One filesystem mixes correspondence, code, and customer data.',
            'One credential surface can reach everything at once.',
            'Every new task makes it broader, slower, and harder to trust.',
        ],
    },
    rooms: {
        label: 'Isolated rooms',
        points: [
            'Separate memory per room, scoped to one line of work.',
            'A dedicated filesystem and artifacts for each room.',
            'Credentials and provider binding fixed per room.',
            'Add a room for new work instead of widening one agent.',
        ],
    },
}

export const roomModel = {
    eyebrow: 'The room model',
    title: 'Each room is a coworker, not a chat tab.',
    summary:
        'A room carries its own identity and state across every session. Nothing leaks between rooms unless you wire it on purpose.',
    facets: [
        { name: 'Identity', detail: 'A stable name and role for one line of work.' },
        { name: 'Memory', detail: 'Durable, room-local memory with no shared personal layer.' },
        { name: 'Files', detail: 'A dedicated workspace filesystem and generated artifacts.' },
        { name: 'Tools', detail: 'An explicit tool set, enabled per room.' },
        { name: 'Schedules', detail: 'Recurring jobs that run inside the room.' },
        { name: 'Credentials', detail: 'Provider keys and secrets bound to the room only.' },
        { name: 'Runtime', detail: 'Isolated runtime state and live session history.' },
        { name: 'Audit', detail: 'A full record of tool calls, runs, and usage.' },
    ],
}

export const featureGroups: FeatureGroup[] = [
    {
        id: 'rooms',
        eyebrow: 'Rooms',
        title: 'Isolated identity and state',
        summary:
            'Every room keeps its own identity, memory, files, runtime state, and sessions, separated from every other room.',
        points: [
            'Room-scoped identity and role',
            'Durable memory that stays inside the room',
            'Persistent runtime and live session history',
            'No shared state between rooms by default',
        ],
    },
    {
        id: 'workspaces',
        eyebrow: 'Workspaces',
        title: 'A real filesystem per room',
        summary:
            'Each room works against a dedicated filesystem, keeps generated artifacts, and lets you preview files in place.',
        points: [
            'Dedicated workspace filesystem',
            'Generated artifacts kept with the room',
            'In-place file previews',
            'Clean separation from other rooms',
        ],
    },
    {
        id: 'tools',
        eyebrow: 'Tools',
        title: 'Operational tools, enabled per room',
        summary:
            'Turn on only the tools a room needs: shell access, web search, browser use, URL fetch, and MCP connectors.',
        points: [
            'Bash and shell access',
            'Web search and URL fetch',
            'Browser use for real web tasks',
            'MCP connectors for external systems',
        ],
    },
    {
        id: 'documents',
        eyebrow: 'Documents',
        title: 'Office and PDF work, done in the room',
        summary:
            'Produce and edit real documents and images without leaving the room or exporting to another service.',
        points: [
            'DOCX, XLSX, and PPTX',
            'PDF generation and editing',
            'Image generation',
            'Artifacts saved to the room workspace',
        ],
    },
    {
        id: 'jobs',
        eyebrow: 'Jobs',
        title: 'Scheduled recurring work',
        summary:
            'Give a room standing work. Schedule jobs that run on a cadence and report back into the room with full history.',
        points: [
            'Recurring schedules per room',
            'Runs recorded in room history',
            'Outputs land in the room workspace',
            'Status and failures are visible',
        ],
    },
    {
        id: 'providers',
        eyebrow: 'Providers',
        title: 'Explicit provider binding',
        summary:
            'Choose the provider and model for each room on purpose. No silent fallbacks to a different provider or model.',
        points: [
            'Per-room provider selection',
            'Explicit model choice',
            'No hidden provider swaps',
            'Provider identity stays canonical',
        ],
    },
    {
        id: 'memory',
        eyebrow: 'Memory',
        title: 'Room-local durable memory',
        summary:
            'Memory belongs to the room that built it. There is no shared personal memory layer spanning every room.',
        points: [
            'Durable memory scoped to one room',
            'No cross-room personal memory',
            'Context stays with its line of work',
            'Predictable, inspectable recall',
        ],
    },
    {
        id: 'audit',
        eyebrow: 'Audit and usage',
        title: 'Tool history and usage telemetry',
        summary:
            'See what each room did and what it cost. Tool history, run state, and token and cost telemetry are recorded per room.',
        points: [
            'Full tool-call history',
            'Run state and outcomes',
            'Token and cost telemetry',
            'Per-room usage reporting',
        ],
    },
]

export const capabilities: Capability[] = [
    { name: 'Bash', detail: 'Run shell commands in the room workspace.' },
    { name: 'Files', detail: 'Read, write, and preview workspace files.' },
    { name: 'Office and PDF', detail: 'Produce DOCX, XLSX, PPTX, and PDF output.' },
    { name: 'Web search', detail: 'Search the web for current information.' },
    { name: 'Browser use', detail: 'Drive a real browser for web tasks.' },
    { name: 'Schedules', detail: 'Run recurring jobs on a cadence.' },
    { name: 'Connectors', detail: 'Attach external systems over MCP.' },
    { name: 'Provider choice', detail: 'Pick the provider and model per room.' },
]
