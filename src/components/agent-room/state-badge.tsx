import { cn } from '#/lib/utils'
import { toneStyles, type Tone } from '#/lib/state'
import { StatusDot } from './status-dot'

export function StateBadge({
    tone,
    label,
    className,
    showDot = true,
    pulse,
}: {
    tone: Tone
    label: string
    className?: string
    showDot?: boolean
    pulse?: boolean
}) {
    return (
        <span
            data-slot="state-badge"
            data-tone={tone}
            className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium leading-tight',
                toneStyles[tone].chip,
                className,
            )}
        >
            {showDot ? <StatusDot tone={tone} pulse={pulse} className="size-1.5" /> : null}
            <span className="truncate">{label}</span>
        </span>
    )
}
