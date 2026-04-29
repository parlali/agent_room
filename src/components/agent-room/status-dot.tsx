import { cn } from '#/lib/utils'
import { toneStyles, type Tone } from '#/lib/state'

export function StatusDot({
    tone,
    className,
    pulse = false,
}: {
    tone: Tone
    className?: string
    pulse?: boolean
}) {
    return (
        <span
            data-slot="status-dot"
            data-tone={tone}
            className={cn(
                'relative inline-flex size-2 shrink-0 rounded-full',
                toneStyles[tone].dot,
                className,
            )}
        >
            {pulse ? (
                <span
                    aria-hidden
                    className={cn(
                        'absolute inset-0 animate-ping rounded-full opacity-60',
                        toneStyles[tone].dot,
                    )}
                />
            ) : null}
        </span>
    )
}
