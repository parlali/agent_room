import type { ReactNode } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '#/components/ui/collapsible'
import { CardButton } from '#/components/ui/card'
import { cn } from '#/lib/utils'

export function ModeRadio({
    label,
    description,
    checked,
    disabled,
    onSelect,
}: {
    label: string
    description: string
    checked: boolean
    disabled?: boolean
    onSelect: () => void
}) {
    return (
        <CardButton
            onClick={onSelect}
            disabled={disabled}
            className={cn(
                'flex-col items-start gap-1 px-3 py-2',
                checked
                    ? 'border-foreground bg-muted/40 text-foreground'
                    : 'border-border/70 text-muted-foreground hover:border-border hover:text-foreground',
            )}
            aria-pressed={checked}
        >
            <span className="font-medium">{label}</span>
            <span className="text-xs">{description}</span>
        </CardButton>
    )
}

export function Disclosure({
    title,
    description,
    defaultOpen,
    children,
}: {
    title: string
    description?: string
    defaultOpen?: boolean
    children: ReactNode
}) {
    return (
        <Collapsible defaultOpen={defaultOpen} className="space-y-3">
            <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 rounded-xl border border-border/70 bg-card px-4 py-3 text-left">
                <span className="min-w-0">
                    <span className="block text-sm font-semibold tracking-tight text-foreground">
                        {title}
                    </span>
                    {description ? (
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                            {description}
                        </span>
                    ) : null}
                </span>
                <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4">{children}</CollapsibleContent>
        </Collapsible>
    )
}

export function InlineDisclosure({
    label,
    defaultOpen,
    children,
}: {
    label: string
    defaultOpen?: boolean
    children: ReactNode
}) {
    return (
        <Collapsible defaultOpen={defaultOpen} className="space-y-3">
            <CollapsibleTrigger className="group flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
                <ChevronDownIcon className="size-4 transition-transform group-data-[state=open]:rotate-180" />
                {label}
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4">{children}</CollapsibleContent>
        </Collapsible>
    )
}
