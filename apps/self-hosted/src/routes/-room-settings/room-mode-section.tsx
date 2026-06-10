import { BriefcaseBusinessIcon, Code2Icon } from 'lucide-react'
import { Section } from '#/components/agent-room'
import { CardButton } from '#/components/ui/card'
import type { RoomMode } from '#/domain/domain-types'
import { ROOM_MODES, type ConfigDraft } from './model'
import { SaveBar } from './shared'

export function RoomModeSection({
    draft,
    onChange,
    onSave,
    dirty,
    pending,
}: {
    draft: ConfigDraft
    onChange: (roomMode: RoomMode) => void
    onSave: () => void
    dirty: boolean
    pending: boolean
}) {
    return (
        <Section
            title="Mode"
            description="Choose the harness shape for this room."
            actions={<SaveBar dirty={dirty} pending={pending} onSave={onSave} />}
        >
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
                                <span className="mt-3 block text-xs text-muted-foreground">
                                    {mode.value === 'programmer'
                                        ? 'Optimized for source changes, shell commands, tests, and future GitHub auth.'
                                        : 'Optimized for broad autonomous work with durable memory and rich artifacts.'}
                                </span>
                            </span>
                        </CardButton>
                    )
                })}
            </div>
        </Section>
    )
}
