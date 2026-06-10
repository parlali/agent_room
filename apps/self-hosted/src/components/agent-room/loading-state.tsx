import { cn } from '#/lib/utils'
import { Skeleton } from '#/components/ui/skeleton'

export function LoadingRows({ count = 3, className }: { count?: number; className?: string }) {
    return (
        <div className={cn('space-y-2', className)} data-slot="loading-rows">
            {Array.from({ length: count }).map((_, i) => (
                <div
                    key={i}
                    className="flex items-center gap-3 rounded-lg border border-border/60 bg-card px-3 py-2.5"
                >
                    <Skeleton className="size-7 rounded-md" />
                    <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-3.5 w-1/2" />
                        <Skeleton className="h-3 w-1/3" />
                    </div>
                </div>
            ))}
        </div>
    )
}

export function LoadingCards({ count = 3, className }: { count?: number; className?: string }) {
    return (
        <div
            className={cn('grid gap-3 sm:grid-cols-2 lg:grid-cols-3', className)}
            data-slot="loading-cards"
        >
            {Array.from({ length: count }).map((_, i) => (
                <div
                    key={i}
                    className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card p-4"
                >
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-2/3" />
                    <Skeleton className="h-20 w-full" />
                </div>
            ))}
        </div>
    )
}

export function LoadingPage({ className }: { className?: string }) {
    return (
        <div
            className={cn('space-y-6 p-6', className)}
            data-slot="loading-page"
            role="status"
            aria-label="Loading"
        >
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-4 w-1/2" />
            <LoadingCards count={3} />
            <LoadingRows count={4} />
        </div>
    )
}
