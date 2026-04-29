import { useEffect, useState } from 'react'
import { MoonIcon, SunIcon, MonitorIcon } from 'lucide-react'

import { Button } from '#/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'

type ThemeMode = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'agent-room.theme'

function applyMode(mode: ThemeMode) {
    const root = document.documentElement
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const dark = mode === 'dark' || (mode === 'system' && prefersDark)
    root.classList.toggle('dark', dark)
}

export function useThemeMode(): [ThemeMode, (mode: ThemeMode) => void] {
    const [mode, setModeState] = useState<ThemeMode>('system')

    useEffect(() => {
        const stored = (localStorage.getItem(STORAGE_KEY) as ThemeMode | null) ?? 'system'
        setModeState(stored)
        applyMode(stored)
        const mql = window.matchMedia('(prefers-color-scheme: dark)')
        const sync = () => {
            const current = (localStorage.getItem(STORAGE_KEY) as ThemeMode | null) ?? 'system'
            if (current === 'system') applyMode('system')
        }
        mql.addEventListener('change', sync)
        return () => mql.removeEventListener('change', sync)
    }, [])

    const setMode = (next: ThemeMode) => {
        localStorage.setItem(STORAGE_KEY, next)
        setModeState(next)
        applyMode(next)
    }

    return [mode, setMode]
}

export function ThemeToggle() {
    const [mode, setMode] = useThemeMode()
    const Icon = mode === 'dark' ? MoonIcon : mode === 'light' ? SunIcon : MonitorIcon

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Theme">
                    <Icon />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setMode('light')}>
                    <SunIcon /> Light
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setMode('dark')}>
                    <MoonIcon /> Dark
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setMode('system')}>
                    <MonitorIcon /> System
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

export function ThemeBootstrap() {
    useEffect(() => {
        const stored = (localStorage.getItem(STORAGE_KEY) as ThemeMode | null) ?? 'system'
        applyMode(stored)
    }, [])
    return null
}
