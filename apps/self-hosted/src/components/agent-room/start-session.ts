import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'

import { sanitizeRuntimeError } from '#/domain/runtime-error'
import { markChatSelection } from '#/lib/browser-performance'
import { roomQueryKey } from '#/lib/room-query-keys'
import { createThreadServer } from '#/routes/-room-runtime-server'

export function useStartRoomSession({
    roomId,
    onStarted,
}: {
    roomId: string
    onStarted?: () => void
}) {
    const navigate = useNavigate()
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: () => createThreadServer({ data: { roomId } }),
        onSuccess: async ({ key }) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: roomQueryKey.roomExecution(roomId) }),
                queryClient.invalidateQueries({ queryKey: roomQueryKey.roomSidebar(roomId) }),
                queryClient.invalidateQueries({ queryKey: roomQueryKey.roomsList }),
            ])
            onStarted?.()
            markChatSelection(roomId, key)
            await navigate({
                to: '/rooms/$roomId/sessions/$sessionKey',
                params: { roomId, sessionKey: key },
            })
        },
        onError: (e: unknown) => {
            toast.error('Could not start a new session', {
                description: sanitizeRuntimeError(e instanceof Error ? e.message : null),
            })
        },
    })
}
