import type { SecurityLogEntry, SecurityPrinciple } from './types'

export const securityIntro = {
    eyebrow: 'Security model',
    title: 'What a room cannot do.',
    summary:
        "Read another room's memory. Spend another room's keys. Touch another room's files. Not because it promised to behave, but because the walls make it impossible.",
}

export const securityWalls: SecurityPrinciple[] = [
    {
        id: 'isolation',
        title: 'Room isolation',
        summary:
            'Memory, files, sessions, and running state stop at the wall. Nothing is shared between rooms by default.',
    },
    {
        id: 'credentials',
        title: 'Credential binding',
        summary:
            "Keys live inside the room that uses them and never fall back to another. A compromised room cannot spend anyone else's credentials.",
    },
    {
        id: 'runtime',
        title: 'Runtime boundaries',
        summary:
            'Each room executes against its own filesystem and runtime. Work started in a room ends in that room.',
    },
]

export const securityLog: SecurityLogEntry[] = [
    { room: 'room/billing', action: 'read', target: 'billing/invoices.xlsx', allowed: true },
    { room: 'room/billing', action: 'read', target: 'research/memory', allowed: false },
    { room: 'room/support', action: 'use', target: 'billing/api-key', allowed: false },
    { room: 'room/research', action: 'fetch', target: 'web/market-data', allowed: true },
    { room: 'room/research', action: 'write', target: 'support/drafts', allowed: false },
    { room: 'room/support', action: 'write', target: 'support/reply.md', allowed: true },
]

export const securityHosted = {
    title: 'On hosted, we operate the walls',
    body: 'Runtime, isolation, and credential storage are run for you on the hosted product. The source stays open, so what we operate is exactly what you can read.',
}

export const securityContact = {
    title: 'Reporting a vulnerability',
    body: 'Security reports are handled through the disclosure process in the source repository. Please report suspected vulnerabilities privately rather than opening a public issue.',
    note: 'Agent Room does not currently claim SOC 2, HIPAA, or other compliance certifications. This page describes how the product is designed to behave, not a certified posture.',
}
