import { cn } from '#/lib/utils'
import { toneStyles, type Tone } from '#/domain/state'

export function StatusDot({
    tone,
    className,
    pulse = false,
    label,
}: {
    tone: Tone
    className?: string
    pulse?: boolean
    label?: string
}) {
    return (
        <span
            data-slot="status-dot"
            data-tone={tone}
            title={label}
            aria-label={label}
            role={label ? 'img' : undefined}
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
