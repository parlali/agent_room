import type { Cta, NavLink, RoutePath, SeoMeta } from './types'

export const githubUrl = 'https://github.com/parlali/agent_room'

export const appUrl = 'https://app.openagentroom.com'

export const brand = {
    name: 'Agent Room',
    tagline: 'A room for every job. An assistant in every room.',
    description:
        'Give every job a persistent AI coworker in its own room, with separate memory, files, tools, and keys. Nothing leaks between rooms.',
}

export const primaryCta: Cta = {
    label: 'Get started',
    href: appUrl,
    external: true,
}

export const pricingCta: Cta = {
    label: 'See pricing',
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
        body: 'Create a hosted workspace and put your first job in its own room in minutes.',
        primary: primaryCta,
    },
    security: {
        title: 'Trust walls, not promises.',
        body: 'Create a hosted workspace where every room keeps its own memory, files, and keys.',
        primary: primaryCta,
    },
    source: {
        title: 'Prefer not to run it yourself?',
        body: 'Create a hosted workspace and let us operate the walls, runtime, and keys for you.',
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
            'Hosted Agent Room pricing: Starter, Standard, and Pro plans with included monthly usage. Bring your own keys or use managed AI, web search, and live browsing.',
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
