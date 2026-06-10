import { useEffect } from 'react'

import { defaultOgImage } from '~/content/assets'
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

function absoluteImageUrl(imagePath: string): string {
    if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
        return imagePath
    }

    return new URL(imagePath, window.location.origin).toString()
}

export function useMeta(meta: SeoMeta) {
    useEffect(() => {
        const image = absoluteImageUrl(meta.image ?? defaultOgImage)

        document.title = meta.title
        setMeta('description', meta.description)
        setMeta('og:title', meta.title, 'property')
        setMeta('og:description', meta.description, 'property')
        setMeta('og:image', image, 'property')
        setMeta('twitter:title', meta.title)
        setMeta('twitter:description', meta.description)
        setMeta('twitter:image', image)
    }, [meta.title, meta.description, meta.image])
}
