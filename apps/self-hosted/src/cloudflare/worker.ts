import { ContainerProxy } from '@cloudflare/containers'
import type { ExecutionContext, MessageBatch } from '@cloudflare/workers-types'
import serverEntry from '@tanstack/react-start/server-entry'
import type { AgentRoomHostedEnv, AgentRoomRuntimeJobMessage } from '#/server/cloudflare/bindings'
import { getHostedAuth, readHostedActorFromRequest } from '#/server/cloudflare/hosted-auth'
import { hostedBillingCheckoutKindSchema } from '#/server/cloudflare/hosted-billing-types'
import { resolveHostedConfig } from '#/server/cloudflare/hosted-config'
import { runWithHostedRequestContext } from '#/server/cloudflare/hosted-request-context'
import { hostedRouteSameOriginResponse } from '#/server/cloudflare/hosted-route-auth'
import { reconcileHostedRuntimeJob } from '#/server/cloudflare/hosted-runtime-adapter'
import {
    createHostedStripeCheckout,
    HostedStripeWebhookError,
    processHostedStripeWebhook,
    readHostedBillingSummary,
} from '#/server/cloudflare/hosted-stripe'
import { hostedJsonResponse as jsonResponse } from '#/server/cloudflare/hosted-worker-response'
import { hostedRuntimeWorkerRoute } from '#/server/cloudflare/hosted-worker-runtime-routes'
import { AgentRoomRuntimeContainer } from '#/server/cloudflare/runtime-container'

export { AgentRoomRuntimeContainer }
export { ContainerProxy }

function assertBinding(value: unknown, name: keyof AgentRoomHostedEnv): void {
    if (!value) {
        throw new Error(`Missing Cloudflare binding ${name}`)
    }
}

function hostedHealth(env: AgentRoomHostedEnv): Response {
    const config = resolveHostedConfig(env)
    assertBinding(env.AGENT_ROOM_DB, 'AGENT_ROOM_DB')
    assertBinding(env.AGENT_ROOM_WORKSPACE_BUCKET, 'AGENT_ROOM_WORKSPACE_BUCKET')
    assertBinding(env.AGENT_ROOM_RUNTIME_JOBS, 'AGENT_ROOM_RUNTIME_JOBS')
    assertBinding(env.AGENT_ROOM_RUNTIME, 'AGENT_ROOM_RUNTIME')

    return jsonResponse({
        ok: true,
        authMode: config.authMode,
        billingMode: config.billing.mode,
        runtimeBackend: config.runtimeBackend,
        runtimeStorage: config.runtimeStorage,
        publicOrigin: config.publicOrigin,
        bindings: {
            d1: true,
            r2: true,
            queue: true,
            runtimeContainer: true,
            assets: Boolean(env.ASSETS),
        },
    })
}

async function requireHostedActor(
    env: AgentRoomHostedEnv,
    request: Request,
): Promise<NonNullable<Awaited<ReturnType<typeof readHostedActorFromRequest>>> | Response> {
    const actor = await readHostedActorFromRequest(env, request)
    if (!actor) {
        return jsonResponse(
            {
                ok: false,
                code: 'unauthorized',
                message: 'Hosted endpoint requires an authenticated workspace owner',
            },
            {
                status: 401,
            },
        )
    }
    return actor
}

async function hostedBillingSummary(env: AgentRoomHostedEnv, request: Request): Promise<Response> {
    const actor = await requireHostedActor(env, request)
    if (actor instanceof Response) return actor
    return jsonResponse({
        ok: true,
        billing: await readHostedBillingSummary({
            env,
            actor,
        }),
    })
}

