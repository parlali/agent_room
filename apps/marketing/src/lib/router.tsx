import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

type RouterValue = {
    path: string
    navigate: (to: string) => void
}

const RouterContext = createContext<RouterValue | null>(null)

function normalize(path: string): string {
    if (path.length > 1 && path.endsWith('/')) {
        return path.replace(/\/+$/, '')
    }
    return path
}

export function RouterProvider({ children }: { children: ReactNode }) {
    const [path, setPath] = useState(() => normalize(window.location.pathname))

    useEffect(() => {
        const onPop = () => setPath(normalize(window.location.pathname))
        window.addEventListener('popstate', onPop)
        return () => window.removeEventListener('popstate', onPop)
    }, [])

    const navigate = useCallback((to: string) => {
        const next = normalize(to)
        if (next === normalize(window.location.pathname)) {
            window.scrollTo({ top: 0 })
            return
        }
        window.history.pushState({}, '', next)
        setPath(next)
        window.scrollTo({ top: 0 })
    }, [])

    return <RouterContext.Provider value={{ path, navigate }}>{children}</RouterContext.Provider>
}

export function useRouter(): RouterValue {
    const value = useContext(RouterContext)
    if (!value) {
        throw new Error('useRouter must be used within RouterProvider')
    }
    return value
}
