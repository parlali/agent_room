import { useState, type FormEvent } from 'react'
import { ChevronDownIcon, SparklesIcon } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Textarea } from '#/components/ui/textarea'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '#/components/ui/collapsible'
import { FieldGroup, SelectField } from '#/components/agent-room/form'
import { cn } from '#/lib/utils'
import type { RoomMode } from '#/domain/domain-types'
import { ROOM_MODE_OPTIONS } from '#/domain/room-modes'

export type CreateRoomFormValues = {
    displayName: string
    instructions: string
    roomMode: RoomMode
}

export type CreateRoomFormProps = {
    onSubmit: (values: CreateRoomFormValues) => void
    pending: boolean
    variant?: 'dialog' | 'embedded'
    submitLabel?: string
    submittingLabel?: string
    autoFocus?: boolean
    error?: string | null
    defaultValues?: Partial<CreateRoomFormValues>
}

const ROOM_MODE_HINT = ROOM_MODE_OPTIONS.map(
    (option) => `${option.label}: ${option.description}`,
).join(' ')

export function CreateRoomForm({
    onSubmit,
    pending,
    variant = 'dialog',
    submitLabel = 'Create room',
    submittingLabel = 'Creating room...',
    autoFocus = true,
    error,
    defaultValues,
}: CreateRoomFormProps) {
    const [displayName, setDisplayName] = useState(defaultValues?.displayName ?? '')
    const [instructions, setInstructions] = useState(defaultValues?.instructions ?? '')
    const [roomMode, setRoomMode] = useState<RoomMode>(defaultValues?.roomMode ?? 'coworker')
    const [advancedOpen, setAdvancedOpen] = useState(false)

    const trimmedName = displayName.trim()

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (!trimmedName || pending) return
        onSubmit({ displayName: trimmedName, instructions: instructions.trim(), roomMode })
    }

    return (
        <form className="space-y-5" onSubmit={handleSubmit} noValidate>
            {error ? (
                <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            ) : null}
            <FieldGroup label="Room name" htmlFor="create-room-name">
                <Input
                    id="create-room-name"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="Research"
                    autoFocus={autoFocus}
                    required
                />
            </FieldGroup>
            <FieldGroup
                label="What is this room for? (optional)"
                htmlFor="create-room-instructions"
                hint="This becomes the room's working instructions. You can refine it later."
            >
                <Textarea
                    id="create-room-instructions"
                    value={instructions}
                    onChange={(event) => setInstructions(event.target.value)}
                    placeholder="Watch competitor releases, summarize daily, draft follow-up notes."
                    rows={4}
                />
            </FieldGroup>
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                <CollapsibleTrigger asChild>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto gap-1.5 px-0 text-xs font-medium text-muted-foreground hover:bg-transparent hover:text-foreground"
                    >
                        <ChevronDownIcon
                            className={cn(
                                'size-3.5 transition-transform',
                                advancedOpen && 'rotate-180',
                            )}
                        />
                        Advanced
                    </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-4">
                    <SelectField
                        label="Mode"
                        id="create-room-mode"
                        value={roomMode}
                        onChange={setRoomMode}
                        options={ROOM_MODE_OPTIONS.map((option) => ({
                            value: option.value,
                            label: option.label,
                        }))}
                    />
                    <p className="pt-1.5 text-xs text-muted-foreground">{ROOM_MODE_HINT}</p>
                </CollapsibleContent>
            </Collapsible>
            <div className={cn('flex', variant === 'dialog' ? 'justify-end' : 'justify-start')}>
                <Button
                    type="submit"
                    disabled={pending || !trimmedName}
                    className={variant === 'embedded' ? 'w-full sm:w-auto' : undefined}
                >
                    <SparklesIcon />
                    {pending ? submittingLabel : submitLabel}
                </Button>
            </div>
        </form>
    )
}
