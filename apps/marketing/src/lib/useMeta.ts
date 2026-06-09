import { useEffect } from 'react'

import type { SeoMeta } from '~/content/types'

function setMeta(name: string, content: string, attr: 'name' | 'property' = 'name') {
    let tag = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`)
    if (!tag) {
        tag = document.createElement('meta')
        tag.setAttribute(attr, name)
        document.head.appendChild(tag)
    }
    tag.setAttribute('content', content)
}

export function useMeta(meta: SeoMeta) {
    useEffect(() => {
        document.title = meta.title
        setMeta('description', meta.description)
        setMeta('og:title', meta.title, 'property')
        setMeta('og:description', meta.description, 'property')
    }, [meta.title, meta.description])
}
