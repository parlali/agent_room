import type { WaitlistFieldErrors, WaitlistSubmitResponse } from '~/content/types'

const defaultEndpoint = '/api/waitlist'

export function waitlistEndpoint(): string {
    return import.meta.env.VITE_WAITLIST_API_URL ?? defaultEndpoint
}

export async function submitWaitlist(
    payload: Record<string, string>,
): Promise<WaitlistSubmitResponse> {
    const response = await fetch(waitlistEndpoint(), {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
    })

    const body = (await response.json()) as WaitlistSubmitResponse

    if (!body || typeof body.ok !== 'boolean') {
        return {
            ok: false,
            message: 'The waitlist endpoint returned an unexpected response.',
        }
    }

    return body
}

export type WaitlistFormState =
    | { status: 'idle' }
    | { status: 'submitting' }
    | { status: 'success' }
    | { status: 'error'; message: string; fieldErrors?: WaitlistFieldErrors }
