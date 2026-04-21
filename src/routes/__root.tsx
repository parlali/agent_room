import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { AppProviders } from '../providers/AppProviders'
import '../styles.css'

export const Route = createRootRoute({
    head: () => ({
        meta: [
            {
                charSet: 'utf-8',
            },
            {
                name: 'viewport',
                content: 'width=device-width, initial-scale=1',
            },
            {
                title: 'Agent Room',
            },
        ],
        links: [
            {
                rel: 'icon',
                href: '/agent-room-mark.svg',
                type: 'image/svg+xml',
            },
        ],
    }),
    shellComponent: RootDocument,
})

function RootDocument({ children }: { children: ReactNode }) {
    return (
        <html lang="en">
            <head>
                <HeadContent />
            </head>
            <body>
                <AppProviders>{children}</AppProviders>
                <Scripts />
            </body>
        </html>
    )
}
