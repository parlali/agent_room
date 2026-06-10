import type { ReactNode } from 'react'
import { TriangleAlertIcon, InfoIcon, OctagonXIcon } from 'lucide-react'

import { cn } from '#/lib/utils'
import { toneStyles, type Tone } from '#/domain/state'

const ToneIcon = {
    attention: TriangleAlertIcon,
    danger: OctagonXIcon,
    info: InfoIcon,
    ready: InfoIcon,
    working: InfoIcon,
    muted: InfoIcon,
} as const

export function AttentionBanner({
    tone = 'attention',
    title,
    description,
    action,
    className,
}: {
    tone?: Tone
    title: string
    description?: ReactNode
    action?: ReactNode
    className?: string
}) {
    const Icon = ToneIcon[tone]
    return (
        <div
            data-slot="attention-banner"
            data-tone={tone}
            className={cn(
                'flex items-start gap-3 rounded-lg border border-transparent px-3.5 py-3 text-sm',
                toneStyles[tone].chip,
                className,
            )}
            role={tone === 'danger' ? 'alert' : 'status'}
        >
            <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
                <div className="font-medium">{title}</div>
                {description ? (
                    <div className="mt-0.5 text-[0.8125rem] leading-relaxed opacity-90">
                        {description}
                    </div>
                ) : null}
            </div>
            {action ? <div className="shrink-0">{action}</div> : null}
        </div>
    )
}
