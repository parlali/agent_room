import { useState } from 'react'
import type { FormEvent } from 'react'

import { waitlistEmail, waitlistFields } from '~/content/pricing'

export function WaitlistForm() {
    const [submitted, setSubmitted] = useState(false)

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const form = event.currentTarget
        const data = new FormData(form)
        const lines = waitlistFields.map((field) => `${field.label}: ${data.get(field.name) ?? ''}`)
        const body = encodeURIComponent(lines.join('\n'))
        const subject = encodeURIComponent('Agent Room hosted waitlist')
        window.location.href = `mailto:${waitlistEmail}?subject=${subject}&body=${body}`
        setSubmitted(true)
    }

    return (
        <div className="panel p-6 shadow-[var(--shadow-panel)] sm:p-8">
            <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
                {waitlistFields.map((field) => (
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
                                className="rounded-md border border-line-strong bg-paper px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent-blue"
                            />
                        ) : field.type === 'select' ? (
                            <select
                                name={field.name}
                                required={field.required}
                                defaultValue=""
                                className="h-10 rounded-md border border-line-strong bg-paper px-3 text-sm text-ink outline-none transition-colors focus:border-accent-blue"
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
                                className="h-10 rounded-md border border-line-strong bg-paper px-3 text-sm text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent-blue"
                            />
                        )}
                    </label>
                ))}

                <button type="submit" className="btn btn-primary mt-1 w-full">
                    Join Waitlist
                </button>

                {submitted ? (
                    <p className="text-sm text-ink-soft" role="status">
                        Your mail client should open with your details. If it does not, email{' '}
                        <a className="text-accent-blue underline" href={`mailto:${waitlistEmail}`}>
                            {waitlistEmail}
                        </a>
                        .
                    </p>
                ) : (
                    <p className="text-xs text-ink-faint">
                        No backend yet. Submitting opens your mail client to send your details to
                        the waitlist.
                    </p>
                )}
            </form>
        </div>
    )
}
