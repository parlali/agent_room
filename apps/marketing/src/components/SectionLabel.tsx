type Props = {
    children: React.ReactNode
    className?: string
}

export function SectionLabel({ children, className }: Props) {
    return (
        <div className={`flex items-center gap-3 ${className ?? ''}`}>
            <span className="label-mono text-[var(--color-ink-dim)]">{children}</span>
            <span className="h-px flex-1 bg-[var(--color-rule)]" />
        </div>
    )
}
