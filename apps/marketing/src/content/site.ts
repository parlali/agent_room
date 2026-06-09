import type { Cta, NavLink, RoutePath, SeoMeta } from './types'

export const githubUrl = 'https://github.com/agent-room/agent-room'

export const brand = {
    name: 'Agent Room',
    tagline: 'Isolated AI coworkers for real work.',
    description:
        'Deploy separate agent rooms for correspondence, research, code, operations, and recurring work. Each room gets its own workspace, memory, tools, schedules, credentials, and audit trail.',
}

export const primaryCta: Cta = {
    label: 'Join Waitlist',
    href: '/pricing',
}

export const githubCta: Cta = {
    label: 'View GitHub',
    href: githubUrl,
    external: true,
}

export const navLinks: NavLink[] = [
    { label: 'Product', href: '/' },
    { label: 'Features', href: '/features' },
    { label: 'Pricing', href: '/pricing' },
    { label: 'Security', href: '/security' },
    { label: 'GitHub', href: githubUrl, external: true },
]

export const footerGroups: { heading: string; links: NavLink[] }[] = [
    {
        heading: 'Product',
        links: [
            { label: 'Overview', href: '/' },
            { label: 'Features', href: '/features' },
            { label: 'Pricing', href: '/pricing' },
            { label: 'Security', href: '/security' },
        ],
    },
    {
        heading: 'Source',
        links: [
            { label: 'GitHub', href: githubUrl, external: true },
            { label: 'Source & self-hosting', href: '/source' },
            { label: 'Security disclosure', href: '/security' },
        ],
    },
    {
        heading: 'Legal',
        links: [
            { label: 'Terms', href: '/terms' },
            { label: 'Privacy', href: '/privacy' },
        ],
    },
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
            'Rooms, workspaces, tools, document work, scheduled jobs, provider binding, room-local memory, and full audit and usage telemetry.',
    },
    '/pricing': {
        title: 'Pricing - Agent Room',
        description:
            'Join the hosted Agent Room waitlist. Pricing is being finalized and usage will depend on selected models and provider paths.',
    },
    '/security': {
        title: 'Security - Agent Room',
        description:
            'Room isolation, credential and provider binding, runtime and filesystem boundaries, and auditable usage reporting.',
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
