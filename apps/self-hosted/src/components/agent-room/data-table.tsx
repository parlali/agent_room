import type { ReactNode } from 'react'

import { cn } from '#/lib/utils'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '#/components/ui/table'

export interface DataColumn<T> {
    id: string
    header: ReactNode
    cell: (row: T) => ReactNode
    align?: 'start' | 'center' | 'end'
    width?: string
    mobileHidden?: boolean
}

function alignClass(align: DataColumn<unknown>['align']): string {
    if (align === 'end') return 'text-right'
    if (align === 'center') return 'text-center'
    return 'text-left'
}

export function DataTable<T>({
    rows,
    columns,
    getRowKey,
    onRowClick,
    empty,
    className,
}: {
    rows: T[]
    columns: DataColumn<T>[]
    getRowKey: (row: T, index: number) => string
    onRowClick?: (row: T) => void
    empty?: ReactNode
    className?: string
}) {
    if (rows.length === 0) {
        return (
            <div
                data-slot="data-table-empty"
                className={cn(
                    'rounded-xl border border-border/70 bg-card px-4 py-8 text-center text-sm text-muted-foreground',
                    className,
                )}
            >
                {empty ?? 'Nothing here yet.'}
            </div>
        )
    }

    const interactive = Boolean(onRowClick)

    return (
        <div
            data-slot="data-table"
            className={cn('overflow-hidden rounded-xl border border-border/70 bg-card', className)}
        >
            <div className="hidden sm:block">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                            {columns.map((column) => (
                                <TableHead
                                    key={column.id}
                                    style={column.width ? { width: column.width } : undefined}
                                    className={cn(
                                        'text-xs uppercase tracking-wide text-muted-foreground',
                                        alignClass(column.align),
                                    )}
                                >
                                    {column.header}
                                </TableHead>
                            ))}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.map((row, index) => (
                            <TableRow
                                key={getRowKey(row, index)}
                                role={interactive ? 'button' : undefined}
                                tabIndex={interactive ? 0 : undefined}
                                onClick={interactive ? () => onRowClick?.(row) : undefined}
                                onKeyDown={
                                    interactive
                                        ? (event) => {
                                              if (event.key === 'Enter' || event.key === ' ') {
                                                  event.preventDefault()
                                                  onRowClick?.(row)
                                              }
                                          }
                                        : undefined
                                }
                                className={cn(interactive && 'cursor-pointer')}
                            >
                                {columns.map((column) => (
                                    <TableCell
                                        key={column.id}
                                        className={cn('align-middle', alignClass(column.align))}
                                    >
                                        {column.cell(row)}
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
            <div className="divide-y divide-border/60 sm:hidden">
                {rows.map((row, index) => (
                    <div
                        key={getRowKey(row, index)}
                        role={interactive ? 'button' : undefined}
                        tabIndex={interactive ? 0 : undefined}
                        onClick={interactive ? () => onRowClick?.(row) : undefined}
                        onKeyDown={
                            interactive
                                ? (event) => {
                                      if (event.key === 'Enter' || event.key === ' ') {
                                          event.preventDefault()
                                          onRowClick?.(row)
                                      }
                                  }
                                : undefined
                        }
                        className={cn(
                            'space-y-1.5 px-4 py-3 text-sm outline-none',
                            interactive &&
                                'cursor-pointer transition-colors hover:bg-muted/40 focus-visible:bg-muted/40',
                        )}
                    >
                        {columns
                            .filter((column) => !column.mobileHidden)
                            .map((column) => (
                                <div
                                    key={column.id}
                                    className="flex items-start justify-between gap-3"
                                >
                                    <span className="shrink-0 text-xs text-muted-foreground">
                                        {column.header}
                                    </span>
                                    <span className="min-w-0 text-right">{column.cell(row)}</span>
                                </div>
                            ))}
                    </div>
                ))}
            </div>
        </div>
    )
}
