import { useEffect } from 'react'

export function AnchorScroll() {
    useEffect(() => {
        const onClick = (event: MouseEvent) => {
            const target = event.target
            if (!(target instanceof Element)) return

            const link = target.closest('a[href^="#"]')
            if (!(link instanceof HTMLAnchorElement)) return

            const hash = link.getAttribute('href')
            if (!hash || hash === '#') return

            const id = hash.slice(1)
            const section = document.getElementById(id)
            if (!section) return

            event.preventDefault()
            const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
            section.scrollIntoView({
                behavior: reduceMotion ? 'auto' : 'smooth',
                block: 'start',
            })
        }

        document.addEventListener('click', onClick)
        return () => document.removeEventListener('click', onClick)
    }, [])

    return null
}
