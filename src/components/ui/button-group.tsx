import * as React from 'react'
import { Slot } from 'radix-ui'

import { cn } from '#/lib/utils'

function ButtonGroup({
    className,
    orientation = 'horizontal',
    ...props
}: React.ComponentProps<'div'> & {
    orientation?: 'horizontal' | 'vertical'
}) {
    return (
        <div
            data-slot="button-group"
            data-orientation={orientation}
            role="group"
            className={cn(
                'inline-flex w-fit items-center rounded-lg bg-muted p-0.5 data-[orientation=vertical]:flex-col',
                '[&>[data-slot=button]]:min-w-0 [&>[data-slot=button]]:flex-1 [&>[data-slot=button]]:border-0 [&>[data-slot=button]]:shadow-none',
                className,
            )}
            {...props}
        />
    )
}

function ButtonGroupSeparator({
    className,
    orientation = 'vertical',
    ...props
}: React.ComponentProps<'div'> & {
    orientation?: 'horizontal' | 'vertical'
}) {
    return (
        <div
            data-slot="button-group-separator"
            data-orientation={orientation}
            role="separator"
            className={cn(
                'bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-4 data-[orientation=vertical]:w-px',
                className,
            )}
            {...props}
        />
    )
}

function ButtonGroupText({
    className,
    asChild = false,
    ...props
}: React.ComponentProps<'div'> & {
    asChild?: boolean
}) {
    const Comp = asChild ? Slot.Root : 'div'

    return (
        <Comp
            data-slot="button-group-text"
            className={cn('flex h-8 items-center px-2 text-sm text-muted-foreground', className)}
            {...props}
        />
    )
}

export { ButtonGroup, ButtonGroupSeparator, ButtonGroupText }
