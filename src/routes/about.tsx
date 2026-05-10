import { createFileRoute } from '@tanstack/react-router'
import {
    CalendarClockIcon,
    FilesIcon,
    KeyRoundIcon,
    MessagesSquareIcon,
    RouteIcon,
    ShieldCheckIcon,
    UsersRoundIcon,
    WrenchIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { AppShell } from '#/components/app-shell'
import { BrandMark, PageHeader } from '#/components/agent-room'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { requireRouteUser } from './-route-auth'

export const Route = createFileRoute('/about')({
    beforeLoad: requireRouteUser,
    component: AboutPage,
})

interface AboutCard {
    icon: LucideIcon
    title: string
    description: string
}

const cards: AboutCard[] = [
    {
        icon: UsersRoundIcon,
        title: 'Rooms are colleagues',
        description:
            'Each room is a durable AI worker with its own files, jobs, instructions, tools, and provider binding.',
    },
    {
        icon: MessagesSquareIcon,
        title: 'Sessions are conversations',
        description:
            'A session is one ongoing thread inside a room. The room remembers what happened across sessions.',
    },
    {
        icon: CalendarClockIcon,
        title: 'Jobs are unattended work',
        description:
            'Jobs run on a schedule and wake the room to get work done while you are away.',
    },
]

const foundations: AboutCard[] = [
    {
        icon: KeyRoundIcon,
        title: 'Provider binding',
        description:
            'An app default can power new rooms, while sensitive rooms can bind to their own saved connection or room key.',
    },
    {
        icon: FilesIcon,
        title: 'Room workspace',
        description:
            'Every room gets an isolated workspace for files, generated artifacts, runtime logs, and durable memory.',
    },
    {
        icon: WrenchIcon,
        title: 'Tool surface',
        description:
            'Capabilities are explicit: web, documents, spreadsheets, images, shell, MCP tools, and scheduled jobs.',
    },
    {
        icon: ShieldCheckIcon,
        title: 'Operational boundaries',
        description:
            'Credentials, runtime state, and room ownership are kept separate so failures are visible and contained.',
    },
]

function AboutPage() {
    return (
        <AppShell>
            <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
                <PageHeader
                    title="How Agent Room Works"
                    subtitle="A room-first model for persistent AI coworkers that can chat, use tools, manage files, and run scheduled work on your own host."
                    glyph={<BrandMark size={28} />}
                />

                <div className="mt-6 space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Self-hosted, model-agnostic, room-first</CardTitle>
                            <CardDescription>
                                Agent Room runs on your machine and turns provider models into
                                durable workspaces. The important unit is not a one-off chat; it is
                                a room with its own runtime, memory, files, jobs, and audit trail.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-4 text-sm text-muted-foreground md:grid-cols-[1.1fr_0.9fr]">
                            <div className="space-y-3">
                                <p>
                                    Use rooms for recurring work: a product room, a research room,
                                    an ops room, a customer account room, or any long-lived context
                                    where continuity matters.
                                </p>
                                <p>
                                    Each room can inherit app defaults or bind to a specific
                                    provider connection. That keeps runtime truth explicit and makes
                                    it clear which credentials and models power each task.
                                </p>
                            </div>
                            <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                                    <RouteIcon className="size-4" />
                                    Typical flow
                                </div>
                                <ol className="space-y-1.5 pl-4 text-xs">
                                    <li>Connect a provider and optional tools.</li>
                                    <li>Create a room with instructions.</li>
                                    <li>Chat in sessions or schedule jobs.</li>
                                    <li>Inspect files, memory, activity, usage, and status.</li>
                                </ol>
                            </div>
                        </CardContent>
                    </Card>

                    <div className="grid gap-3 sm:grid-cols-3">
                        {cards.map((card) => {
                            const Icon = card.icon
                            return (
                                <Card key={card.title} size="sm">
                                    <CardHeader>
                                        <span className="mb-2 flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
                                            <Icon className="size-4" aria-hidden />
                                        </span>
                                        <CardTitle>{card.title}</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <p className="text-sm text-muted-foreground">
                                            {card.description}
                                        </p>
                                    </CardContent>
                                </Card>
                            )
                        })}
                    </div>

                    <Card>
                        <CardHeader>
                            <CardTitle>Foundations</CardTitle>
                            <CardDescription>
                                The pieces Agent Room keeps separate so the system stays legible as
                                rooms become more capable.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-3 sm:grid-cols-2">
                            {foundations.map((item) => {
                                const Icon = item.icon
                                return (
                                    <div
                                        key={item.title}
                                        className="rounded-lg border border-border/60 p-3"
                                    >
                                        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                                            <Icon className="size-4 text-muted-foreground" />
                                            {item.title}
                                        </div>
                                        <p className="mt-1.5 text-sm text-muted-foreground">
                                            {item.description}
                                        </p>
                                    </div>
                                )
                            })}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </AppShell>
    )
}
