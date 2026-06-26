import {
    Edit3Icon,
    FileTextIcon,
    Loader2Icon,
    MoreHorizontalIcon,
    PlayIcon,
    Trash2Icon,
} from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'

export function JobRowActions({
    busy,
    running,
    onRun,
    onDetails,
    onEdit,
    onDelete,
}: {
    busy: boolean
    running: boolean
    onRun: () => void
    onDetails: () => void
    onEdit: () => void
    onDelete: () => void
}) {
    return (
        <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={onRun} disabled={busy || running}>
                {busy ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
                Run now
            </Button>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="More task actions">
                        <MoreHorizontalIcon />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onSelect={onDetails}>
                        <FileTextIcon className="size-4" />
                        View details
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={onEdit}>
                        <Edit3Icon className="size-4" />
                        Edit
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                        <Trash2Icon className="size-4" />
                        Delete
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    )
}
