import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
    BarChart3Icon,
    CreditCardIcon,
    LogOutIcon,
    MonitorIcon,
    MoonIcon,
    SettingsIcon,
    SunIcon,
    UserIcon,
} from 'lucide-react'

import { Button } from '#/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from '#/components/ui/toggle-group'
import { logoutServer } from '#/routes/-auth-server'
import type { AuthUserSnapshot } from '#/routes/-auth-server'
import { initialsFromName } from '#/domain/format'
import { roomQueryKey } from '#/lib/room-query-keys'
import { useThemeMode } from '#/lib/theme'

export function UserMenu({ user }: { user: AuthUserSnapshot | null }) {
    const queryClient = useQueryClient()
    const navigate = useNavigate()
    const [themeMode, setThemeMode] = useThemeMode()

    const logout = useMutation({
        mutationFn: () => logoutServer(),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: roomQueryKey.authUser })
            navigate({ to: '/login' })
        },
    })

    if (!user) return null

    const initials = initialsFromName(user.email.split('@')[0] ?? user.email, '··')

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    className="h-9 w-full justify-start gap-2 px-2 hover:bg-sidebar-accent"
                >
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-foreground text-[0.6875rem] font-semibold text-background">
                        {initials}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-left text-xs text-muted-foreground">
                        {user.email}
                    </span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-64 p-1.5">
                <DropdownMenuLabel className="px-2 py-1.5">
                    <div className="truncate text-sm font-medium">{user.email}</div>
                    <div className="mt-0.5 text-xs font-normal text-muted-foreground">
                        {user.role === 'root' ? 'Root operator' : 'Operator'}
                    </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    className="h-8 px-2 text-sm"
                    onSelect={() =>
                        navigate({
                            to: '/settings',
                            search: {
                                installationId: '',
                                setupAction: '',
                                githubState: '',
                            },
                        })
                    }
                >
                    <SettingsIcon className="size-4" />
                    Settings
                </DropdownMenuItem>
                <DropdownMenuItem
                    className="h-8 px-2 text-sm"
                    onSelect={() => navigate({ to: '/usage' })}
                >
                    <BarChart3Icon className="size-4" />
                    Usage & Activity
                </DropdownMenuItem>
                <DropdownMenuItem
                    className="h-8 px-2 text-sm"
                    onSelect={() =>
                        navigate({
                            to: '/billing',
                            search: {
                                checkout: null,
                            },
                        })
                    }
                >
                    <CreditCardIcon className="size-4" />
                    Billing
                </DropdownMenuItem>
                <div className="px-2 py-1.5">
                    <div className="mb-1.5 text-xs font-medium text-muted-foreground">Theme</div>
                    <ToggleGroup
                        type="single"
                        value={themeMode}
                        onValueChange={(value) => {
                            if (value === 'light' || value === 'dark' || value === 'system') {
                                setThemeMode(value)
                            }
                        }}
                        variant="ghost"
                        size="icon-sm"
                        className="grid h-8 w-full grid-cols-3 rounded-md bg-muted/40 p-0.5"
                        aria-label="Theme"
                    >
                        <ToggleGroupItem
                            value="light"
                            aria-label="Light theme"
                            className="h-7 rounded-[calc(var(--radius-md)-2px)]"
                        >
                            <SunIcon className="size-4" />
                        </ToggleGroupItem>
                        <ToggleGroupItem
                            value="dark"
                            aria-label="Dark theme"
                            className="h-7 rounded-[calc(var(--radius-md)-2px)]"
                        >
                            <MoonIcon className="size-4" />
                        </ToggleGroupItem>
                        <ToggleGroupItem
                            value="system"
                            aria-label="System theme"
                            className="h-7 rounded-[calc(var(--radius-md)-2px)]"
                        >
                            <MonitorIcon className="size-4" />
                        </ToggleGroupItem>
                    </ToggleGroup>
                </div>
                <DropdownMenuItem
                    className="h-8 px-2 text-sm"
                    onSelect={() => navigate({ to: '/about' })}
                >
                    <UserIcon className="size-4" />
                    About
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    className="h-8 px-2 text-sm"
                    onSelect={() => logout.mutate()}
                    disabled={logout.isPending}
                >
                    <LogOutIcon className="size-4" />
                    Sign out
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
