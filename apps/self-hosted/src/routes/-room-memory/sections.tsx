import { ChevronDownIcon, PlusIcon, RepeatIcon, Trash2Icon } from 'lucide-react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Textarea } from '#/components/ui/textarea'
import { Progress } from '#/components/ui/progress'
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from '#/components/ui/collapsible'
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from '#/components/ui/accordion'
import {
    AttentionBanner,
    FieldGroup,
    ProvenanceChip,
    SelectField,
    TextField,
} from '#/components/agent-room'
import { cn } from '#/lib/utils'
import {
    maxMemoryBytes,
    maxSectionItems,
    memoryGroups,
    sectionItems,
    setSectionItems,
    timedSections,
    type MemoryItem,
    type MemorySectionMeta,
    type MemorySectionPath,
    type RoomMemory,
    type TimedMemoryItem,
} from '#/domain/room-memory'
import {
    personalityArchetypeIds,
    personalityArchetypeProfiles,
} from '#/server/rooms/personality/archetypes'
import {
    maxPersonalityNotesLength,
    personalityChallengeStyleProfiles,
    personalityChallengeStyleValues,
    personalityDirectnessProfiles,
    personalityDirectnessValues,
    personalityFormForArchetype,
    personalityHumorProfiles,
    personalityHumorValues,
    personalityReportStyleProfiles,
    personalityReportStyleValues,
    personalityToneProfiles,
    personalityToneValues,
    type PersonalityForm,
    type PersonalityOptionProfile,
} from '#/server/rooms/personality/form'
import {
    createMemoryItem,
    isoToLocalInput,
    localInputToIso,
    patchMemoryItem,
    provenanceFor,
} from './draft'

export function WhoSection({
    role,
    displayName,
    slug,
    onRoleChange,
    onDisplayNameChange,
    onSlugChange,
}: {
    role: string
    displayName: string
    slug: string
    onRoleChange: (value: string) => void
    onDisplayNameChange: (value: string) => void
    onSlugChange: (value: string) => void
}) {
    return (
        <div className="space-y-4">
            <FieldGroup
                label="What this room is for"
                htmlFor="brief-role"
                hint="One line describing this coworker and what it should generally do."
            >
                <Textarea
                    id="brief-role"
                    value={role}
                    onChange={(event) => onRoleChange(event.target.value)}
                    className="min-h-16 resize-y"
                    placeholder="e.g. Keeps my product roadmap current and chases follow-ups."
                />
            </FieldGroup>
            <TextField
                label="Display name"
                id="brief-display-name"
                value={displayName}
                onChange={onDisplayNameChange}
                placeholder="Name this room"
            />
            <Collapsible className="rounded-lg border border-border/60 bg-background/40">
                <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                    <span>Web address</span>
                    <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="border-t border-border/60 p-3">
                    <TextField
                        label="URL slug"
                        id="brief-slug"
                        value={slug}
                        onChange={onSlugChange}
                        placeholder="auto"
                        hint="Lowercase, hyphenated. Leave blank to auto-generate."
                    />
                </CollapsibleContent>
            </Collapsible>
        </div>
    )
}

export function PersonalityPicker({
    form,
    onChange,
}: {
    form: PersonalityForm
    onChange: (form: PersonalityForm) => void
}) {
    return (
        <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
                {personalityArchetypeIds.map((id) => {
                    const profile = personalityArchetypeProfiles[id]
                    const selected = form.archetype === id
                    return (
                        <button
                            key={id}
                            type="button"
                            aria-pressed={selected}
                            data-selected={selected}
                            className={cn(
                                'rounded-lg border border-border bg-background/40 p-3 text-left transition-colors hover:border-foreground/30 hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none data-[selected=true]:border-primary data-[selected=true]:bg-primary/5',
                            )}
                            onClick={() => onChange(personalityFormForArchetype(id, form.notes))}
                        >
                            <span className="block text-sm font-medium text-foreground">
                                {profile.label}
                            </span>
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                                {profile.summary}
                            </span>
                        </button>
                    )
                })}
            </div>
            <FieldGroup
                label="One tweak (optional)"
                htmlFor="brief-personality-tweak"
                hint="A single room-specific preference to layer on top of the preset."
            >
                <Input
                    id="brief-personality-tweak"
                    value={form.notes}
                    maxLength={maxPersonalityNotesLength}
                    placeholder="e.g. Always flag budget risk first."
                    onChange={(event) => onChange({ ...form, notes: event.target.value })}
                />
            </FieldGroup>
            <Collapsible className="rounded-lg border border-border/60 bg-background/40">
                <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                    <span>Advanced tuning</span>
                    <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent className="grid gap-4 border-t border-border/60 p-3 sm:grid-cols-2 lg:grid-cols-3">
                    <EnumField
                        id="brief-tone"
                        label="Tone"
                        value={form.tone}
                        options={personalityToneValues}
                        profiles={personalityToneProfiles}
                        onChange={(tone) => onChange({ ...form, tone })}
                    />
                    <EnumField
                        id="brief-directness"
                        label="Directness"
                        value={form.directness}
                        options={personalityDirectnessValues}
                        profiles={personalityDirectnessProfiles}
                        onChange={(directness) => onChange({ ...form, directness })}
                    />
                    <EnumField
                        id="brief-report-style"
                        label="Report style"
                        value={form.reportStyle}
                        options={personalityReportStyleValues}
                        profiles={personalityReportStyleProfiles}
                        onChange={(reportStyle) => onChange({ ...form, reportStyle })}
                    />
                    <EnumField
                        id="brief-humor"
                        label="Humor"
                        value={form.humor}
                        options={personalityHumorValues}
                        profiles={personalityHumorProfiles}
                        onChange={(humor) => onChange({ ...form, humor })}
                    />
                    <EnumField
                        id="brief-challenge-style"
                        label="Challenge style"
                        value={form.challengeStyle}
                        options={personalityChallengeStyleValues}
                        profiles={personalityChallengeStyleProfiles}
                        onChange={(challengeStyle) => onChange({ ...form, challengeStyle })}
                    />
                </CollapsibleContent>
            </Collapsible>
        </div>
    )
}

