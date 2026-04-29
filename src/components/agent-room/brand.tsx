import { cn } from '#/lib/utils'

export function BrandMark({ className, size = 24 }: { className?: string; size?: number }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 1024 1024"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            role="img"
            aria-label="Agent Room mark"
            className={cn('text-foreground', className)}
        >
            <path
                d="M315 792V356L512 232L709 356V792H575M575 792H439V479H575"
                fill="none"
                stroke="currentColor"
                strokeWidth={72}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    )
}

export function BrandWordmark({
    className,
    showMark = true,
}: {
    className?: string
    showMark?: boolean
}) {
    return (
        <span className={cn('inline-flex items-center gap-2 text-foreground', className)}>
            {showMark ? <BrandMark size={22} /> : null}
            <span className="text-base font-semibold tracking-tight">Agent Room</span>
        </span>
    )
}
