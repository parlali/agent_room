import type { RoomMode } from './domain-types'

export const ROOM_MODE_OPTIONS = [
    {
        value: 'programmer',
        label: 'Programmer',
        description: 'Focused on coding work: editing files, running commands, and web access.',
    },
    {
        value: 'coworker',
        label: 'Coworker',
        description: 'A general coworker with lasting memory for files, tasks, and everyday work.',
    },
] satisfies Array<{ value: RoomMode; label: string; description: string }>

export function roomModeLabel(roomMode: RoomMode): string {
    return ROOM_MODE_OPTIONS.find((option) => option.value === roomMode)?.label ?? 'Coworker'
}
