import { useState } from 'react'
import type { FormEvent } from 'react'

import { waitlistFields } from '~/content/pricing'
import type { WaitlistFieldErrors } from '~/content/types'
import { submitWaitlist, type WaitlistFormState } from '~/lib/waitlist-api'

function fieldError(errors: WaitlistFieldErrors | undefined, name: string): string | undefined {
    if (!errors) {
        return undefined
    }

    return errors[name as keyof WaitlistFieldErrors]
}

export function WaitlistForm() {
    const [formState, setFormState] = useState<WaitlistFormState>({ status: 'idle' })
    const [fieldErrors, setFieldErrors] = useState<WaitlistFieldErrors>({})

    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()

        const form = event.currentTarget
        const data = new FormData(form)
        const payload = Object.fromEntries(
            waitlistFields.map((field) => [field.name, String(data.get(field.name) ?? '').trim()]),
        )

        payload.website = String(data.get('website') ?? '')

        setFormState({ status: 'submitting' })
        setFieldErrors({})

        const response = await submitWaitlist(payload)

        if (response.ok) {
            setFormState({ status: 'success' })
            form.reset()
            return
        }

        setFieldErrors(response.errors ?? {})
        setFormState({
            status: 'error',
            message: response.message,
            fieldErrors: response.errors,
        })
    }

    const isSubmitting = formState.status === 'submitting'

    return (
        <div className="surface-raised p-6 sm:p-8">
            {formState.status === 'success' ? (
                <div className="flex flex-col gap-3" role="status">
                    <p className="text-lg font-medium text-ink">You are on the waitlist.</p>
                    <p className="text-sm leading-relaxed text-ink-soft">
                        We saved your details and will reach out as hosted access opens.
                    </p>
                </div>
            ) : (
                <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
                    <label className="sr-only" aria-hidden="true">
                        Website
                        <input tabIndex={-1} autoComplete="off" name="website" className="hidden" />
                    </label>

                    {waitlistFields.map((field) => {
                        const error = fieldError(fieldErrors, field.name)

                        return (
                            <label key={field.name} className="flex flex-col gap-1.5">
                                <span className="text-sm font-medium text-ink">
                                    {field.label}
                                    {field.required ? (
                                        <span className="text-accent-red"> *</span>
                                    ) : (
                                        <span className="text-ink-faint"> (optional)</span>
                                    )}
                                </span>
                                {field.type === 'textarea' ? (
                                    <textarea
                                        name={field.name}
                                        required={field.required}
                                        placeholder={field.placeholder}
                                        rows={3}
                                        aria-invalid={error ? true : undefined}
                                        className="rounded-[var(--radius-input)] border border-line-strong bg-paper px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent-blue aria-invalid:border-accent-red"
                                    />
                                ) : field.type === 'select' ? (
                                    <select
                                        name={field.name}
                                        required={field.required}
                                        defaultValue=""
                                        aria-invalid={error ? true : undefined}
                                        className="h-10 rounded-[var(--radius-input)] border border-line-strong bg-paper px-3 text-sm text-ink outline-none transition-colors focus:border-accent-blue aria-invalid:border-accent-red"
                                    >
                                        <option value="" disabled>
                                            Select one
                                        </option>
                                        {field.options?.map((option) => (
                                            <option key={option} value={option}>
                                                {option}
                                            </option>
                                        ))}
                                    </select>
                                ) : (
                                    <input
                                        name={field.name}
                                        type={field.type}
                                        required={field.required}
                                        placeholder={field.placeholder}
                                        aria-invalid={error ? true : undefined}
                                        className="h-10 rounded-[var(--radius-input)] border border-line-strong bg-paper px-3 text-sm text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent-blue aria-invalid:border-accent-red"
                                    />
                                )}
                                {error ? (
                                    <span className="text-xs text-accent-red" role="alert">
                                        {error}
                                    </span>
                                ) : null}
                            </label>
                        )
                    })}

                    <button
                        type="submit"
                        className="btn btn-primary mt-1 w-full"
                        disabled={isSubmitting}
                    >
                        {isSubmitting ? 'Submitting...' : 'Join Waitlist'}
                    </button>

                    {formState.status === 'error' ? (
                        <p className="text-sm text-accent-red" role="alert">
                            {formState.message}
                        </p>
                    ) : null}
                </form>
            )}
        </div>
    )
}
