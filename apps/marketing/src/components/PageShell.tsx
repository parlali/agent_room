import type { ReactNode } from 'react'

import type { SeoMeta } from '~/content/types'
import { useMeta } from '~/lib/useMeta'
import { Header } from './Header'
import { Footer } from './Footer'

export function PageShell({ meta, children }: { meta: SeoMeta; children: ReactNode }) {
    useMeta(meta)

    return (
        <div className="flex min-h-screen flex-col">
            <Header />
            <main className="flex-1">{children}</main>
            <Footer />
        </div>
    )
}
