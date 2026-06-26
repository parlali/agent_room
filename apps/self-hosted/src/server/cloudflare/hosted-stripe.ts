import type { AgentRoomHostedEnv } from './bindings'
import { resolveHostedConfig } from './hosted-config'
import {
    creditHostedBalance,
    ensureHostedBillingAccount,
    expireIncludedBalance,
    findHostedBillingAccountByStripeIds,
    hostedStripeEventExists,
    listHostedBillingLedger,
    listRecentHostedBillableUsage,
    recordHostedStripeEvent,
    readHostedBillingAccount,
    releaseExpiredHostedBillingReservations,
    upsertHostedStripeCustomer,
} from './hosted-billing-repository'
import {
    hostedBillingCheckoutKindSchema,
    type HostedBillingCheckoutKind,
    type HostedBillingPlan,
    isHostedBillingPlanStatusActive,
} from './hosted-billing-types'
import type { HostedActor } from './hosted-auth'
import { hostedModelSourceLabels } from './hosted-model-policy'
import { timingSafeEqualHex } from '../security/timing-safe'

export class HostedStripeWebhookError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'HostedStripeWebhookError'
    }
}

interface StripeCheckoutSession {
    id: string
    customer: string | null
    subscription: string | null
    mode: string
    payment_status: string | null
    amount_total: number | null
    amount_subtotal: number | null
    metadata: Record<string, string> | null
}

interface StripeInvoice {
    id: string
    customer: string | null
    subscription: string | null
    status: string | null
    linePriceId: string | null
    metadata: Record<string, string> | null
}

interface StripeSubscription {
    id: string
    customer: string | null
    status: string | null
    linePriceId: string | null
    metadata: Record<string, string> | null
}

interface StripeEvent {
    id: string
    type: string
    livemode: boolean
    data: {
        object: unknown
    }
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null
}

function stringField(record: Record<string, unknown>, field: string): string | null {
    const value = record[field]
    return typeof value === 'string' && value ? value : null
}

function numberField(record: Record<string, unknown>, field: string): number | null {
    const value = record[field]
    return typeof value === 'number' && Number.isSafeInteger(value) ? value : null
}

function metadataField(record: Record<string, unknown>): Record<string, string> | null {
    const metadata = jsonRecord(record.metadata)
    if (!metadata) return null
    return Object.fromEntries(
        Object.entries(metadata).filter((entry): entry is [string, string] => {
            return typeof entry[1] === 'string'
        }),
    )
}

function extractInvoiceLinePriceId(record: Record<string, unknown>): string | null {
    const lines = jsonRecord(record.lines)
    if (!lines) return null
    const data = lines.data
    if (!Array.isArray(data) || data.length === 0) return null
    const firstLine = jsonRecord(data[0])
    if (!firstLine) return null
    const legacyPrice = jsonRecord(firstLine.price)
    if (legacyPrice) {
        const legacyId = stringField(legacyPrice, 'id')
        if (legacyId) return legacyId
    }
    const pricing = jsonRecord(firstLine.pricing)
    const priceDetails = jsonRecord(pricing?.price_details)
    if (priceDetails) {
        const detailsId = stringField(priceDetails, 'price')
        if (detailsId) return detailsId
    }
    return null
}

function extractSubscriptionLinePriceId(record: Record<string, unknown>): string | null {
    const items = jsonRecord(record.items)
    if (!items) return null
    const data = items.data
    if (!Array.isArray(data) || data.length === 0) return null
    const firstItem = jsonRecord(data[0])
    if (!firstItem) return null
    const price = jsonRecord(firstItem.price)
    return price ? stringField(price, 'id') : null
}

function parseCheckoutSession(value: unknown): StripeCheckoutSession {
    const record = jsonRecord(value)
    if (!record) {
        throw new Error('Stripe checkout session payload was invalid')
    }
    return {
        id: stringField(record, 'id') ?? '',
        customer: stringField(record, 'customer'),
        subscription: stringField(record, 'subscription'),
        mode: stringField(record, 'mode') ?? '',
        payment_status: stringField(record, 'payment_status'),
        amount_total: numberField(record, 'amount_total'),
        amount_subtotal: numberField(record, 'amount_subtotal'),
        metadata: metadataField(record),
    }
}

