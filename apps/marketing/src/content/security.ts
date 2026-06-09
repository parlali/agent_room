import type { SecurityPrinciple } from './types'

export const securityIntro = {
    eyebrow: 'Security model',
    title: 'Isolation is the product, not a setting.',
    summary:
        'Agent Room is built so that correctness, isolation, auditability, and credential safety come before convenience. The boundaries below are how the product is designed to behave.',
}

export const securityPrinciples: SecurityPrinciple[] = [
    {
        id: 'isolation',
        title: 'Room isolation',
        summary:
            'Each room is a separate unit of work. Memory, files, runtime state, and sessions do not cross room boundaries by default.',
        points: [
            'Room-scoped memory, files, and runtime state',
            'No implicit sharing between rooms',
            'Cross-room access is explicit when it exists at all',
        ],
    },
    {
        id: 'credentials',
        title: 'Credential and provider binding',
        summary:
            'Provider keys and customer-provided secrets are bound to a single room. A room cannot reach for another room credentials.',
        points: [
            'Secrets scoped to one room',
            'Explicit provider identity per room',
            'No silent fallback to a different provider or key',
        ],
    },
    {
        id: 'runtime',
        title: 'Runtime and filesystem boundaries',
        summary:
            'Each room runs against its own workspace filesystem and runtime. Execution stays inside the room that started it.',
        points: [
            'Dedicated workspace filesystem per room',
            'Isolated runtime configuration and lifecycle',
            'Execution scoped to the owning room',
        ],
    },
    {
        id: 'audit',
        title: 'Audit and usage reporting',
        summary:
            'Every room keeps an inspectable record of what it did. Tool calls, run state, and usage are recorded so behavior can be traced.',
        points: [
            'Tool-call and run history per room',
            'Traceable runtime state',
            'Token and cost telemetry for usage review',
        ],
    },
    {
        id: 'hosted',
        title: 'Hosted responsibilities',
        summary:
            'On the hosted product, Agent Room operates the runtime, isolation, and credential handling so teams do not run the stack themselves.',
        points: [
            'Operated isolation and runtime lifecycle',
            'Managed credential storage and handling',
            'Source remains available for review and self-hosting',
        ],
    },
]

export const securityContact = {
    title: 'Reporting a vulnerability',
    body: 'Security reports are handled through the disclosure process in the source repository. Please report suspected vulnerabilities privately rather than opening a public issue.',
    note: 'Agent Room does not currently claim SOC 2, HIPAA, or other compliance certifications. This page describes how the product is designed to behave, not a certified posture.',
}
