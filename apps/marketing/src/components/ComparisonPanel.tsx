import type { Comparison } from '~/content/types'
import { StatusDot } from './primitives'

const rowGrid = 'sm:grid-cols-[6.5rem_1fr_1fr] sm:gap-x-8 lg:grid-cols-[7.5rem_1fr_1fr] lg:gap-x-10'

export function ComparisonPanel({
    comparison,
    className = '',
}: {
    comparison: Comparison
    className?: string
}) {
    const { columns, rows } = comparison

    return (
        <div className={`surface-raised overflow-hidden ${className}`}>
            <div
                className={`hidden border-b border-line bg-paper-sunken/60 px-7 py-4 sm:grid ${rowGrid}`}
            >
                <span aria-hidden />
                {columns.map((column) => (
                    <p
                        key={column.label}
                        className="flex items-center gap-2.5 font-mono text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-ink"
                    >
                        <StatusDot tone={column.tone} />
                        {column.label}
                    </p>
                ))}
            </div>
            {rows.map((row, index) => (
                <div
                    key={row.label}
                    className={`grid gap-y-3 px-6 py-5 sm:px-7 ${rowGrid} ${
                        index > 0 ? 'border-t border-line' : ''
                    }`}
                >
                    <p className="font-mono text-[0.6875rem] font-medium uppercase tracking-[0.12em] text-ink-faint sm:pt-0.5">
                        {row.label}
                    </p>
                    {row.cells.map((cell, cellIndex) => (
                        <div key={columns[cellIndex].label}>
                            <p className="mb-1.5 flex items-center gap-2 font-mono text-[0.625rem] font-medium uppercase tracking-[0.12em] text-ink-soft sm:hidden">
                                <StatusDot tone={columns[cellIndex].tone} />
                                {columns[cellIndex].label}
                            </p>
                            <p className="text-sm leading-relaxed text-ink-soft">{cell}</p>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    )
}
