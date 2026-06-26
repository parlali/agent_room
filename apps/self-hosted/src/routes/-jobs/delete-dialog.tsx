import { Loader2Icon, Trash2Icon } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '#/components/ui/dialog'

export function JobDeleteDialog({
    jobName,
    pending,
    onOpenChange,
    onCancel,
    onDelete,
}: {
    jobName: string | null
    pending: boolean
    onOpenChange: (open: boolean) => void
    onCancel: () => void
    onDelete: () => void
}) {
    return (
        <Dialog open={jobName !== null} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Delete this scheduled task?</DialogTitle>
                    <DialogDescription>
                        {jobName ? `"${jobName}" will stop running. This cannot be undone.` : null}
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button variant="outline" onClick={onCancel} disabled={pending}>
                        Cancel
                    </Button>
                    <Button variant="destructive" onClick={onDelete} disabled={pending}>
                        {pending ? <Loader2Icon className="animate-spin" /> : <Trash2Icon />}
                        Delete
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
