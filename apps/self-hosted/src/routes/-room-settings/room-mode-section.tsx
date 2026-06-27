import { BriefcaseBusinessIcon, Code2Icon } from 'lucide-react'
import { CardButton } from '#/components/ui/card'
import type { RoomMode } from '#/domain/domain-types'
import { ROOM_MODES, type ConfigDraft } from './model'
import { Disclosure } from './shared'

export function RoomModeSection({
    draft,
    onChange,
}: {
    draft: ConfigDraft
    onChange: (patch: Partial<ConfigDraft>) => void
}) {
    return (
        <Disclosure
            title="Room mode"
            description="Advanced. Changes which built-in capabilities this room focuses on."
        >
            <RoomModeField draft={draft} onChange={(roomMode) => onChange({ roomMode })} />
        </Disclosure>
    )
}

export function RoomModeField({
    draft,
    onChange,
}: {
    draft: ConfigDraft
    onChange: (roomMode: RoomMode) => void
}) {
    return (
        <div className="grid gap-3 md:grid-cols-2">
            {ROOM_MODES.map((mode) => {
                const selected = draft.roomMode === mode.value
                const Icon = mode.value === 'programmer' ? Code2Icon : BriefcaseBusinessIcon
                return (
                    <CardButton
                        key={mode.value}
                        onClick={() => onChange(mode.value)}
                        className={[
                            'flex min-h-28 items-start gap-3 rounded-md border p-4 text-left transition-colors',
                            selected
                                ? 'border-primary bg-primary/10 text-foreground'
                                : 'border-border/70 bg-background hover:bg-muted/40',
                        ].join(' ')}
                        aria-pressed={selected}
                    >
                        <span
                            className={[
                                'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border',
                                selected
                                    ? 'border-primary/30 bg-primary/15 text-primary'
                                    : 'border-border/70 bg-muted/40 text-muted-foreground',
                            ].join(' ')}
                        >
                            <Icon className="size-4" />
                        </span>
                        <span className="min-w-0">
                            <span className="block text-sm font-medium">{mode.label}</span>
                            <span className="mt-1 block text-sm text-muted-foreground">
                                {mode.description}
                            </span>
                        </span>
                    </CardButton>
                )
            })}
        </div>
    )
}
