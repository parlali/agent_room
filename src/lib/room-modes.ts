import type { RoomMode } from '#/lib/domain-types'

export const ROOM_MODE_OPTIONS = [
    {
        value: 'programmer',
        label: 'Programmer',
        description: 'Lean coding harness with shell, file editing, web, and repo-first context.',
    },
    {
        value: 'coworker',
        label: 'Coworker',
        description:
            'Full room harness for durable memory, artifacts, office files, jobs, and broad work.',
    },
] as const satisfies ReadonlyArray<{ value: RoomMode; label: string; description: string }>

export function roomModeLabel(roomMode: RoomMode): string {
    return ROOM_MODE_OPTIONS.find((option) => option.value === roomMode)?.label ?? 'Coworker'
}
