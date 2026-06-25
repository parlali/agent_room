import type { AgentRoomHostedEnv } from './bindings'
import { assertChanged } from './hosted-d1'
import type { HostedBillingAccountSnapshot, HostedBillingPlanStatus } from './hosted-billing-types'
import { nowIso } from './hosted-json'

interface BillingAccountRow {
    workspaceId: string
    stripeCustomerId: string | null
    stripeSubscriptionId: string | null
    planKey: string
    planStatus: HostedBillingPlanStatus
    includedBalanceCents: number
    purchasedBalanceCents: number
    includedReservedCents?: number
    purchasedReservedCents?: number
    includedMonthlyCreditCents: number
    createdAt: string
    updatedAt: string
}

function mapAccount(row: BillingAccountRow): HostedBillingAccountSnapshot {
    return {
        workspaceId: row.workspaceId,
        stripeCustomerId: row.stripeCustomerId,
        stripeSubscriptionId: row.stripeSubscriptionId,
        planKey: row.planKey,
        planStatus: row.planStatus,
        includedBalanceCents: row.includedBalanceCents,
        purchasedBalanceCents: row.purchasedBalanceCents,
        currentBalanceCents: row.includedBalanceCents + row.purchasedBalanceCents,
        includedReservedCents: row.includedReservedCents ?? 0,
        purchasedReservedCents: row.purchasedReservedCents ?? 0,
        reservedBalanceCents: (row.includedReservedCents ?? 0) + (row.purchasedReservedCents ?? 0),
        availableBalanceCents:
            row.includedBalanceCents +
            row.purchasedBalanceCents -
            (row.includedReservedCents ?? 0) -
            (row.purchasedReservedCents ?? 0),
        includedMonthlyCreditCents: row.includedMonthlyCreditCents,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }
}

export async function ensureHostedBillingAccount(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    now?: Date
}): Promise<HostedBillingAccountSnapshot> {
    const now = nowIso(input.now)
    await input.env.AGENT_ROOM_DB.prepare(
        `
            INSERT INTO hosted_billing_account (
                workspace_id,
                plan_key,
                included_balance_cents,
                purchased_balance_cents,
                included_monthly_credit_cents,
                created_at,
                updated_at
            )
            VALUES (?1, 'none', 0, 0, 0, ?2, ?2)
            ON CONFLICT(workspace_id) DO NOTHING
        `,
    )
        .bind(input.workspaceId, now)
        .run()
    return readHostedBillingAccount(input)
}

export async function readHostedBillingAccount(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
}): Promise<HostedBillingAccountSnapshot> {
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                workspace_id AS workspaceId,
                stripe_customer_id AS stripeCustomerId,
                stripe_subscription_id AS stripeSubscriptionId,
                plan_key AS planKey,
                plan_status AS planStatus,
                included_balance_cents AS includedBalanceCents,
                purchased_balance_cents AS purchasedBalanceCents,
                included_reserved_cents AS includedReservedCents,
                purchased_reserved_cents AS purchasedReservedCents,
                included_monthly_credit_cents AS includedMonthlyCreditCents,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM hosted_billing_account
            WHERE workspace_id = ?1
            LIMIT 1
        `,
    )
        .bind(input.workspaceId)
        .first<BillingAccountRow>()
    if (!row) {
        throw new Error('Hosted billing account was not found')
    }
    return mapAccount(row)
}

export async function findHostedBillingAccountByStripeIds(input: {
    env: AgentRoomHostedEnv
    stripeCustomerId: string | null
    stripeSubscriptionId: string | null
}): Promise<HostedBillingAccountSnapshot | null> {
    const row = await input.env.AGENT_ROOM_DB.prepare(
        `
            SELECT
                workspace_id AS workspaceId,
                stripe_customer_id AS stripeCustomerId,
                stripe_subscription_id AS stripeSubscriptionId,
                plan_key AS planKey,
                plan_status AS planStatus,
                included_balance_cents AS includedBalanceCents,
                purchased_balance_cents AS purchasedBalanceCents,
                included_reserved_cents AS includedReservedCents,
                purchased_reserved_cents AS purchasedReservedCents,
                included_monthly_credit_cents AS includedMonthlyCreditCents,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM hosted_billing_account
            WHERE (?1 IS NOT NULL AND stripe_subscription_id = ?1)
               OR (?2 IS NOT NULL AND stripe_customer_id = ?2)
            LIMIT 1
        `,
    )
        .bind(input.stripeSubscriptionId, input.stripeCustomerId)
        .first<BillingAccountRow>()
    return row ? mapAccount(row) : null
}

export async function upsertHostedStripeCustomer(input: {
    env: AgentRoomHostedEnv
    workspaceId: string
    stripeCustomerId: string
    stripeSubscriptionId?: string | null
    planStatus?: HostedBillingPlanStatus
    planKey?: string
    includedMonthlyCreditCents?: number
    now?: Date
}): Promise<void> {
    const now = nowIso(input.now)
    const result = await input.env.AGENT_ROOM_DB.prepare(
        `
            UPDATE hosted_billing_account
            SET stripe_customer_id = ?2,
                stripe_subscription_id = COALESCE(?3, stripe_subscription_id),
                plan_status = COALESCE(?4, plan_status),
                plan_key = COALESCE(?5, plan_key),
                included_monthly_credit_cents = COALESCE(?6, included_monthly_credit_cents),
                updated_at = ?7
            WHERE workspace_id = ?1
        `,
    )
        .bind(
            input.workspaceId,
            input.stripeCustomerId,
            input.stripeSubscriptionId ?? null,
            input.planStatus ?? null,
            input.planKey ?? null,
            input.includedMonthlyCreditCents ?? null,
            now,
        )
        .run()
    assertChanged(result, 'Hosted billing account was not found while updating Stripe customer')
}
