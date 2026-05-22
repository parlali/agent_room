import { cn } from '#/lib/utils'
import { initialsFromName } from '#/domain/format'

const palette = [
    'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200',
    'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200',
    'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
    'bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-200',
    'bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-200',
    'bg-stone-200 text-stone-900 dark:bg-stone-700/50 dark:text-stone-100',
]

function paletteFor(seed: string): string {
    let hash = 0
    for (let i = 0; i < seed.length; i += 1) {
        hash = (hash * 31 + seed.charCodeAt(i)) | 0
    }
    return palette[Math.abs(hash) % palette.length]!
}

export function RoomGlyph({
    name,
    seed,
    emoji,
    size = 'md',
    className,
}: {
    name: string | null | undefined
    seed?: string
    emoji?: string | null
    size?: 'xs' | 'sm' | 'md' | 'lg'
    className?: string
}) {
    const sizeClass = {
        xs: 'size-5 text-[0.625rem]',
        sm: 'size-6 text-xs',
        md: 'size-8 text-sm',
        lg: 'size-10 text-base',
    }[size]

    const display = emoji ?? initialsFromName(name ?? null, '··')
    const tonal = paletteFor(seed ?? name ?? 'room')

    return (
        <span
            data-slot="room-glyph"
            className={cn(
                'inline-flex shrink-0 items-center justify-center rounded-md font-semibold tracking-tight select-none',
                sizeClass,
                tonal,
                className,
            )}
            aria-hidden
        >
            {display}
        </span>
    )
}
