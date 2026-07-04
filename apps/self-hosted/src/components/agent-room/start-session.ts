import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import { markChatSelection } from '#/lib/browser-performance'
import { dismissRoomActionErrors, reportRoomActionError } from '#/lib/room-action-error'
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
            dismissRoomActionErrors(roomId)
            onStarted?.()
            markChatSelection(roomId, key)
            await navigate({
                to: '/rooms/$roomId/sessions/$sessionKey',
                params: { roomId, sessionKey: key },
            })
        },
        onError: async (e: unknown) => {
            await queryClient.invalidateQueries({ queryKey: roomQueryKey.roomSidebar(roomId) })
            reportRoomActionError({ roomId, error: e, title: 'Could not start a new session' })
        },
    })
}
