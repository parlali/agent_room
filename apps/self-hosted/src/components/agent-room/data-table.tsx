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
    className,
}: {
    rows: T[]
    columns: DataColumn<T>[]
    getRowKey: (row: T, index: number) => string
    className?: string
}) {
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
                            <TableRow key={getRowKey(row, index)}>
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
                        className="space-y-1.5 px-4 py-3 text-sm outline-none"
                    >
                        {columns.map((column) => (
                            <div key={column.id} className="flex items-start justify-between gap-3">
                                <div className="shrink-0 text-xs text-muted-foreground">
                                    {column.header}
                                </div>
                                <div className="min-w-0 text-right">{column.cell(row)}</div>
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    )
}
