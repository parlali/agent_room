import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import type { ReactNode } from 'react'

export function AppProviders(props: { children: ReactNode }) {
    const [queryClient] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        staleTime: 10_000,
                        refetchOnWindowFocus: false,
                    },
                },
            }),
    )

    return <QueryClientProvider client={queryClient}>{props.children}</QueryClientProvider>
}
