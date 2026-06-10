import type {
    WaitlistFieldErrors,
    WaitlistInterest,
    WaitlistSubmission,
    WaitlistSubmitError,
    WaitlistSubmitResponse,
} from '../src/content/types'

const waitlistInterests: WaitlistInterest[] = ['Hosted', 'Self-hosted', 'Both']

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const waitlistApiPath = '/api/waitlist'

export type WaitlistRequestBody = {
    name: string
    email: string
    company: string
    useCase: string
    interest: string
    website?: string
}

export function parseWaitlistBody(raw: unknown): WaitlistRequestBody | null {
    if (!raw || typeof raw !== 'object') {
        return null
    }

    const body = raw as Record<string, unknown>

    return {
        name: typeof body.name === 'string' ? body.name.trim() : '',
        email: typeof body.email === 'string' ? body.email.trim() : '',
        company: typeof body.company === 'string' ? body.company.trim() : '',
        useCase: typeof body.useCase === 'string' ? body.useCase.trim() : '',
        interest: typeof body.interest === 'string' ? (body.interest as WaitlistInterest) : '',
        website: typeof body.website === 'string' ? body.website.trim() : '',
    }
}

export function validateWaitlistSubmission(body: WaitlistRequestBody): WaitlistFieldErrors | null {
    const errors: WaitlistFieldErrors = {}

    if (!body.name) {
        errors.name = 'Name is required.'
    } else if (body.name.length > 120) {
        errors.name = 'Name must be 120 characters or fewer.'
    }

    if (!body.email) {
        errors.email = 'Email is required.'
    } else if (!emailPattern.test(body.email)) {
        errors.email = 'Enter a valid email address.'
    } else if (body.email.length > 254) {
        errors.email = 'Email must be 254 characters or fewer.'
    }

    if (!body.company) {
        errors.company = 'Company or project is required.'
    } else if (body.company.length > 160) {
        errors.company = 'Company or project must be 160 characters or fewer.'
    }

    if (body.useCase.length > 2000) {
        errors.useCase = 'Expected use case must be 2000 characters or fewer.'
    }

    if (!body.interest) {
        errors.interest = 'Select hosted or self-hosted interest.'
    } else if (!waitlistInterests.includes(body.interest as WaitlistInterest)) {
        errors.interest = 'Select a valid interest option.'
    }

    return Object.keys(errors).length > 0 ? errors : null
}

export function toWaitlistSubmission(body: WaitlistRequestBody): WaitlistSubmission {
    return {
        name: body.name,
        email: body.email,
        company: body.company,
        useCase: body.useCase,
        interest: body.interest as WaitlistInterest,
    }
}

export function waitlistError(message: string, errors?: WaitlistFieldErrors): WaitlistSubmitError {
    return {
        ok: false,
        message,
        errors,
    }
}

export function waitlistSuccess(): WaitlistSubmitResponse {
    return { ok: true }
}

export function jsonResponse(body: WaitlistSubmitResponse, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
        },
    })
}
