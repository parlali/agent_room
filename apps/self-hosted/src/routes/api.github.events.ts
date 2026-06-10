import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/github/events')({
    server: {
        handlers: {
            POST: async () =>
                new Response(null, {
                    status: 204,
                    headers: {
                        'cache-control': 'no-store',
                    },
                }),
        },
    },
})