function parseInvoice(value: unknown): StripeInvoice {
    const record = jsonRecord(value)
    if (!record) {
        throw new Error('Stripe invoice payload was invalid')
    }
    return {
        id: stringField(record, 'id') ?? '',
        customer: stringField(record, 'customer'),
        subscription: stringField(record, 'subscription'),
        status: stringField(record, 'status'),
        linePriceId: extractInvoiceLinePriceId(record),
        metadata: metadataField(record),
    }
}

function parseSubscription(value: unknown): StripeSubscription {
    const record = jsonRecord(value)
    if (!record) {
        throw new Error('Stripe subscription payload was invalid')
    }
    return {
        id: stringField(record, 'id') ?? '',
        customer: stringField(record, 'customer'),
        status: stringField(record, 'status'),
        linePriceId: extractSubscriptionLinePriceId(record),
        metadata: metadataField(record),
    }
}

function parseStripeEvent(value: unknown): StripeEvent {
    const record = jsonRecord(value)
    const data = jsonRecord(record?.data)
    if (!record || !data) {
        throw new Error('Stripe event payload was invalid')
    }
    return {
        id: stringField(record, 'id') ?? '',
        type: stringField(record, 'type') ?? '',
        livemode: record.livemode === true,
        data: {
            object: data.object,
        },
    }
}

function parseStripeSignature(header: string): { timestamp: string; signatures: string[] } {
    const parts = header.split(',').map((part) => part.trim())
    const timestamp = parts.map((part) => part.split('=')).find(([key]) => key === 't')?.[1]
    const signatures = parts
        .map((part) => part.split('='))
        .filter(([key, value]) => key === 'v1' && Boolean(value))
        .map(([, value]) => value)
    if (!timestamp || signatures.length === 0) {
        throw new HostedStripeWebhookError(
            'Stripe signature header is missing timestamp or signature',
        )
    }
    return {
        timestamp,
        signatures,
    }
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        {
            name: 'HMAC',
            hash: 'SHA-256',
        },
        false,
        ['sign'],
    )
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
    return Array.from(new Uint8Array(signature))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
}

export async function verifyStripeWebhookPayload(input: {
    secret: string
    body: string
    signatureHeader: string
    toleranceSeconds?: number
    nowSeconds?: number
}): Promise<StripeEvent> {
    const parsed = parseStripeSignature(input.signatureHeader)
    const timestamp = Number(parsed.timestamp)
    if (!Number.isSafeInteger(timestamp)) {
        throw new HostedStripeWebhookError('Stripe signature timestamp is invalid')
    }
    const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000)
    const toleranceSeconds = input.toleranceSeconds ?? 300
    if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
        throw new HostedStripeWebhookError(
            'Stripe signature timestamp is outside the allowed tolerance',
        )
    }
    const expected = await hmacSha256Hex(input.secret, `${parsed.timestamp}.${input.body}`)
    if (!parsed.signatures.some((signature) => timingSafeEqualHex(signature, expected))) {
        throw new HostedStripeWebhookError('Stripe webhook signature verification failed')
    }
    try {
        return parseStripeEvent(JSON.parse(input.body))
    } catch {
        throw new HostedStripeWebhookError('Stripe webhook payload was not valid JSON')
    }
}

type HostedBillingReturnState = 'subscription_success' | 'topup_success' | 'cancel'

function hostedBillingReturnUrl(origin: string, state: HostedBillingReturnState): string {
    const url = new URL('/billing', origin)
    url.searchParams.set('checkout', state)
    return url.toString()
}

function resolvePlanByKey(plans: HostedBillingPlan[], planKey: string): HostedBillingPlan {
    const plan = plans.find((candidate) => candidate.key === planKey)
    if (!plan) {
        throw new Error(`Hosted billing plan ${planKey} is not configured`)
    }
    return plan
}

function nullablePlanByKey(
    plans: HostedBillingPlan[],
    planKey: string | null,
): HostedBillingPlan | null {
    return planKey ? (plans.find((candidate) => candidate.key === planKey) ?? null) : null
}

function nullablePlanByPriceId(
    plans: HostedBillingPlan[],
    priceId: string | null,
): HostedBillingPlan | null {
    return priceId ? (plans.find((candidate) => candidate.priceId === priceId) ?? null) : null
}

function planStatusFromStripeSubscription(
    status: string | null,
): 'incomplete' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' {
    switch (status) {
        case 'trialing':
        case 'active':
        case 'past_due':
        case 'canceled':
        case 'unpaid':
        case 'incomplete':
            return status
        case 'incomplete_expired':
            return 'incomplete'
        case 'paused':
            return 'unpaid'
        default:
            return 'incomplete'
    }
}

