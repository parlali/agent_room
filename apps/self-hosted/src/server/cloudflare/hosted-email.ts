import type { AgentRoomHostedEnv } from './bindings'
import { resolveHostedConfig } from './hosted-config'

export type HostedEmailPurpose = 'email_verification' | 'password_reset' | 'organization_invitation'

export interface HostedEmailPayload {
    purpose: HostedEmailPurpose
    to: string
    subject: string
    actionUrl: string
    metadata: Record<string, string>
}

export async function sendHostedAuthEmail(
    env: AgentRoomHostedEnv,
    payload: HostedEmailPayload,
): Promise<void> {
    const config = resolveHostedConfig(env)
    const response = await fetch(config.emailWebhook.url, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${config.emailWebhook.bearerToken}`,
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            from: config.emailWebhook.from,
            ...payload,
        }),
    })

    if (!response.ok) {
        throw new Error(`Hosted auth email delivery failed with status ${response.status}`)
    }
}
