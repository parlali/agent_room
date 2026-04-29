import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { LogOutIcon, UserIcon, SettingsIcon } from 'lucide-react'

import { Button } from '#/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { logoutServer } from '#/routes/-auth-server'
import type { AuthUserSnapshot } from '#/routes/-auth-server'
import { initialsFromName } from '#/lib/format'
import { ThemeToggle } from './theme-toggle'

export function UserMenu({ user }: { user: AuthUserSnapshot | null }) {
    const queryClient = useQueryClient()
    const navigate = useNavigate()

    const logout = useMutation({
        mutationFn: () => logoutServer(),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['auth-current-user'] })
            navigate({ to: '/login' })
        },
    })

    if (!user) return null

    const initials = initialsFromName(user.email.split('@')[0] ?? user.email, '··')

    return (
        <div className="flex items-center gap-1">
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        className="h-9 flex-1 justify-start gap-2 px-2 hover:bg-sidebar-accent"
                    >
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-foreground text-[0.6875rem] font-semibold text-background">
                            {initials}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-left text-xs text-muted-foreground">
                            {user.email}
                        </span>
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" className="w-56">
                    <DropdownMenuLabel>
                        <div className="text-sm font-medium">{user.email}</div>
                        <div className="text-xs font-normal text-muted-foreground">
                            {user.role === 'root' ? 'Root operator' : 'Operator'}
                        </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => navigate({ to: '/settings' })}>
                        <SettingsIcon /> Settings
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => navigate({ to: '/about' })}>
                        <UserIcon /> About
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => logout.mutate()} disabled={logout.isPending}>
                        <LogOutIcon /> Sign out
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            <ThemeToggle />
        </div>
    )
}
