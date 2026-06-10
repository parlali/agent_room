export const homeHero = {
    title: 'Give every job its own AI coworker.',
    summary:
        'Each room in Agent Room is a persistent assistant with its own memory, files, tools, and keys. Walk in, ask for the work, walk out. It remembers everything about its job and nothing about anything else.',
}

export const homeSteps = {
    eyebrow: 'How it works',
    title: 'Open a room. Hand over a job.',
    summary: 'A room takes a minute to open and takes a job off your plate for good.',
    items: [
        {
            number: '01',
            title: 'Open a room',
            detail: 'Name the job: research, bookkeeping, support. The room becomes the one assistant that owns it.',
        },
        {
            number: '02',
            title: 'Give it only what it needs',
            detail: 'A browser for the researcher, spreadsheets for the bookkeeper. Everything else stays out of reach.',
        },
        {
            number: '03',
            title: 'Ask, or schedule',
            detail: 'Drop in and talk, or set standing work that runs on its own. Results wait for you in the room.',
        },
        {
            number: '04',
            title: 'Check the receipts',
            detail: 'Every action is recorded, so "what did it do while I was gone" always has an exact answer.',
        },
    ],
}

export const homeIsolation = {
    eyebrow: 'Isolation',
    title: 'Hard walls, not house rules.',
    summary: 'Boundaries are enforced by the runtime, not by a system prompt asking nicely.',
}

export const homeIsolationClaims = [
    "A room cannot read another room's memory.",
    "A room cannot open another room's files.",
    "A room cannot spend another room's keys.",
]

export const homeIsolationRooms = [
    {
        name: 'room/research',
        job: 'Weekly market scans',
        tools: ['memory', 'files', 'browser', 'schedule'],
    },
    {
        name: 'room/billing',
        job: 'Invoices and reconciliation',
        tools: ['memory', 'files', 'shell', 'credentials'],
    },
    {
        name: 'room/support',
        job: 'Ticket triage drafts',
        tools: ['memory', 'files', 'connectors', 'schedule'],
    },
]

export const homeFounderNote = {
    text: 'Agent Room is open source under the MIT License. Before you trust it with your keys and files, read exactly how the walls are built.',
}
