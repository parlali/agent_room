import type { ReactNode } from 'react'
import { GlobeIcon, ImageIcon, PlugIcon } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { Switch } from '#/components/ui/switch'
import { AttentionBanner, Section, StateBadge, ToggleSelector } from '#/components/agent-room'
import { CAPABILITY_OPTIONS, type CapabilityOption } from '#/domain/capabilities'
import { WEB_ACCESS_CAPABILITY_IDS } from '#/domain/capability-labels'
import type {
    OperatorConfigSnapshot,
    RoomConfigSnapshot,
} from '#/server/configuration/operator-configuration'
import type { ConfigDraft } from './model'
import { SaveBar } from './shared'

export function CapabilitiesSection({
    draft,
    appDefaults,
    effectiveCapabilities,
    searchReady,
    imageReady,
    onChange,
    onSave,
    dirty,
    pending,
}: {
    draft: ConfigDraft
    appDefaults: OperatorConfigSnapshot['settings']['capabilityDefaults'] | null
    appImage: OperatorConfigSnapshot['settings']['image'] | null
    effectiveCapabilities: RoomConfigSnapshot['effective']['capabilities'] | null
    searchReady: boolean
    imageReady: boolean
    onChange: (patch: Partial<ConfigDraft>) => void
    onSave: () => void
    dirty: boolean
    pending: boolean
}) {
    const setCapability = (option: CapabilityOption, next: boolean) => {
        const overrides = { ...draft.capabilityOverrides, [option.id]: next }
        if (appDefaults && appDefaults[option.id] === next) {
            delete overrides[option.id]
        }
        delete overrides[option.key]
        onChange({ capabilityOverrides: overrides })
    }
    const setWebAccess = (next: boolean) => {
        const overrides = { ...draft.capabilityOverrides }
        for (const id of WEB_ACCESS_CAPABILITY_IDS) {
            const option = CAPABILITY_OPTIONS.find((entry) => entry.id === id)
            if (!option) continue
            overrides[id] = next
            if (appDefaults && appDefaults[id] === next) {
                delete overrides[id]
            }
            delete overrides[option.key]
        }
        onChange({ capabilityOverrides: overrides })
    }
    const programmerMode = draft.roomMode === 'programmer'
    const visibleOptions = programmerMode
        ? CAPABILITY_OPTIONS.filter(
              (option) =>
                  option.id === 'web_search' ||
                  option.id === 'url_fetch' ||
                  option.id === 'images' ||
                  option.id === 'mcp' ||
                  option.id === 'shell_coding',
          )
        : CAPABILITY_OPTIONS
    const webOption = CAPABILITY_OPTIONS.find((option) => option.id === 'web_search')!
    const imageOption = CAPABILITY_OPTIONS.find((option) => option.id === 'images')!
    const webAccessChecked = capabilityValue({
        draft,
        option: webOption,
        appDefaults,
        effectiveCapabilities,
    })
    const imagesChecked = capabilityValue({
        draft,
        option: imageOption,
        appDefaults,
        effectiveCapabilities,
    })
    const webInherited =
        !programmerMode &&
        appDefaults !== null &&
        draft.capabilityOverrides['web_search'] === undefined &&
        draft.capabilityOverrides['url_fetch'] === undefined
    const imageInherited =
        !programmerMode && appDefaults !== null && draft.capabilityOverrides['images'] === undefined
    const plainOptions = visibleOptions.filter(
        (option) =>
            option.id !== 'web_search' && option.id !== 'url_fetch' && option.id !== 'images',
    )
    const capabilitySelectorItems = plainOptions.map((option) => ({
        option,
        checked: capabilityValue({
            draft,
            option,
            appDefaults,
            effectiveCapabilities,
        }),
        inherited:
            !programmerMode &&
            appDefaults !== null &&
            draft.capabilityOverrides[option.id] === undefined,
    }))

    return (
        <Section
            title="Capabilities"
            description={
                programmerMode
                    ? 'Programmer mode keeps the room focused on source work, web access, and image generation.'
                    : 'Built-in features this room can use.'
            }
            actions={<SaveBar dirty={dirty} pending={pending} onSave={onSave} />}
        >
            <div className="space-y-4">
                <ManagedCapabilityCard
                    icon={<GlobeIcon className="size-4 text-muted-foreground" />}
                    title="Web access"
                    description="Let this room search and read public web pages. Included with your plan."
                    ariaLabel="Toggle web access"
                    checked={webAccessChecked}
                    onToggle={setWebAccess}
                    inherited={webInherited}
                    ready={searchReady}
                    readyDetail="Search and page reading are ready for this room."
                    setupTitle="Web access needs setup"
                    setupDetail="An operator needs to finish setting up web access for this workspace."
                />

                <ManagedCapabilityCard
                    icon={<ImageIcon className="size-4 text-muted-foreground" />}
                    title="Image generation"
                    description="Let this room generate images. Included with your plan."
                    ariaLabel="Toggle image generation"
                    checked={imagesChecked}
                    onToggle={(next) => setCapability(imageOption, next)}
                    inherited={imageInherited}
                    ready={imageReady}
                    readyDetail="Image generation is ready for this room."
                    setupTitle="Image generation needs setup"
                    setupDetail="An operator needs to finish setting up image generation for this workspace."
                />

                {capabilitySelectorItems.length > 0 ? (
                    <ToggleSelector
                        items={capabilitySelectorItems}
                        selectedValues={capabilitySelectorItems
                            .filter((item) => item.checked)
                            .map((item) => item.option.id)}
                        getValue={(item) => item.option.id}
                        getAriaLabel={(item) => `Toggle ${item.option.label}`}
                        onCheckedChange={(_value, next, item) => setCapability(item.option, next)}
                        className="grid gap-2 divide-y-0 sm:grid-cols-2"
                        itemClassName="items-start rounded-lg border border-border/60 px-3 py-2.5"
                        renderItem={(item) => (
                            <>
                                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                                    <PlugIcon className="size-4 text-muted-foreground" />
                                    {item.option.label}
                                </div>
                                <div className="mt-0.5 text-xs text-muted-foreground">
                                    {item.option.description}
                                </div>
                                {item.inherited ? (
                                    <div className="mt-1 text-[0.7rem] uppercase tracking-wide text-muted-foreground">
                                        App default
                                    </div>
                                ) : null}
                            </>
                        )}
                    />
                ) : null}

                <div className="flex justify-end">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onChange({ capabilityOverrides: {} })}
                        disabled={Object.keys(draft.capabilityOverrides).length === 0 || pending}
                    >
                        Use mode defaults
                    </Button>
                </div>
            </div>
        </Section>
    )
}

