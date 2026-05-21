import { CAPABILITY_OPTIONS, type CapabilityOption } from '#/lib/capabilities'
import { ROOM_MODE_OPTIONS } from '#/lib/room-modes'

export const repositoryUrl = 'https://github.com/parlali/agent_room'

export const alphaInterestUrl =
    'https://github.com/parlali/agent_room/issues/new?title=Closed%20alpha%20interest'

export const capabilityRows = CAPABILITY_OPTIONS.map((option) => ({
    id: option.id,
    title: option.label,
    description: option.description,
})) satisfies Array<{
    id: CapabilityOption['id']
    title: string
    description: string
}>

export const modeRows = ROOM_MODE_OPTIONS.map((mode) => ({
    title: mode.label,
    description: mode.description,
})) satisfies Array<{
    title: (typeof ROOM_MODE_OPTIONS)[number]['label']
    description: string
}>

export const roomPrimitives = [
    {
        title: 'Typed memory',
        detail: 'Room-local identity, responsibilities, preferences, current work, decisions, deadlines, and facts stay in one canonical memory record.',
    },
    {
        title: 'Files and artifacts',
        detail: 'Each room has a workspace for uploads, generated files, previews, runtime logs, and durable artifacts.',
    },
    {
        title: 'Tools and integrations',
        detail: 'Web search, URL fetch, MCP servers, shell work, Office artifacts, PDFs, images, and provider-backed models are explicit room capabilities.',
    },
    {
        title: 'Scheduled work',
        detail: 'Jobs wake the room for recurring work and keep run history visible with status, cost, and audit surfaces.',
    },
]

export const operatingPrinciples = [
    'One room, one coworker, one workspace',
    'Provider and model truth stays visible',
    'Credentials are scoped and materialized deliberately',
    'Generated work remains inspectable through files, artifacts, memory, usage, and status',
]

export const deploymentDefaults = [
    {
        label: 'App',
        value: '127.0.0.1:3000',
    },
    {
        label: 'Database',
        value: 'Private Docker network',
    },
    {
        label: 'Search',
        value: 'Private SearXNG service',
    },
    {
        label: 'Secrets',
        value: 'Generated on first boot unless provided',
    },
]
