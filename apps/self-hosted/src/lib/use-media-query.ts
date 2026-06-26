import { useEffect, useState } from 'react'

export function useMediaQuery(query: string): boolean {
    const [matches, setMatches] = useState(false)

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
        const mql = window.matchMedia(query)
        const sync = () => setMatches(mql.matches)
        sync()
        mql.addEventListener('change', sync)
        return () => mql.removeEventListener('change', sync)
    }, [query])

    return matches
}

export function useIsMobile(): boolean {
    return !useMediaQuery('(min-width: 640px)')
}
