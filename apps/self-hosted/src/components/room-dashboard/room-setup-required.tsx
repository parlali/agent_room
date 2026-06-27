import type { ReactNode } from 'react'
import { Settings2Icon } from 'lucide-react'

import { EmptyState } from '#/components/agent-room'

export const roomSetupRequiredCopy = {
    title: 'Finish setup to start working',
    description:
        'Connect a model in Settings so this room can chat, run tasks, and work with files.',
} as const

export function RoomSetupRequiredState({
    description,
    action,
    className,
}: {
    description?: string
    action?: ReactNode
    className?: string
}) {
    return (
        <EmptyState
            icon={Settings2Icon}
            title={roomSetupRequiredCopy.title}
            description={description ?? roomSetupRequiredCopy.description}
            action={action}
            className={className}
        />
    )
}
