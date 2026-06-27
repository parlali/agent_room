'use client'

import * as React from 'react'
import { Progress as ProgressPrimitive } from 'radix-ui'

import { cn } from '#/lib/utils'

function Progress({
    className,
    value,
    ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
    const max = props.max ?? 100
    const progress = value === null || value === undefined ? 0 : Math.min(Math.max(value, 0), max)
    const percent = max > 0 ? (progress / max) * 100 : 0
    return (
        <ProgressPrimitive.Root
            data-slot="progress"
            value={value}
            className={cn(
                'relative flex h-1 w-full items-center overflow-x-hidden rounded-full bg-muted',
                className,
            )}
            {...props}
        >
            <ProgressPrimitive.Indicator
                data-slot="progress-indicator"
                className="size-full flex-1 bg-primary transition-all"
                style={{ transform: `translateX(-${100 - percent}%)` }}
            />
        </ProgressPrimitive.Root>
    )
}

export { Progress }
