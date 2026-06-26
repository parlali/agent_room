import { useEffect, useState } from 'react'

export type ThemeMode = 'light' | 'dark' | 'system'

export const THEME_STORAGE_KEY = 'agent-room.theme'
export const THEME_MODES: ThemeMode[] = ['light', 'dark', 'system']

export function systemPrefersDark(): boolean {
    return (
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches
    )
}

export function resolveDark(mode: ThemeMode): boolean {
    return mode === 'dark' || (mode === 'system' && systemPrefersDark())
}

export function applyTheme(mode: ThemeMode): void {
    if (typeof document === 'undefined') return
    document.documentElement.classList.toggle('dark', resolveDark(mode))
}

export function readStoredTheme(): ThemeMode {
    if (typeof window === 'undefined') return 'system'
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
}

export const themeInitScript = `(function(){try{var k='${THEME_STORAGE_KEY}';var s=localStorage.getItem(k)||'system';var d=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;if(s==='dark'||(s==='system'&&d)){document.documentElement.classList.add('dark')}}catch(e){}})()`

export function useThemeMode(): [ThemeMode, (mode: ThemeMode) => void] {
    const [mode, setModeState] = useState<ThemeMode>('system')

    useEffect(() => {
        const stored = readStoredTheme()
        setModeState(stored)
        applyTheme(stored)
        const mql = window.matchMedia('(prefers-color-scheme: dark)')
        const sync = () => {
            if (readStoredTheme() === 'system') applyTheme('system')
        }
        mql.addEventListener('change', sync)
        return () => mql.removeEventListener('change', sync)
    }, [])

    const setMode = (next: ThemeMode) => {
        window.localStorage.setItem(THEME_STORAGE_KEY, next)
        setModeState(next)
        applyTheme(next)
    }

    return [mode, setMode]
}
