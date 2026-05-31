import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { AppProviders } from '../providers/AppProviders'
import { Toaster } from '#/components/ui/sonner'
import { ThemeBootstrap } from '#/components/app-shell'
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
                href: '/favicon.ico',
                sizes: 'any',
            },
            {
                rel: 'icon',
                href: '/favicon.svg',
                type: 'image/svg+xml',
            },
            {
                rel: 'apple-touch-icon',
                href: '/apple-touch-icon.png',
            },
            {
                rel: 'manifest',
                href: '/site.webmanifest',
            },
        ],
        scripts: [
            {
                children: `
                    (function() {
                        try {
                            var stored = localStorage.getItem('agent-room.theme') || 'system'
                            var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
                            var dark = stored === 'dark' || (stored === 'system' && prefersDark)
                            if (dark) document.documentElement.classList.add('dark')
                        } catch (e) {}
                    })()
                `,
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
                <AppProviders>
                    <ThemeBootstrap />
                    {children}
                    <Toaster richColors closeButton position="bottom-right" />
                </AppProviders>
                <Scripts />
            </body>
        </html>
    )
}
