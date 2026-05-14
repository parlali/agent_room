import { ModelSelect } from '#/components/agent-room/model-select'
import { Button } from '#/components/ui/button'
import { CardButton } from '#/components/ui/card'
import { cn } from '#/lib/utils'
import { Loader2Icon, SaveIcon } from 'lucide-react'

export { ModelSelect }

export function ModeRadio({
    label,
    description,
    checked,
    onSelect,
}: {
    label: string
    description: string
    checked: boolean
    onSelect: () => void
}) {
    return (
        <CardButton
            onClick={onSelect}
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

export function SaveBar({
    dirty,
    pending,
    onSave,
}: {
    dirty: boolean
    pending: boolean
    onSave: () => void
}) {
    return (
        <Button
            size="sm"
            onClick={onSave}
            disabled={!dirty || pending}
            variant={dirty ? 'default' : 'outline'}
        >
            {pending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}
            Save
        </Button>
    )
}
