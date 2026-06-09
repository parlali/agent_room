import type { ReactElement } from 'react'

import { RouterProvider, useRouter } from '~/lib/router'
import { Home } from '~/pages/Home'
import { Features } from '~/pages/Features'
import { Pricing } from '~/pages/Pricing'
import { Security } from '~/pages/Security'
import { Source } from '~/pages/Source'
import { Terms } from '~/pages/Terms'
import { Privacy } from '~/pages/Privacy'

const routes: Record<string, () => ReactElement> = {
    '/': Home,
    '/features': Features,
    '/pricing': Pricing,
    '/security': Security,
    '/source': Source,
    '/terms': Terms,
    '/privacy': Privacy,
}

function Routed() {
    const { path } = useRouter()
    const Page = routes[path] ?? Home
    return <Page />
}

export default function App() {
    return (
        <RouterProvider>
            <Routed />
        </RouterProvider>
    )
}
