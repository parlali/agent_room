import { TriangleAlertIcon, RefreshCwIcon } from 'lucide-react'

import { Button } from '#/components/ui/button'

export function ErrorFallback({
    error,
    reset,
    title = 'Something went wrong',
}: {
    error: unknown
    reset?: () => void
    title?: string
}) {
    const message =
        error instanceof Error
            ? error.message
            : typeof error === 'string'
              ? error
              : 'An unexpected error occurred.'

    return (
        <div
            role="alert"
            className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 py-12 text-center"
        >
            <span className="flex size-12 items-center justify-center rounded-full bg-attention-soft text-attention-fg">
                <TriangleAlertIcon className="size-5" />
            </span>
            <div className="space-y-1">
                <h2 className="text-base font-semibold tracking-tight">{title}</h2>
                <p className="text-sm text-muted-foreground">{message}</p>
            </div>
            {reset ? (
                <Button variant="outline" size="sm" onClick={reset}>
                    <RefreshCwIcon /> Try again
                </Button>
            ) : null}
        </div>
    )
}

export function NotFound({
    title = 'Not found',
    description = 'The page you were looking for does not exist or has moved.',
    action,
}: {
    title?: string
    description?: string
    action?: React.ReactNode
}) {
    return (
        <div
            role="status"
            className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 py-12 text-center"
        >
            <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    404
                </p>
                <h2 className="text-base font-semibold tracking-tight">{title}</h2>
                <p className="text-sm text-muted-foreground">{description}</p>
            </div>
            {action}
        </div>
    )
}
