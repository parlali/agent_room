import type { ReactNode } from 'react'
import { PencilIcon, type PlugIcon, PlusIcon, Trash2Icon } from 'lucide-react'

import { EmptyState, LoadingRows, Section } from '#/components/agent-room'
import { Button } from '#/components/ui/button'

export function ConnectionRow({
    title,
    badges,
    meta,
    onEdit,
    onDelete,
    deletePending = false,
}: {
    title: string
    badges: ReactNode
    meta: ReactNode
    onEdit: () => void
    onDelete: () => void
    deletePending?: boolean
}) {
    return (
        <div className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{title}</span>
                    {badges}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">{meta}</div>
            </div>
            <div className="flex shrink-0 flex-wrap justify-end gap-1">
                <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
                    <PencilIcon />
                    Edit
                </Button>
                <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={onDelete}
                    disabled={deletePending}
                >
                    <Trash2Icon />
                    Delete
                </Button>
            </div>
        </div>
    )
}

export function ChipBadge({ children }: { children: ReactNode }) {
    return (
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {children}
        </span>
    )
}

export function ConnectionsSection<T extends { id: string }>({
    title,
    description,
    addLabel,
    emptyIcon,
    emptyTitle,
    emptyDescription,
    loading,
    items,
    onAdd,
    renderRow,
}: {
    title?: string
    description?: string
    addLabel: string
    emptyIcon: typeof PlugIcon
    emptyTitle: string
    emptyDescription: string
    loading: boolean
    items: T[]
    onAdd: () => void
    renderRow: (item: T) => ReactNode
}) {
    const addButton = (
        <Button type="button" size="sm" onClick={onAdd}>
            <PlusIcon />
            {addLabel}
        </Button>
    )
    return (
        <Section title={title} description={description} actions={addButton} bodyClassName="p-0">
            {loading ? (
                <div className="p-4">
                    <LoadingRows count={2} />
                </div>
            ) : items.length === 0 ? (
                <div className="p-4">
                    <EmptyState
                        icon={emptyIcon}
                        title={emptyTitle}
                        description={emptyDescription}
                        action={addButton}
                    />
                </div>
            ) : (
                <div className="divide-y divide-border/60">{items.map(renderRow)}</div>
            )}
        </Section>
    )
}
