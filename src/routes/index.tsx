import { createFileRoute, redirect } from '@tanstack/react-router'
import { SparklesIcon } from 'lucide-react'

import { AppShell } from '#/components/app-shell'
import { CreateRoomButton, EmptyState, PageHeader } from '#/components/agent-room'
import { requireRouteUser } from './-route-auth'
import { getOperatorConfigServer } from './-operator-config-server'
import { redirectToFirstRoomSurface } from './-room-entry-redirect'

export const Route = createFileRoute('/')({
    beforeLoad: async () => {
        await requireRouteUser()
        const config = await getOperatorConfigServer()
        if (!config.onboarding.completed) {
            throw redirect({ to: '/onboarding' })
        }
        await redirectToFirstRoomSurface('home')
    },
    component: HomePage,
})

function HomePage() {
    return (
        <AppShell>
            <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-3xl flex-col px-4 py-6 sm:px-6">
                <PageHeader
                    title="Create your first room"
                    subtitle="Rooms are persistent spaces for conversations, files, jobs, memory, and settings."
                    className="border-0 px-0 py-0"
                />

                <div className="mt-6">
                    <EmptyState
                        icon={SparklesIcon}
                        title="No rooms yet"
                        description="Create a room to start working with an AI coworker in its own isolated workspace."
                        action={<CreateRoomButton />}
                    />
                </div>
            </div>
        </AppShell>
    )
}
