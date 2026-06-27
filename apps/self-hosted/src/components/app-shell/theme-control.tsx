import { MonitorIcon, MoonIcon, SunIcon, type LucideIcon } from 'lucide-react'

import { ToggleGroup, ToggleGroupItem } from '#/components/ui/toggle-group'
import { useThemeMode, type ThemeMode } from '#/lib/theme'

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: LucideIcon }[] = [
    { value: 'light', label: 'Light', icon: SunIcon },
    { value: 'dark', label: 'Dark', icon: MoonIcon },
    { value: 'system', label: 'System', icon: MonitorIcon },
]

export function ThemeControl() {
    const [themeMode, setThemeMode] = useThemeMode()

    return (
        <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Theme</div>
            <ToggleGroup
                type="single"
                value={themeMode}
                onValueChange={(value) => {
                    if (value === 'light' || value === 'dark' || value === 'system') {
                        setThemeMode(value)
                    }
                }}
                variant="ghost"
                size="sm"
                className="grid w-full grid-cols-3 gap-0.5 rounded-md bg-muted/40 p-0.5"
                aria-label="Theme"
            >
                {THEME_OPTIONS.map((option) => {
                    const Icon = option.icon
                    return (
                        <ToggleGroupItem
                            key={option.value}
                            value={option.value}
                            aria-label={`${option.label} theme`}
                            className="h-7 gap-1.5 rounded-[calc(var(--radius-md)-2px)] text-xs font-medium"
                        >
                            <Icon className="size-3.5" />
                            {option.label}
                        </ToggleGroupItem>
                    )
                })}
            </ToggleGroup>
        </div>
    )
}
