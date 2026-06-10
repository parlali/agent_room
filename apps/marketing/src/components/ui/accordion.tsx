import * as AccordionPrimitive from '@radix-ui/react-accordion'
import type { ComponentProps } from 'react'

function Accordion(props: ComponentProps<typeof AccordionPrimitive.Root>) {
    return <AccordionPrimitive.Root data-slot="accordion" {...props} />
}

function AccordionItem({
    className = '',
    ...props
}: ComponentProps<typeof AccordionPrimitive.Item>) {
    return (
        <AccordionPrimitive.Item
            data-slot="accordion-item"
            className={`border-b border-line last:border-b-0 ${className}`}
            {...props}
        />
    )
}

function AccordionTrigger({
    className = '',
    children,
    ...props
}: ComponentProps<typeof AccordionPrimitive.Trigger>) {
    return (
        <AccordionPrimitive.Header className="flex">
            <AccordionPrimitive.Trigger
                data-slot="accordion-trigger"
                className={`flex flex-1 cursor-pointer items-center justify-between gap-4 px-6 py-5 text-left text-sm font-medium text-ink transition-colors hover:bg-paper-sunken/50 [&[data-state=open]>svg]:rotate-180 ${className}`}
                {...props}
            >
                {children}
                <svg
                    aria-hidden
                    viewBox="0 0 16 16"
                    fill="none"
                    className="size-4 flex-none text-ink-faint transition-transform duration-200"
                >
                    <path
                        d="M4 6l4 4 4-4"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            </AccordionPrimitive.Trigger>
        </AccordionPrimitive.Header>
    )
}

function AccordionContent({
    className = '',
    children,
    ...props
}: ComponentProps<typeof AccordionPrimitive.Content>) {
    return (
        <AccordionPrimitive.Content
            data-slot="accordion-content"
            className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down"
            {...props}
        >
            <div className={`px-6 pb-5 text-sm leading-relaxed text-ink-soft ${className}`}>
                {children}
            </div>
        </AccordionPrimitive.Content>
    )
}

export { Accordion, AccordionContent, AccordionItem, AccordionTrigger }
