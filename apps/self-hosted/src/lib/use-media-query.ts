import { useEffect, useState } from 'react'

export function useIsMobile(): boolean {
    const [isMobile, setIsMobile] = useState(false)

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
        const mql = window.matchMedia('(min-width: 640px)')
        const sync = () => setIsMobile(!mql.matches)
        sync()
        mql.addEventListener('change', sync)
        return () => mql.removeEventListener('change', sync)
    }, [])

    return isMobile
}
