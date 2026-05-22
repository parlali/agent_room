type Props = {
    index?: string
    children: React.ReactNode
    className?: string
}

export function SectionLabel({ index, children, className }: Props) {
    return (
        <div className={`flex items-center gap-3 ${className ?? ''}`}>
            <span className="label-mono text-[var(--color-ink-dim)]">
                {index ? `${index} · ` : ''}
                {children}
            </span>
            <span className="h-px flex-1 bg-[var(--color-rule)]" />
        </div>
    )
}