function EnumField<T extends string>({
    id,
    label,
    value,
    options,
    profiles,
    onChange,
}: {
    id: string
    label: string
    value: T
    options: readonly T[]
    profiles: Record<T, PersonalityOptionProfile>
    onChange: (value: T) => void
}) {
    return (
        <SelectField
            id={id}
            label={label}
            value={value}
            onChange={onChange}
            options={options.map((option) => ({ value: option, label: profiles[option].label }))}
        />
    )
}

export function InstructionsSection({
    value,
    onChange,
}: {
    value: string
    onChange: (value: string) => void
}) {
    return (
        <Textarea
            rows={8}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="How should this room behave? These instructions apply to every conversation and task."
            className="resize-y"
        />
    )
}

export function BudgetMeter({
    bytes,
    overBudget,
    oversizeSections,
}: {
    bytes: number
    overBudget: boolean
    oversizeSections: MemorySectionPath[]
}) {
    const percent = Math.min(100, Math.round((bytes / maxMemoryBytes) * 100))
    const near = !overBudget && percent >= 85
    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Memory size</span>
                <span>
                    {Math.round(bytes / 1000)}k / {Math.round(maxMemoryBytes / 1000)}k
                </span>
            </div>
            <Progress
                value={percent}
                className={cn(overBudget && '[&>[data-slot=progress-indicator]]:bg-danger')}
            />
            {overBudget ? (
                <AttentionBanner
                    tone="danger"
                    title="Memory is over the size limit"
                    description="Saving now would let maintenance drop the lowest-priority notes. Remove some entries first."
                />
            ) : null}
            {near ? (
                <p className="text-xs text-attention-fg">
                    Memory is close to its size limit. Keep notes concise.
                </p>
            ) : null}
            {oversizeSections.length > 0 ? (
                <p className="text-xs text-attention-fg">
                    Some sections have more than {maxSectionItems} entries and may be trimmed.
                </p>
            ) : null}
        </div>
    )
}

export function MemorySectionsEditor({
    memory,
    onChange,
}: {
    memory: RoomMemory
    onChange: (updater: (memory: RoomMemory) => RoomMemory) => void
}) {
    return (
        <Accordion type="multiple" className="gap-2">
            {memoryGroups.map((group) => {
                const count = group.sections.reduce(
                    (total, meta) => total + sectionItems(memory, meta.path).length,
                    0,
                )
                return (
                    <AccordionItem
                        key={group.id}
                        value={group.id}
                        className="rounded-lg border border-border/60 not-last:border-b"
                    >
                        <AccordionTrigger className="px-3">
                            <span className="flex min-w-0 flex-col gap-0.5">
                                <span className="truncate">{group.title}</span>
                                <span className="text-xs font-normal text-muted-foreground">
                                    {group.description}
                                </span>
                            </span>
                            <span className="mr-2 shrink-0 self-center text-xs font-normal text-muted-foreground">
                                {count}
                            </span>
                        </AccordionTrigger>
                        <AccordionContent className="space-y-4 px-3">
                            {group.sections.map((meta) => (
                                <MemorySectionEditor
                                    key={meta.path}
                                    meta={meta}
                                    items={sectionItems(memory, meta.path)}
                                    onAdd={() =>
                                        onChange((current) =>
                                            setSectionItems(current, meta.path, [
                                                ...sectionItems(current, meta.path),
                                                createMemoryItem(),
                                            ]),
                                        )
                                    }
                                    onPatch={(id, patch) =>
                                        onChange((current) =>
                                            patchMemoryItem(current, meta.path, id, patch),
                                        )
                                    }
                                    onDelete={(id) =>
                                        onChange((current) =>
                                            setSectionItems(
                                                current,
                                                meta.path,
                                                sectionItems(current, meta.path).filter(
                                                    (item) => item.id !== id,
                                                ),
                                            ),
                                        )
                                    }
                                />
                            ))}
                        </AccordionContent>
                    </AccordionItem>
                )
            })}
        </Accordion>
    )
}