function ManagedCapabilityCard({
    icon,
    title,
    description,
    ariaLabel,
    checked,
    onToggle,
    inherited,
    ready,
    readyDetail,
    setupTitle,
    setupDetail,
}: {
    icon: ReactNode
    title: string
    description: string
    ariaLabel: string
    checked: boolean
    onToggle: (next: boolean) => void
    inherited: boolean
    ready: boolean
    readyDetail: string
    setupTitle: string
    setupDetail: string
}) {
    return (
        <div className="space-y-3 rounded-lg border border-border/60 p-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        {icon}
                        {title}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
                    {inherited ? (
                        <div className="mt-1 text-[0.7rem] uppercase tracking-wide text-muted-foreground">
                            App default
                        </div>
                    ) : null}
                </div>
                <Switch checked={checked} onCheckedChange={onToggle} aria-label={ariaLabel} />
            </div>
            {checked ? (
                ready ? (
                    <div className="flex flex-col gap-2 border-t border-border/60 pt-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-2">
                            <StateBadge tone="ready" label="Available" />
                            <span className="text-xs text-muted-foreground">{readyDetail}</span>
                        </div>
                        <OperatorConsoleLink />
                    </div>
                ) : (
                    <AttentionBanner
                        tone="attention"
                        title={setupTitle}
                        description={setupDetail}
                        action={<OperatorConsoleLink />}
                    />
                )
            ) : null}
        </div>
    )
}

function OperatorConsoleLink() {
    return (
        <Link to="/operator" search={{ installationId: '', setupAction: '', githubState: '' }}>
            <Button type="button" variant="outline" size="sm">
                Manage in Operator console
            </Button>
        </Link>
    )
}

function capabilityValue(input: {
    draft: ConfigDraft
    option: CapabilityOption
    appDefaults: OperatorConfigSnapshot['settings']['capabilityDefaults'] | null
    effectiveCapabilities: RoomConfigSnapshot['effective']['capabilities'] | null
}): boolean {
    const override =
        input.draft.capabilityOverrides[input.option.id] ??
        input.draft.capabilityOverrides[input.option.key]
    if (typeof override === 'boolean') return override
    if (input.draft.roomMode === 'programmer') {
        if (
            input.option.id === 'documents' ||
            input.option.id === 'spreadsheets' ||
            input.option.id === 'presentations' ||
            input.option.id === 'pdf'
        ) {
            return false
        }
        if (
            input.option.id === 'web_search' ||
            input.option.id === 'url_fetch' ||
            input.option.id === 'shell_coding'
        ) {
            return true
        }
    }
    if (input.appDefaults && typeof input.appDefaults[input.option.id] === 'boolean') {
        return input.appDefaults[input.option.id]
    }
    return input.effectiveCapabilities?.[input.option.key] ?? false
}