async function hostedBillingCheckout(env: AgentRoomHostedEnv, request: Request): Promise<Response> {
    const originFailure = hostedRouteSameOriginResponse({
        env,
        request,
    })
    if (originFailure) {
        return jsonResponse(
            {
                ok: false,
                code: 'forbidden',
                message: 'Cross-origin mutation request blocked',
            },
            {
                status: 403,
            },
        )
    }
    const actor = await requireHostedActor(env, request)
    if (actor instanceof Response) return actor
    let record: Record<string, unknown> = {}
    try {
        const body = (await request.json()) as unknown
        record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
    } catch {
        return jsonResponse(
            {
                ok: false,
                code: 'invalid_request_body',
                message: 'Request body must be valid JSON',
            },
            {
                status: 400,
            },
        )
    }
    const kindResult = hostedBillingCheckoutKindSchema.safeParse(record.kind)
    if (!kindResult.success) {
        return jsonResponse(
            {
                ok: false,
                code: 'invalid_checkout_kind',
                message: 'A valid checkout kind is required',
            },
            {
                status: 400,
            },
        )
    }
    const kind = kindResult.data
    if (kind === 'credit_topup') {
        const checkout = await createHostedStripeCheckout({
            env,
            actor,
            kind,
        })
        return jsonResponse({
            ok: true,
            checkout,
        })
    }
    const planKey = typeof record.planKey === 'string' ? record.planKey : ''
    const config = resolveHostedConfig(env)
    if (!planKey || !config.billing.plans.some((plan) => plan.key === planKey)) {
        return jsonResponse(
            {
                ok: false,
                code: 'invalid_plan_key',
                message: 'A valid subscription plan key is required',
            },
            {
                status: 400,
            },
        )
    }
    const checkout = await createHostedStripeCheckout({
        env,
        actor,
        kind,
        planKey,
    })
    return jsonResponse({
        ok: true,
        checkout,
    })
}

async function hostedStripeWebhook(env: AgentRoomHostedEnv, request: Request): Promise<Response> {
    const signatureHeader = request.headers.get('stripe-signature')
    if (!signatureHeader) {
        return jsonResponse(
            {
                ok: false,
                code: 'missing_stripe_signature',
            },
            {
                status: 400,
            },
        )
    }
    try {
        const result = await processHostedStripeWebhook({
            env,
            body: await request.text(),
            signatureHeader,
        })
        return jsonResponse({
            ok: true,
            ...result,
        })
    } catch (error) {
        if (error instanceof HostedStripeWebhookError) {
            return jsonResponse(
                {
                    ok: false,
                    code: 'invalid_stripe_webhook',
                    message: error.message,
                },
                {
                    status: 400,
                },
            )
        }
        throw error
    }
}

interface HostedWorkerHandler {
    fetch: (
        request: Request,
        env: AgentRoomHostedEnv,
        ctx: ExecutionContext,
    ) => Promise<Response> | Response
    queue: (
        batch: MessageBatch<AgentRoomRuntimeJobMessage>,
        env: AgentRoomHostedEnv,
    ) => Promise<void>
}

export default {
    async fetch(request: Request, env: AgentRoomHostedEnv, _ctx: ExecutionContext) {
        const url = new URL(request.url)
        if (url.pathname === '/api/hosted/health') {
            return hostedHealth(env)
        }
        if (url.pathname === '/api/hosted/billing' && request.method === 'GET') {
            return hostedBillingSummary(env, request)
        }
        if (url.pathname === '/api/hosted/billing/checkout' && request.method === 'POST') {
            return hostedBillingCheckout(env, request)
        }
        if (url.pathname === '/api/hosted/stripe/webhook' && request.method === 'POST') {
            return hostedStripeWebhook(env, request)
        }
        const runtimeResponse = await hostedRuntimeWorkerRoute({ env, request, url })
        if (runtimeResponse) {
            return runtimeResponse
        }
        if (url.pathname.startsWith('/api/auth/')) {
            return getHostedAuth(env).handler(request)
        }
        return runWithHostedRequestContext({ env, request }, () => serverEntry.fetch(request))
    },

    async queue(batch: MessageBatch<AgentRoomRuntimeJobMessage>, env: AgentRoomHostedEnv) {
        for (const message of batch.messages) {
            try {
                await reconcileHostedRuntimeJob(env, message.body)
                message.ack()
            } catch (error) {
                console.error(
                    'Hosted runtime reconcile failed',
                    error instanceof Error ? error.message : error,
                )
                message.retry()
            }
        }
    },
} satisfies HostedWorkerHandler
