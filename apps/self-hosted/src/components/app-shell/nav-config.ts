import { useQuery } from '@tanstack/react-query'
import type { LinkProps } from '@tanstack/react-router'
import { CreditCardIcon, HomeIcon, type LucideIcon } from 'lucide-react'

import { authSurfaceServer } from '#/routes/-auth-server'
import { roomQueryKey, roomQueryPolicy } from '#/lib/room-query-keys'

export interface AccountNavItem {
    id: 'home' | 'billing'
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
        id: 'billing',
        label: 'Billing',
        icon: CreditCardIcon,
        hostedOnly: true,
        link: { to: '/billing', search: { checkout: null } },
        match: (pathname) => pathname.startsWith('/billing'),
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
