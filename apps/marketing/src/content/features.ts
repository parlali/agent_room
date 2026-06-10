import type { Comparison, FeatureGroup } from './types'

export const problem = {
    eyebrow: 'Why rooms',
    title: 'The do-everything assistant is a bad coworker.',
    summary:
        'AI is finally good enough to do real work, and the default answer is to pour every job, file, and password into one assistant. That assistant gets vaguer with every task, pricier with every message, and more dangerous with every key it holds.',
    resolution: 'The fix is not a bigger assistant. It is a smaller one, in a room, for each job.',
}

export const problemComparison: Comparison = {
    columns: [
        { label: 'One assistant for everything', tone: 'red' },
        { label: 'A room for each job', tone: 'green' },
    ],
    rows: [
        {
            label: 'Focus',
            cells: [
                'Your tax records share a brain with your travel plans.',
                'A room knows one job deeply. It gets sharper, not fuzzier.',
            ],
        },
        {
            label: 'Files',
            cells: [
                'One pile of everything: contracts next to customer data.',
                'Each room keeps its own files. Nothing strays.',
            ],
        },
        {
            label: 'Keys',
            cells: [
                'Every password you ever connected, reachable from one chat.',
                'A room holds only the keys for its own job.',
            ],
        },
        {
            label: 'When things go wrong',
            cells: [
                'One bad day exposes everything the assistant ever touched.',
                'Damage stops at the wall of one room.',
            ],
        },
    ],
}

export const roomModel = {
    eyebrow: 'The room model',
    title: 'A room is a complete coworker.',
    summary: 'Everything one job needs lives inside its walls, and nothing else gets in.',
    facets: [
        'Identity',
        'Memory',
        'Files',
        'Tools',
        'Schedules',
        'Credentials',
        'Runtime',
        'Audit',
    ],
}

export const featureGroups: FeatureGroup[] = [
    {
        id: 'memory',
        eyebrow: 'Persistent',
        title: 'It remembers, so you never re-explain.',
        summary: 'Context builds in the room for weeks. Walk in, pick up mid-thought, walk out.',
    },
    {
        id: 'output',
        eyebrow: 'Real output',
        title: 'Finished files, not pasted text.',
        summary: 'Spreadsheets, decks, and PDFs land in the room that made them, ready to share.',
    },
    {
        id: 'tools',
        eyebrow: 'Scoped power',
        title: 'Powerful tools, off by default.',
        summary: 'Shell, browser, and connectors exist only in the rooms you grant them to.',
    },
    {
        id: 'jobs',
        eyebrow: 'Unattended',
        title: 'Work that runs while you sleep.',
        summary: 'Set a schedule once. Results wait in the room, and failures are never silent.',
    },
    {
        id: 'providers',
        eyebrow: 'Your model',
        title: 'You pick the model. It stays picked.',
        summary: 'Each room is pinned to one provider and model. No silent swaps, ever.',
    },
    {
        id: 'audit',
        eyebrow: 'Receipts',
        title: 'Every action on record.',
        summary: 'See what any room did and what it cost, down to the token.',
    },
]

export const capabilities = [
    'Bash',
    'Files',
    'Office and PDF',
    'Web search',
    'Browser use',
    'Schedules',
    'MCP connectors',
    'Provider choice',
]
