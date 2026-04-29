import { createFileRoute } from '@tanstack/react-router'
import { CalendarClockIcon, MessagesSquareIcon, UsersRoundIcon } from 'lucide-react'
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

function AboutPage() {
    return (
        <AppShell>
            <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
                <PageHeader
                    title="Agent Room"
                    subtitle="The colleague model: each room is a durable AI worker with its own sessions, files, jobs, and instructions."
                    glyph={<BrandMark size={28} />}
                />

                <div className="mt-6 space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Self-hosted, model-agnostic, room-first.</CardTitle>
                            <CardDescription>
                                Agent Room runs on your own machine. Bring any provider — OpenAI,
                                Anthropic, Google, or your own endpoint — and bind it to the rooms
                                that need it.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <p className="text-sm text-muted-foreground">
                                Rooms are persistent. They keep their own state, run scheduled jobs,
                                and accumulate work over time. They are not throwaway chats.
                            </p>
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
                </div>
            </div>
        </AppShell>
    )
}
