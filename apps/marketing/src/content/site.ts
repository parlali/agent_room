import type { Cta, NavLink, RoutePath, SeoMeta } from './types'

export const githubUrl = 'https://github.com/parlali/agent_room'

export const brand = {
    name: 'Agent Room',
    tagline: 'A room for every job. An assistant in every room.',
    description:
        'Give every job a persistent AI coworker in its own room, with separate memory, files, tools, and keys. Nothing leaks between rooms.',
}

export const primaryCta: Cta = {
    label: 'Join the waitlist',
    href: '/pricing',
}

export const githubCta: Cta = {
    label: 'View GitHub',
    href: githubUrl,
    external: true,
}

export const readSourceCta: Cta = {
    label: 'Read the source on GitHub',
    href: githubUrl,
    external: true,
}

export const disclosureCta: Cta = {
    label: 'Open the disclosure process',
    href: githubUrl,
    external: true,
}

export const pageCtaBands = {
    features: {
        title: 'Ready to hand off your first job?',
        body: 'Join the waitlist for hosted Agent Room and we will reach out as early access opens.',
        primary: primaryCta,
    },
    security: {
        title: 'Trust walls, not promises.',
        body: 'Join the waitlist for hosted Agent Room and we will reach out as early access opens.',
        primary: primaryCta,
    },
    source: {
        title: 'Prefer not to run it yourself?',
        body: 'Join the hosted waitlist and let us operate the walls, runtime, and keys for you.',
        primary: primaryCta,
    },
} as const

export const navLinks: NavLink[] = [
    { label: 'Product', href: '/' },
    { label: 'Features', href: '/features' },
    { label: 'Pricing', href: '/pricing' },
    { label: 'Security', href: '/security' },
]

export const footerNavLinks: NavLink[] = [
    { label: 'Overview', href: '/' },
    { label: 'Features', href: '/features' },
    { label: 'Pricing', href: '/pricing' },
    { label: 'Security', href: '/security' },
    { label: 'Source', href: '/source' },
]

export const footerLegalLinks: NavLink[] = [
    { label: 'Terms', href: '/terms' },
    { label: 'Privacy', href: '/privacy' },
]

export const seo: Record<RoutePath, SeoMeta> = {
    '/': {
        title: 'Agent Room - Isolated AI coworkers for real work',
        description:
            'Hosted agent rooms with separate memory, files, tools, schedules, credentials, runtime state, and audit trails.',
    },
    '/features': {
        title: 'Features - Agent Room',
        description:
            'What a room can do: persistent memory, real files, scoped tools, finished documents, scheduled work, pinned models, and receipts for everything.',
    },
    '/pricing': {
        title: 'Pricing - Agent Room',
        description:
            'Join the hosted Agent Room waitlist. Pricing is being finalized and usage will depend on selected models and provider paths.',
    },
    '/security': {
        title: 'Security - Agent Room',
        description:
            'Hard walls between rooms: isolated memory and files, room-bound credentials, pinned providers, and a full audit trail.',
    },
    '/source': {
        title: 'Source - Agent Room',
        description:
            'Agent Room source is available on GitHub. Self-host the stack yourself or let the hosted product run the operations for you.',
    },
    '/terms': {
        title: 'Terms of Service - Agent Room',
        description: 'Terms of service for the hosted Agent Room product.',
    },
    '/privacy': {
        title: 'Privacy Policy - Agent Room',
        description: 'How Agent Room handles account, workspace, credential, and usage data.',
    },
}
