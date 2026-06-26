import { createFileRoute, redirect } from '@tanstack/react-router'
import { SparklesIcon } from 'lucide-react'

import { CreateRoomButton, EmptyState, Page, PageHeader } from '#/components/agent-room'
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
        <Page
            width="md"
            header={
                <PageHeader
                    title="Create your first room"
                    subtitle="Rooms are persistent spaces for conversations, files, jobs, memory, and settings."
                />
            }
        >
            <EmptyState
                icon={SparklesIcon}
                title="No rooms yet"
                description="Create a room to start working with an AI coworker in its own isolated workspace."
                action={<CreateRoomButton />}
            />
        </Page>
    )
}
