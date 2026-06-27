import type { ReactNode } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { BottomTabBar, BrandWordmark, bottomTabClass } from '#/components/agent-room'
import { currentUserServer } from '#/routes/-auth-server'
import { roomQueryKey } from '#/lib/room-query-keys'
import { Sidebar } from './sidebar'
import { UserMenu } from './user-menu'
import { useAccountNavItems } from './nav-config'

export function AppShell({ children }: { children: ReactNode }) {
    return (
        <div className="flex h-dvh w-full overflow-hidden">
            <aside className="hidden h-full w-[var(--sidebar-width,17rem)] shrink-0 overflow-hidden border-r border-border md:block">
                <Sidebar />
            </aside>

            <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <header className="z-20 flex shrink-0 items-center gap-2 border-b border-border bg-background/95 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur md:hidden">
                    <Link to="/" aria-label="Home">
                        <BrandWordmark />
                    </Link>
                </header>

                <main className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</main>

                <MobileTabBar />
            </div>
        </div>
    )
}

function MobileTabBar() {
    const pathname = useRouterState({ select: (s) => s.location.pathname })
    const accountNavItems = useAccountNavItems()
    const userQuery = useQuery({
        queryKey: roomQueryKey.authUser,
        queryFn: () => currentUserServer(),
        staleTime: 5 * 60_000,
        gcTime: 15 * 60_000,
    })

    return (
        <BottomTabBar className="md:hidden">
            {accountNavItems.map((item) => {
                const Icon = item.icon
                const active = item.match(pathname)
                return (
                    <Link key={item.id} {...item.link} className={bottomTabClass(active)}>
                        <Icon />
                        {item.label}
                    </Link>
                )
            })}
            <UserMenu user={userQuery.data ?? null} variant="tab" />
        </BottomTabBar>
    )
}
