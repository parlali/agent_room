import { type FormEvent, type ReactNode } from 'react'

import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { ModelSelect } from '#/components/agent-room/model-select'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '#/components/ui/select'
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from '#/components/ui/sheet'
import { cn } from '#/lib/utils'
import type { ModelOption } from '#/domain/model-options'

export function FieldGroup({
    label,
    htmlFor,
    hint,
    children,
    className,
}: {
    label: ReactNode
    htmlFor?: string
    hint?: ReactNode
    children: ReactNode
    className?: string
}) {
    return (
        <div className={cn('flex flex-col gap-1.5', className)}>
            <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
                {label}
            </Label>
            {children}
            {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
    )
}

export function TextField({
    label,
    id,
    value,
    onChange,
    placeholder,
    hint,
    type = 'text',
}: {
    label: string
    id: string
    value: string
    onChange: (value: string) => void
    placeholder?: string
    hint?: ReactNode
    type?: string
}) {
    return (
        <FieldGroup label={label} htmlFor={id} hint={hint}>
            <Input
                id={id}
                type={type}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
            />
        </FieldGroup>
    )
}

export function SelectField<T extends string>({
    label,
    id,
    value,
    onChange,
    options,
}: {
    label: string
    id: string
    value: T
    onChange: (value: T) => void
    options: { value: T; label: string }[]
}) {
    return (
        <FieldGroup label={label} htmlFor={id}>
            <Select value={value} onValueChange={(v) => onChange(v as T)}>
                <SelectTrigger id={id} className="w-full">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                            {option.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </FieldGroup>
    )
}

export function ModelSelectField({
    label,
    id,
    value,
    onChange,
    options,
    disabled = false,
    hint,
}: {
    label: string
    id: string
    value: string
    onChange: (value: string) => void
    options: ModelOption[]
    disabled?: boolean
    hint?: ReactNode
}) {
    return (
        <FieldGroup label={label} htmlFor={id} hint={hint}>
            <ModelSelect
                id={id}
                value={value}
                onChange={onChange}
                options={options}
                disabled={disabled}
            />
        </FieldGroup>
    )
}

export function CredentialField({
    label,
    id,
    hasCredential,
    replace,
    onToggleReplace,
    value,
    onChange,
    placeholder,
}: {
    label: string
    id: string
    hasCredential: boolean
    replace: boolean
    onToggleReplace: (replace: boolean) => void
    value: string
    onChange: (value: string) => void
    placeholder?: string
}) {
    if (hasCredential && !replace) {
        return (
            <FieldGroup label={label}>
                <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-sm">
                    <span className="font-mono tracking-widest text-muted-foreground">
                        ••••••••••••
                    </span>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onToggleReplace(true)}
                    >
                        Replace
                    </Button>
                </div>
            </FieldGroup>
        )
    }
    return (
        <FieldGroup
            label={label}
            htmlFor={id}
            hint={hasCredential ? 'Submitting will overwrite the saved value.' : undefined}
        >
            <div className="flex items-center gap-2">
                <Input
                    id={id}
                    type="password"
                    autoComplete="off"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                />
                {hasCredential ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onToggleReplace(false)}
                    >
                        Cancel
                    </Button>
                ) : null}
            </div>
        </FieldGroup>
    )
}

export function EditSheet({
    open,
    onOpenChange,
    title,
    description,
    children,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    description: string
    children: ReactNode
}) {
    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="flex w-full flex-col gap-0 sm:max-w-lg">
                <SheetHeader className="border-b border-border/60">
                    <SheetTitle>{title}</SheetTitle>
                    <SheetDescription>{description}</SheetDescription>
                </SheetHeader>
                {children}
            </SheetContent>
        </Sheet>
    )
}

export function ThemeChoice({
    active,
    icon,
    label,
    onClick,
}: {
    active: boolean
    icon: ReactNode
    label: string
    onClick: () => void
}) {
    return (
        <Button
            type="button"
            variant="outline"
            onClick={onClick}
            data-active={active}
            className="h-auto justify-between gap-2 px-3 py-2.5 text-sm font-normal data-[active=true]:border-primary data-[active=true]:bg-primary/5"
        >
            <span className="flex items-center gap-2">
                {icon}
                {label}
            </span>
            <span
                aria-hidden
                className={cn(
                    'size-2 rounded-full ring-1 ring-border',
                    active && 'bg-primary ring-primary',
                )}
            />
        </Button>
    )
}

export function FormShell({
    onSubmit,
    onCancel,
    pending,
    submitLabel,
    submitIcon,
    children,
}: {
    onSubmit: (event: FormEvent<HTMLFormElement>) => void
    onCancel: () => void
    pending: boolean
    submitLabel: string
    submitIcon: ReactNode
    children: ReactNode
}) {
    return (
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
            <div className="flex-1 space-y-4 overflow-y-auto p-4">{children}</div>
            <SheetFooter className="border-t border-border/60">
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button type="submit" disabled={pending}>
                        {submitIcon}
                        {submitLabel}
                    </Button>
                </div>
            </SheetFooter>
        </form>
    )
}
