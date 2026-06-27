import { StateBadge } from '#/components/agent-room'

export function ManagedCreditsBadge({ managed }: { managed: boolean }) {
    return managed ? (
        <StateBadge tone="ready" label="Managed model" />
    ) : (
        <StateBadge tone="muted" label="Your own key" />
    )
}
