import { Skeleton } from '#/components/ui/skeleton'

export function ChatSkeleton() {
    return (
        <div className="flex min-h-svh flex-col">
            <div className="flex items-center gap-2 border-b border-border bg-background px-3 py-2.5 sm:px-6">
                <Skeleton className="size-7 rounded-md" />
                <Skeleton className="size-7 rounded-md" />
                <div className="flex flex-col gap-1">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3.5 w-40" />
                </div>
            </div>
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6">
                <Skeleton className="h-16 w-3/4" />
                <Skeleton className="ml-auto h-12 w-1/2" />
                <Skeleton className="h-20 w-2/3" />
            </div>
        </div>
    )
}
