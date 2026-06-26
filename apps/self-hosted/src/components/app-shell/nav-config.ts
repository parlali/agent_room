import { useQuery } from '@tanstack/react-query'
import type { LinkProps } from '@tanstack/react-router'
import {
    CreditCardIcon,
    HomeIcon,
    SettingsIcon,
    SlidersHorizontalIcon,
    type LucideIcon,
} from 'lucide-react'

import { authSurfaceServer } from '#/routes/-auth-server'
import { roomQueryKey, roomQueryPolicy } from '#/lib/room-query-keys'

export interface AccountNavItem {
    id: 'home' | 'settings' | 'billing' | 'operator'
    label: string
    icon: LucideIcon
    hostedOnly: boolean
    link: LinkProps
    match: (pathname: string) => boolean
}

export const accountNavItems: AccountNavItem[] = [
    {
        id: 'home',
        label: 'Home',
        icon: HomeIcon,
        hostedOnly: false,
        link: { to: '/' },
        match: (pathname) => pathname === '/',
    },
    {
        id: 'settings',
        label: 'Settings',
        icon: SettingsIcon,
        hostedOnly: false,
        link: { to: '/settings' },
        match: (pathname) => pathname.startsWith('/settings'),
    },
    {
        id: 'billing',
        label: 'Billing',
        icon: CreditCardIcon,
        hostedOnly: true,
        link: { to: '/billing', search: { checkout: null } },
        match: (pathname) => pathname.startsWith('/billing'),
    },
    {
        id: 'operator',
        label: 'Operator',
        icon: SlidersHorizontalIcon,
        hostedOnly: false,
        link: {
            to: '/operator',
            search: { installationId: '', setupAction: '', githubState: '' },
        },
        match: (pathname) => pathname.startsWith('/operator'),
    },
]

export function useHostedDeployment(): boolean {
    const query = useQuery({
        queryKey: roomQueryKey.authSurface,
        queryFn: () => authSurfaceServer(),
        staleTime: roomQueryPolicy.coldStaleMs,
        gcTime: 15 * 60_000,
    })
    return query.data?.hosted === true
}

export function useAccountNavItems(): AccountNavItem[] {
    const hosted = useHostedDeployment()
    return accountNavItems.filter((item) => !item.hostedOnly || hosted)
}
