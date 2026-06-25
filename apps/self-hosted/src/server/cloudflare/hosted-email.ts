import type { AgentRoomHostedEnv } from './bindings'
import { resolveHostedConfig } from './hosted-config'

export type HostedEmailPurpose = 'email_verification' | 'password_reset'

export interface HostedEmailPayload {
    purpose: HostedEmailPurpose
    to: string
    subject: string
    actionUrl: string
    metadata: Record<string, string>
}

type HostedEmailCopy = {
    actionLabel: string
    eyebrow: string
    headline: string
    intro: string
    detail: string
}

export type HostedEmailRenderedContent = {
    html: string
    text: string
}

const marketingSiteUrl = 'https://www.openagentroom.com'
const marketingLogoUrl = `${marketingSiteUrl}/apple-touch-icon.png`

function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;')
}

function emailCopy(purpose: HostedEmailPurpose): HostedEmailCopy {
    switch (purpose) {
        case 'email_verification':
            return {
                actionLabel: 'Verify email',
                eyebrow: 'Email verification',
                headline: 'Confirm your Agent Room email',
                intro: 'Finish setting up your hosted Agent Room account by confirming this email address.',
                detail: 'The verification link is single-use and may expire. Request a new one from the sign-in screen if that happens.',
            }
        case 'password_reset':
            return {
                actionLabel: 'Reset password',
                eyebrow: 'Password reset',
                headline: 'Reset your Agent Room password',
                intro: 'Use this secure link to choose a new password for your Agent Room account.',
                detail: 'If you did not request a password reset, leave this email alone and your current password will keep working.',
            }
    }
}

function renderTextEmail(payload: HostedEmailPayload): string {
    const copy = emailCopy(payload.purpose)

    return [
        copy.headline,
        '',
        copy.intro,
        '',
        copy.detail,
        '',
        payload.actionUrl,
        '',
        `This email was sent for ${payload.to}.`,
        '',
        `Agent Room: ${marketingSiteUrl}`,
    ].join('\n')
}

function renderHtmlEmail(payload: HostedEmailPayload): string {
    const copy = emailCopy(payload.purpose)
    const escapedActionLabel = escapeHtml(copy.actionLabel)
    const escapedDetail = escapeHtml(copy.detail)
    const escapedEyebrow = escapeHtml(copy.eyebrow)
    const escapedHeadline = escapeHtml(copy.headline)
    const escapedIntro = escapeHtml(copy.intro)
    const escapedLogoUrl = escapeHtml(marketingLogoUrl)
    const escapedMarketingSiteUrl = escapeHtml(marketingSiteUrl)
    const escapedRecipient = escapeHtml(payload.to)
    const escapedSubject = escapeHtml(payload.subject)
    const escapedActionUrl = escapeHtml(payload.actionUrl)

    return [
        '<!doctype html>',
        '<html lang="en">',
        '<head>',
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        `<title>${escapedSubject}</title>`,
        '</head>',
        '<body style="margin:0;background:#f5f2ea;color:#201f1b;font-family:Inter,Segoe UI,Arial,sans-serif;">',
        '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">',
        `${escapedIntro}`,
        '</div>',
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f2ea;padding:32px 16px;">',
        '<tr>',
        '<td align="center">',
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fffdfa;border:1px solid #ded8c9;border-radius:18px;overflow:hidden;">',
        '<tr>',
        '<td style="padding:28px 32px 20px;border-bottom:1px solid #eee7d9;">',
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0">',
        '<tr>',
        '<td style="vertical-align:middle;">',
        `<a href="${escapedMarketingSiteUrl}" style="color:#201f1b;text-decoration:none;display:inline-flex;align-items:center;">`,
        `<img src="${escapedLogoUrl}" width="42" height="42" alt="Agent Room" style="display:inline-block;border:0;border-radius:12px;vertical-align:middle;">`,
        '<span style="display:inline-block;margin-left:12px;font-size:18px;font-weight:700;letter-spacing:0;color:#201f1b;vertical-align:middle;">Agent Room</span>',
        '</a>',
        '</td>',
        '</tr>',
        '</table>',
        '</td>',
        '</tr>',
        '<tr>',
        '<td style="padding:32px;">',
        `<div style="margin:0 0 12px;color:#756c5b;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">${escapedEyebrow}</div>`,
        `<h1 style="margin:0 0 16px;color:#201f1b;font-size:30px;line-height:1.18;font-weight:760;letter-spacing:0;">${escapedHeadline}</h1>`,
        `<p style="margin:0 0 18px;color:#4a453b;font-size:16px;line-height:1.6;">${escapedIntro}</p>`,
        `<p style="margin:0 0 28px;color:#5f5749;font-size:14px;line-height:1.6;">${escapedDetail}</p>`,
        `<a href="${escapedActionUrl}" style="display:inline-block;background:#201f1b;color:#ffffff;text-decoration:none;border-radius:10px;padding:13px 20px;font-size:15px;font-weight:700;">${escapedActionLabel}</a>`,
        '<div style="margin-top:28px;padding:18px;background:#f8f4ea;border:1px solid #e6ddcb;border-radius:12px;">',
        '<p style="margin:0 0 8px;color:#5f5749;font-size:13px;line-height:1.5;">If the button does not work, paste this link into your browser:</p>',
        `<p style="margin:0;word-break:break-all;font-size:13px;line-height:1.5;"><a href="${escapedActionUrl}" style="color:#201f1b;text-decoration:underline;">${escapedActionUrl}</a></p>`,
        '</div>',
        '</td>',
        '</tr>',
        '<tr>',
        '<td style="padding:20px 32px 28px;background:#fbf8f1;border-top:1px solid #eee7d9;">',
        `<p style="margin:0;color:#756c5b;font-size:12px;line-height:1.6;">This email was sent for ${escapedRecipient}. Agent Room will never ask you to reply with your password, API keys, or provider credentials.</p>`,
        `<p style="margin:12px 0 0;color:#756c5b;font-size:12px;line-height:1.6;"><a href="${escapedMarketingSiteUrl}" style="color:#5f5749;text-decoration:underline;">${escapedMarketingSiteUrl}</a></p>`,
        '</td>',
        '</tr>',
        '</table>',
        '</td>',
        '</tr>',
        '</table>',
        '</body>',
        '</html>',
    ].join('')
}

export function renderHostedAuthEmail(payload: HostedEmailPayload): HostedEmailRenderedContent {
    return {
        html: renderHtmlEmail(payload),
        text: renderTextEmail(payload),
    }
}

export async function sendHostedAuthEmail(
    env: AgentRoomHostedEnv,
    payload: HostedEmailPayload,
): Promise<void> {
    const config = resolveHostedConfig(env)
    const content = renderHostedAuthEmail(payload)
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
            html: content.html,
            text: content.text,
        }),
    })

    if (!response.ok) {
        throw new Error(`Hosted auth email delivery failed with status ${response.status}`)
    }
}
