import { GlobeIcon, ImageIcon, PlugIcon } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '#/components/ui/select'
import { Switch } from '#/components/ui/switch'
import { Section, StateBadge } from '#/components/agent-room'
import { CAPABILITY_OPTIONS, type CapabilityOption } from '#/lib/capabilities'
import { imageModelOptionsForProvider } from '#/lib/model-options'
import type {
    OperatorConfigSnapshot,
    RoomConfigSnapshot,
} from '#/server/configuration/operator-configuration'
import type { ConfigDraft } from './model'
import { ModelSelect, SaveBar } from './shared'

export function CapabilitiesSection({
    draft,
    appDefaults,
    appImage,
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
    const inheritedImage =
        appImage?.provider && appImage.model ? `${appImage.provider} - ${appImage.model}` : 'None'
    const imageConfigured = draft.imageProvider !== 'inherit'
    const programmerMode = draft.roomMode === 'programmer'
    const visibleOptions = programmerMode
        ? CAPABILITY_OPTIONS.filter(
              (option) =>
                  option.id === 'web_search' ||
                  option.id === 'url_fetch' ||
                  option.id === 'mcp' ||
                  option.id === 'shell_coding',
          )
        : CAPABILITY_OPTIONS
    const roomImageModelOptions =
        draft.imageProvider === 'inherit'
            ? []
            : imageModelOptionsForProvider(draft.imageProvider, draft.imageModel)

    return (
        <Section
            title="Capabilities"
            description={
                programmerMode
                    ? 'Programmer mode keeps the harness focused on source work.'
                    : 'Built-in room features and provider-backed image generation.'
            }
            actions={<SaveBar dirty={dirty} pending={pending} onSave={onSave} />}
        >
            <div className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-2">
                    {visibleOptions.map((option) => {
                        const checked = capabilityValue({
                            draft,
                            option,
                            appDefaults,
                            effectiveCapabilities,
                        })
                        const inherited =
                            !programmerMode &&
                            appDefaults &&
                            draft.capabilityOverrides[option.id] === undefined
                        return (
                            <label
                                key={option.id}
                                className="flex items-start justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5"
                            >
                                <span className="min-w-0">
                                    <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                                        {option.id === 'images' ? (
                                            <ImageIcon className="size-4 text-muted-foreground" />
                                        ) : option.id === 'web_search' ||
                                          option.id === 'url_fetch' ? (
                                            <GlobeIcon className="size-4 text-muted-foreground" />
                                        ) : (
                                            <PlugIcon className="size-4 text-muted-foreground" />
                                        )}
                                        {option.label}
                                    </span>
                                    <span className="mt-0.5 block text-xs text-muted-foreground">
                                        {option.description}
                                    </span>
                                    {inherited ? (
                                        <span className="mt-1 block text-[0.7rem] uppercase tracking-wide text-muted-foreground">
                                            App default
                                        </span>
                                    ) : null}
                                </span>
                                <Switch
                                    checked={checked}
                                    onCheckedChange={(next) => setCapability(option, next)}
                                    aria-label={`Toggle ${option.label}`}
                                />
                            </label>
                        )
                    })}
                </div>

                {!programmerMode ? (
                    <div className="rounded-lg border border-border/60 p-3">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <div className="text-sm font-medium text-foreground">
                                    Image provider
                                </div>
                                <div className="text-xs text-muted-foreground">
                                    App default: {inheritedImage}. Room keys are write-only.
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <StateBadge
                                    tone={searchReady ? 'ready' : 'muted'}
                                    label={searchReady ? 'Search ready' : 'Search off'}
                                />
                                <StateBadge
                                    tone={imageReady ? 'ready' : 'muted'}
                                    label={imageReady ? 'Images ready' : 'Images not ready'}
                                />
                            </div>
                        </div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-3">
                            <div className="space-y-1.5">
                                <Label htmlFor="room-image-provider">Provider</Label>
                                <Select
                                    value={draft.imageProvider}
                                    onValueChange={(value) => {
                                        const imageProvider = value as ConfigDraft['imageProvider']
                                        const options =
                                            imageProvider === 'inherit'
                                                ? []
                                                : imageModelOptionsForProvider(imageProvider)
                                        onChange({
                                            imageProvider,
                                            imageModel:
                                                imageProvider === 'inherit'
                                                    ? ''
                                                    : (options[0]?.value ?? ''),
                                            imageApiKey:
                                                imageProvider === 'inherit'
                                                    ? ''
                                                    : draft.imageApiKey,
                                        })
                                    }}
                                >
                                    <SelectTrigger id="room-image-provider" className="w-full">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="inherit">Use app default</SelectItem>
                                        <SelectItem value="openai">OpenAI Images</SelectItem>
                                        <SelectItem value="gemini">Gemini Images</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="room-image-model">Image model</Label>
                                {imageConfigured ? (
                                    <ModelSelect
                                        id="room-image-model"
                                        value={draft.imageModel}
                                        onChange={(imageModel) => onChange({ imageModel })}
                                        options={roomImageModelOptions}
                                    />
                                ) : (
                                    <div className="flex min-h-10 items-center rounded-md border border-border bg-muted/30 px-3 text-sm text-muted-foreground">
                                        {appImage?.model ?? 'Use app default'}
                                    </div>
                                )}
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="room-image-key">Image API key</Label>
                                <Input
                                    id="room-image-key"
                                    type="password"
                                    value={draft.imageApiKey}
                                    onChange={(e) => onChange({ imageApiKey: e.target.value })}
                                    disabled={!imageConfigured}
                                    placeholder="Leave blank to keep saved key"
                                    autoComplete="off"
                                />
                            </div>
                        </div>
                    </div>
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
            input.option.id === 'pdf' ||
            input.option.id === 'images'
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