export type HostedStripeCheckoutInput =
    | {
          env: AgentRoomHostedEnv
          actor: HostedActor
          kind: 'subscription'
          planKey: string
      }
    | {
          env: AgentRoomHostedEnv
          actor: HostedActor
          kind: 'credit_topup'
      }

export async function createHostedStripeCheckout(
    input: HostedStripeCheckoutInput,
): Promise<{ url: string }> {
    const config = resolveHostedConfig(input.env)
    await ensureHostedBillingAccount({
        env: input.env,
        workspaceId: input.actor.workspaceId,
    })

    let price: string
    let planKey: string | null = null
    if (input.kind === 'subscription') {
        const plan = resolvePlanByKey(config.billing.plans, input.planKey)
        price = plan.priceId
        planKey = plan.key
    } else {
        price = config.billing.stripe.creditTopupPriceId
    }

    const form = new URLSearchParams({
        mode: input.kind === 'subscription' ? 'subscription' : 'payment',
        success_url: hostedBillingReturnUrl(
            config.publicOrigin,
            input.kind === 'subscription' ? 'subscription_success' : 'topup_success',
        ),
        cancel_url: hostedBillingReturnUrl(config.publicOrigin, 'cancel'),
        'line_items[0][price]': price,
        'line_items[0][quantity]': '1',
        'metadata[workspace_id]': input.actor.workspaceId,
        'metadata[user_id]': input.actor.userId,
        'metadata[kind]': input.kind,
        client_reference_id: input.actor.workspaceId,
    })
    if (config.billing.taxMode === 'automatic') {
        form.set('automatic_tax[enabled]', 'true')
        form.set('billing_address_collection', 'required')
    }
    if (input.kind === 'subscription' && planKey) {
        form.set('metadata[plan_key]', planKey)
        form.set('subscription_data[metadata][workspace_id]', input.actor.workspaceId)
        form.set('subscription_data[metadata][user_id]', input.actor.userId)
        form.set('subscription_data[metadata][plan_key]', planKey)
    }
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
            authorization: `Bearer ${config.billing.stripe.secretKey}`,
            'content-type': 'application/x-www-form-urlencoded',
        },
        body: form,
    })
    const payload = (await response.json()) as { url?: unknown; error?: { message?: string } }
    if (!response.ok || typeof payload.url !== 'string') {
        throw new Error(payload.error?.message ?? 'Stripe checkout session creation failed')
    }
    return {
        url: payload.url,
    }
}

export async function createHostedStripePortalSession(input: {
    env: AgentRoomHostedEnv
    actor: HostedActor
}): Promise<{ url: string }> {
    const config = resolveHostedConfig(input.env)
    const account = await ensureHostedBillingAccount({
        env: input.env,
        workspaceId: input.actor.workspaceId,
    })
    if (!account.stripeCustomerId) {
        throw new Error('Hosted billing customer is not available yet')
    }
    const form = new URLSearchParams({
        customer: account.stripeCustomerId,
        return_url: new URL('/billing', config.publicOrigin).toString(),
    })
    const response = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
        method: 'POST',
        headers: {
            authorization: `Bearer ${config.billing.stripe.secretKey}`,
            'content-type': 'application/x-www-form-urlencoded',
        },
        body: form,
    })
    const payload = (await response.json()) as { url?: unknown; error?: { message?: string } }
    if (!response.ok || typeof payload.url !== 'string') {
        throw new Error(payload.error?.message ?? 'Stripe billing portal session creation failed')
    }
    return {
        url: payload.url,
    }
}