function MemorySectionEditor({
    meta,
    items,
    onAdd,
    onPatch,
    onDelete,
}: {
    meta: MemorySectionMeta
    items: Array<MemoryItem | TimedMemoryItem>
    onAdd: () => void
    onPatch: (id: string, patch: Partial<TimedMemoryItem>) => void
    onDelete: (id: string) => void
}) {
    const timed = timedSections.has(meta.path)
    const recurring = meta.path === 'schedule.recurring'
    return (
        <div className="rounded-lg border border-border/50 bg-background/40 p-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-sm font-medium text-foreground">{meta.title}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">{meta.description}</p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={onAdd}>
                    <PlusIcon />
                    Add
                </Button>
            </div>
            {items.length === 0 ? (
                <p className="mt-3 text-xs text-muted-foreground">
                    Nothing here yet. This room fills it in as it works, or you can add a note.
                </p>
            ) : (
                <ul className="mt-3 space-y-3">
                    {items.map((item) => (
                        <MemoryItemRow
                            key={item.id}
                            item={item}
                            placeholder={meta.placeholder}
                            timed={timed}
                            recurring={recurring}
                            onPatch={(patch) => onPatch(item.id, patch)}
                            onDelete={() => onDelete(item.id)}
                        />
                    ))}
                </ul>
            )}
        </div>
    )
}

function MemoryItemRow({
    item,
    placeholder,
    timed,
    recurring,
    onPatch,
    onDelete,
}: {
    item: MemoryItem | TimedMemoryItem
    placeholder: string
    timed: boolean
    recurring: boolean
    onPatch: (patch: Partial<TimedMemoryItem>) => void
    onDelete: () => void
}) {
    const provenance = provenanceFor(item.source)
    const ProvenanceIcon = provenance.icon
    const dueAt = 'dueAt' in item ? item.dueAt : undefined
    const recurrenceRule = 'recurrence' in item ? item.recurrence?.rule : undefined
    return (
        <li className="rounded-md border border-border/50 bg-card p-2.5">
            <div className="flex items-start gap-2">
                <Textarea
                    value={item.text}
                    onChange={(event) => onPatch({ text: event.target.value })}
                    className="min-h-16 flex-1 resize-y"
                    placeholder={placeholder}
                    disabled={provenance.locked}
                />
                {provenance.locked ? null : (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Delete memory entry"
                        onClick={onDelete}
                    >
                        <Trash2Icon />
                    </Button>
                )}
            </div>
            {timed ? (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                        <Label className="text-xs" htmlFor={`brief-due-${item.id}`}>
                            Due
                        </Label>
                        <Input
                            id={`brief-due-${item.id}`}
                            type="datetime-local"
                            value={isoToLocalInput(dueAt)}
                            disabled={provenance.locked}
                            onChange={(event) =>
                                onPatch({ dueAt: localInputToIso(event.target.value) })
                            }
                        />
                    </div>
                    {recurring ? (
                        <div className="space-y-1">
                            <Label className="text-xs" htmlFor={`brief-recurrence-${item.id}`}>
                                Repeats
                            </Label>
                            <Input
                                id={`brief-recurrence-${item.id}`}
                                value={recurrenceRule ?? ''}
                                disabled={provenance.locked}
                                placeholder="e.g. every Monday 9am"
                                onChange={(event) =>
                                    onPatch({
                                        recurrence: event.target.value
                                            ? { rule: event.target.value }
                                            : undefined,
                                    })
                                }
                            />
                        </div>
                    ) : null}
                </div>
            ) : null}
            <div className="mt-2 flex items-center gap-2">
                <ProvenanceChip icon={<ProvenanceIcon />}>{provenance.label}</ProvenanceChip>
                {recurring && recurrenceRule ? (
                    <ProvenanceChip icon={<RepeatIcon />}>Recurring</ProvenanceChip>
                ) : null}
                {provenance.locked ? (
                    <span className="text-xs text-muted-foreground">
                        Safety note. Protected from edits.
                    </span>
                ) : null}
            </div>
        </li>
    )
}
