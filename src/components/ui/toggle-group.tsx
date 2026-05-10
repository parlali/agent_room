import * as React from 'react'
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui'
import { type VariantProps } from 'class-variance-authority'

import { cn } from '#/lib/utils'
import { buttonVariants } from '#/components/ui/button'

const ToggleGroupContext = React.createContext<
    VariantProps<typeof buttonVariants> & {
        size?: VariantProps<typeof buttonVariants>['size']
        variant?: VariantProps<typeof buttonVariants>['variant']
    }
>({
    size: 'default',
    variant: 'outline',
})

function ToggleGroup({
    className,
    variant = 'outline',
    size = 'default',
    children,
    ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root> & VariantProps<typeof buttonVariants>) {
    return (
        <ToggleGroupPrimitive.Root
            data-slot="toggle-group"
            data-variant={variant}
            data-size={size}
            className={cn(
                'group/toggle-group flex w-fit items-center rounded-lg border border-border bg-background p-0.5',
                className,
            )}
            {...props}
        >
            <ToggleGroupContext.Provider value={{ variant, size }}>
                {children}
            </ToggleGroupContext.Provider>
        </ToggleGroupPrimitive.Root>
    )
}

function ToggleGroupItem({
    className,
    children,
    variant,
    size,
    ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> & VariantProps<typeof buttonVariants>) {
    const context = React.useContext(ToggleGroupContext)

    return (
        <ToggleGroupPrimitive.Item
            data-slot="toggle-group-item"
            data-variant={context.variant || variant}
            data-size={context.size || size}
            className={cn(
                buttonVariants({
                    variant: context.variant || variant,
                    size: context.size || size,
                }),
                'min-w-0 flex-1 cursor-pointer border-0 shadow-none data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:ring-1 data-[state=on]:ring-border',
                className,
            )}
            {...props}
        >
            {children}
        </ToggleGroupPrimitive.Item>
    )
}

export { ToggleGroup, ToggleGroupItem }