export async function readHostedBillingSummary(input: {
    env: AgentRoomHostedEnv
    actor: HostedActor
}): Promise<{
    account: Awaited<ReturnType<typeof ensureHostedBillingAccount>>
    ledger: Awaited<ReturnType<typeof listHostedBillingLedger>>
    usage: Awaited<ReturnType<typeof listRecentHostedBillableUsage>>
    remainingUsageCents: number
    active: boolean
    plans: HostedBillingPlan[]
    usageMarkupBps: number
    taxMode: 'none' | 'automatic'
    activePlanKey: string
    actions: Array<{
        kind: HostedBillingCheckoutKind
        planKey?: string
        label: string
        enabled: boolean
    }>
    providerSources: string[]
}> {
    const config = resolveHostedConfig(input.env)
    await ensureHostedBillingAccount({
        env: input.env,
        workspaceId: input.actor.workspaceId,
    })
    await releaseExpiredHostedBillingReservations({
        env: input.env,
        workspaceId: input.actor.workspaceId,
    })
    const account = await readHostedBillingAccount({
        env: input.env,
        workspaceId: input.actor.workspaceId,
    })
    const [ledger, usage] = await Promise.all([
        listHostedBillingLedger({
            env: input.env,
            workspaceId: input.actor.workspaceId,
            limit: 50,
        }),
        listRecentHostedBillableUsage({
            env: input.env,
            workspaceId: input.actor.workspaceId,
            limit: 50,
        }),
    ])

    const planActions = config.billing.plans.map((plan) => ({
        kind: 'subscription' as const,
        planKey: plan.key,
        label: `Subscribe to ${plan.key}`,
        enabled: true,
    }))

    return {
        account,
        ledger,
        usage,
        remainingUsageCents: account.availableBalanceCents,
        active: isHostedBillingPlanStatusActive(account.planStatus),
        plans: config.billing.plans,
        usageMarkupBps: config.billing.usageMarkupBps,
        taxMode: config.billing.taxMode,
        activePlanKey: account.planKey,
        actions: [
            ...planActions,
            {
                kind: 'credit_topup' as const,
                label: 'Credit top-up',
                enabled: true,
            },
        ],
        providerSources: [...hostedModelSourceLabels],
    }
}

export async function processHostedStripeWebhook(input: {
    env: AgentRoomHostedEnv
    body: string
    signatureHeader: string
}): Promise<{ processed: boolean; eventId: string; type: string }> {
    const config = resolveHostedConfig(input.env)
    const event = await verifyStripeWebhookPayload({
        secret: config.billing.stripe.webhookSecret,
        body: input.body,
        signatureHeader: input.signatureHeader,
    })
    const alreadyProcessed = await hostedStripeEventExists({
        env: input.env,
        eventId: event.id,
    })
    if (alreadyProcessed) {
        return {
            processed: false,
            eventId: event.id,
            type: event.type,
        }
    }

    if (event.type === 'checkout.session.completed') {
        await processCheckoutCompleted({
            env: input.env,
            eventId: event.id,
            session: parseCheckoutSession(event.data.object),
        })
    }
    if (event.type === 'invoice.paid') {
        await processInvoicePaid({
            env: input.env,
            eventId: event.id,
            invoice: parseInvoice(event.data.object),
            plans: config.billing.plans,
        })
    }
    if (
        event.type === 'customer.subscription.created' ||
        event.type === 'customer.subscription.updated' ||
        event.type === 'customer.subscription.deleted'
    ) {
        await processSubscriptionChanged({
            env: input.env,
            subscription: parseSubscription(event.data.object),
            plans: config.billing.plans,
            deleted: event.type === 'customer.subscription.deleted',
        })
    }

    await recordHostedStripeEvent({
        env: input.env,
        eventId: event.id,
        type: event.type,
        livemode: event.livemode,
    })
    return {
        processed: true,
        eventId: event.id,
        type: event.type,
    }
}

async function processSubscriptionChanged(input: {
    env: AgentRoomHostedEnv
    subscription: StripeSubscription
    plans: HostedBillingPlan[]
    deleted: boolean
}): Promise<void> {
    if (!input.subscription.customer || !input.subscription.id) {
        throw new Error('Stripe subscription is missing hosted billing metadata')
    }
    const existingAccount = await findHostedBillingAccountByStripeIds({
        env: input.env,
        stripeCustomerId: input.subscription.customer,
        stripeSubscriptionId: input.subscription.id,
    })
    const workspaceId = input.subscription.metadata?.workspace_id ?? existingAccount?.workspaceId
    if (!workspaceId) {
        throw new Error('Stripe subscription could not be matched to a hosted workspace')
    }
    await ensureHostedBillingAccount({
        env: input.env,
        workspaceId,
    })
    const existingPlan = nullablePlanByKey(input.plans, existingAccount?.planKey ?? null)
    const plan =
        nullablePlanByKey(input.plans, input.subscription.metadata?.plan_key ?? null) ??
        nullablePlanByPriceId(input.plans, input.subscription.linePriceId) ??
        existingPlan
    await upsertHostedStripeCustomer({
        env: input.env,
        workspaceId,
        stripeCustomerId: input.subscription.customer,
        stripeSubscriptionId: input.subscription.id,
        planStatus: input.deleted
            ? 'canceled'
            : planStatusFromStripeSubscription(input.subscription.status),
        planKey: plan?.key,
        includedMonthlyCreditCents: plan?.includedCents,
    })
}

