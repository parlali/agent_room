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

function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;')
}

function emailActionLabel(purpose: HostedEmailPurpose): string {
    switch (purpose) {
        case 'email_verification':
            return 'Verify email'
        case 'password_reset':
            return 'Reset password'
        case 'organization_invitation':
            return 'Accept invitation'
    }
}

function emailIntro(purpose: HostedEmailPurpose): string {
    switch (purpose) {
        case 'email_verification':
            return 'Use this link to verify your Agent Room email.'
        case 'password_reset':
            return 'Use this link to reset your Agent Room password.'
        case 'organization_invitation':
            return 'Use this link to accept your Agent Room organization invitation.'
    }
}

function renderTextEmail(payload: HostedEmailPayload): string {
    return [
        payload.subject,
        '',
        emailIntro(payload.purpose),
        '',
        payload.actionUrl,
        '',
        'If you did not request this, you can ignore this email.',
    ].join('\n')
}

function renderHtmlEmail(payload: HostedEmailPayload): string {
    const escapedSubject = escapeHtml(payload.subject)
    const escapedIntro = escapeHtml(emailIntro(payload.purpose))
    const escapedActionUrl = escapeHtml(payload.actionUrl)
    const escapedActionLabel = escapeHtml(emailActionLabel(payload.purpose))

    return [
        '<!doctype html>',
        '<html>',
        '<body>',
        `<h1>${escapedSubject}</h1>`,
        `<p>${escapedIntro}</p>`,
        `<p><a href="${escapedActionUrl}">${escapedActionLabel}</a></p>`,
        `<p><a href="${escapedActionUrl}">${escapedActionUrl}</a></p>`,
        '<p>If you did not request this, you can ignore this email.</p>',
        '</body>',
        '</html>',
    ].join('')
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
            to: payload.to,
            subject: payload.subject,
            html: renderHtmlEmail(payload),
            text: renderTextEmail(payload),
        }),
    })

    if (!response.ok) {
        throw new Error(`Hosted auth email delivery failed with status ${response.status}`)
    }
}
