import { Loader2Icon } from 'lucide-react'

import { cn } from '#/lib/utils'
import { Button } from '#/components/ui/button'

export function SaveBar({
    dirty,
    saving,
    onSave,
    onRevert,
    saveLabel = 'Save changes',
    message = 'You have unsaved changes.',
    className,
}: {
    dirty: boolean
    saving: boolean
    onSave: () => void
    onRevert?: () => void
    saveLabel?: string
    message?: string
    className?: string
}) {
    if (!dirty && !saving) return null
    return (
        <div
            data-slot="save-bar"
            className={cn(
                'sticky bottom-0 z-10 -mx-4 mt-4 flex items-center justify-between gap-3 border-t border-border/60 bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6',
                className,
            )}
        >
            <span className="min-w-0 truncate text-sm text-muted-foreground">{message}</span>
            <div className="flex shrink-0 items-center gap-2">
                {onRevert ? (
                    <Button variant="ghost" size="sm" onClick={onRevert} disabled={saving}>
                        Revert
                    </Button>
                ) : null}
                <Button size="sm" onClick={onSave} disabled={saving}>
                    {saving ? <Loader2Icon className="animate-spin" /> : null}
                    {saveLabel}
                </Button>
            </div>
        </div>
    )
}