async function processCheckoutCompleted(input: {
    env: AgentRoomHostedEnv
    eventId: string
    session: StripeCheckoutSession
}): Promise<void> {
    const workspaceId = input.session.metadata?.workspace_id
    const kind = hostedBillingCheckoutKindSchema.safeParse(input.session.metadata?.kind)
    if (!workspaceId || !kind.success || !input.session.customer) {
        throw new Error('Stripe checkout session is missing hosted billing metadata')
    }
    await ensureHostedBillingAccount({
        env: input.env,
        workspaceId,
    })
    await upsertHostedStripeCustomer({
        env: input.env,
        workspaceId,
        stripeCustomerId: input.session.customer,
        stripeSubscriptionId: input.session.subscription,
        planStatus: input.session.subscription ? 'active' : undefined,
        planKey: input.session.metadata?.plan_key ?? undefined,
    })
    if (kind.data === 'credit_topup') {
        const amountCents = input.session.amount_subtotal
        if (input.session.payment_status !== 'paid') {
            throw new Error('Stripe top-up checkout session was not paid')
        }
        if (!amountCents) {
            throw new Error('Stripe top-up checkout session is missing a pre-tax subtotal')
        }
        await creditHostedBalance({
            env: input.env,
            workspaceId,
            source: 'stripe_topup',
            amountCents,
            idempotencyKey: `stripe_checkout:${input.session.id}`,
            stripeEventId: input.eventId,
            stripeCheckoutSessionId: input.session.id,
            metadata: {
                checkoutKind: kind.data,
                amountSubtotalCents: amountCents,
                amountTotalCents: input.session.amount_total,
            },
        })
    }
}

async function processInvoicePaid(input: {
    env: AgentRoomHostedEnv
    eventId: string
    invoice: StripeInvoice
    plans: HostedBillingPlan[]
}): Promise<void> {
    if (!input.invoice.customer || !input.invoice.subscription) {
        throw new Error('Stripe invoice is missing hosted subscription metadata')
    }
    const existingAccount = await findHostedBillingAccountByStripeIds({
        env: input.env,
        stripeCustomerId: input.invoice.customer,
        stripeSubscriptionId: input.invoice.subscription,
    })
    const workspaceId = input.invoice.metadata?.workspace_id ?? existingAccount?.workspaceId
    if (!workspaceId) {
        throw new Error('Stripe invoice could not be matched to a hosted workspace')
    }
    await ensureHostedBillingAccount({
        env: input.env,
        workspaceId,
    })
    const account = await readHostedBillingAccount({
        env: input.env,
        workspaceId,
    })
    const plan = resolveInvoicePlan({
        plans: input.plans,
        planKey: account.planKey,
        linePriceId: input.invoice.linePriceId,
    })

    await upsertHostedStripeCustomer({
        env: input.env,
        workspaceId,
        stripeCustomerId: input.invoice.customer,
        stripeSubscriptionId: input.invoice.subscription,
        planStatus: 'active',
        planKey: plan.key,
        includedMonthlyCreditCents: plan.includedCents,
    })

    await expireIncludedBalance({
        env: input.env,
        workspaceId,
        idempotencyKey: `stripe_invoice:${input.invoice.id}:included_expiry`,
        stripeEventId: input.eventId,
        stripeInvoiceId: input.invoice.id,
        metadata: {
            invoiceStatus: input.invoice.status,
            planKey: plan.key,
        },
    })

    if (plan.includedCents > 0) {
        await creditHostedBalance({
            env: input.env,
            workspaceId,
            source: 'subscription_included_credit',
            amountCents: plan.includedCents,
            idempotencyKey: `stripe_invoice:${input.invoice.id}:included_usage`,
            stripeEventId: input.eventId,
            stripeInvoiceId: input.invoice.id,
            metadata: {
                invoiceStatus: input.invoice.status,
                planKey: plan.key,
            },
        })
    }
}

function resolveInvoicePlan(input: {
    plans: HostedBillingPlan[]
    planKey: string
    linePriceId: string | null
}): HostedBillingPlan {
    const byKey = input.plans.find((plan) => plan.key === input.planKey)
    if (byKey) return byKey
    if (input.linePriceId) {
        const byPrice = input.plans.find((plan) => plan.priceId === input.linePriceId)
        if (byPrice) return byPrice
    }
    throw new Error('Stripe invoice could not be matched to a hosted billing plan')
}
