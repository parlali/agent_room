import { formatHostedUsd, hostedBillingCatalog } from '@agent-room/billing'
import type { FaqItem, WaitlistField } from './types'

export const pricing = {
    eyebrow: 'Hosted pricing',
    title: 'Hosted Agent Room pricing.',
    summary:
        'Subscriptions cover hosted runtime operation. Managed OpenRouter, Brave, Browserbase, and fetch usage draw down included credits first, then purchased credits.',
}

export const pricingPlans = hostedBillingCatalog.plans.map((plan) => ({
    key: plan.key,
    name: plan.name,
    summary: plan.summary,
    monthly: formatHostedUsd(plan.monthlyCents),
    includedUsage:
        plan.includedCents > 0
            ? `${formatHostedUsd(plan.includedCents)} managed usage included`
            : 'No included managed usage',
    features: [
        'Hosted isolated rooms',
        'Bring your own provider keys',
        plan.managedOpenRouter ? 'Managed OpenRouter fallback' : null,
        plan.managedBrave ? 'Managed Brave search fallback' : null,
        plan.managedFetchUrl ? 'Managed fetch_url proxy' : null,
        plan.managedBrowserbase ? 'Managed Browserbase sessions' : 'Browserbase by user key',
    ].filter((feature): feature is string => feature !== null),
}))

type PricingPlanKey = (typeof hostedBillingCatalog.plans)[number]['key']

function valuesByPlan(
    valueForPlan: (plan: (typeof hostedBillingCatalog.plans)[number]) => string,
): Record<PricingPlanKey, string> {
    return Object.fromEntries(
        hostedBillingCatalog.plans.map((plan) => [plan.key, valueForPlan(plan)]),
    ) as Record<PricingPlanKey, string>
}

function managedCreditValue(enabled: boolean): string {
    return enabled ? 'Credits' : 'Not included'
}

export const pricingFeatureRows = [
    {
        label: 'Hosted runtime isolation',
        values: valuesByPlan(() => 'Included'),
    },
    {
        label: 'Bring your own keys',
        values: valuesByPlan(() => 'Models, Brave, Browserbase'),
    },
    {
        label: 'Managed OpenRouter fallback',
        values: valuesByPlan((plan) => managedCreditValue(plan.managedOpenRouter)),
    },
    {
        label: 'Managed Brave search fallback',
        values: valuesByPlan((plan) => managedCreditValue(plan.managedBrave)),
    },
    {
        label: 'Managed fetch_url proxy',
        values: valuesByPlan((plan) => managedCreditValue(plan.managedFetchUrl)),
    },
    {
        label: 'Managed Browserbase',
        values: valuesByPlan((plan) => (plan.managedBrowserbase ? 'Credits' : 'BYOK only')),
    },
    {
        label: 'Included managed usage',
        values: valuesByPlan((plan) =>
            plan.includedCents > 0 ? formatHostedUsd(plan.includedCents) : 'None',
        ),
    },
]

export const pricingTopup = {
    label: 'Credit top-up',
    price: formatHostedUsd(hostedBillingCatalog.topups[0].amountCents),
    credit: `${formatHostedUsd(hostedBillingCatalog.topups[0].creditCents)} managed usage credits`,
}

export const pricingFaq: FaqItem[] = [
    {
        question: 'How much does hosted Agent Room cost?',
        answer: `Hosted plans start at ${formatHostedUsd(hostedBillingCatalog.plans[0].monthlyCents)} per month. Standard and Pro include managed usage credits, and all plans can use purchased top-up credits.`,
    },
    {
        question: 'How will usage be measured?',
        answer: 'Managed provider calls are written to room usage events and billed against included credits first, then purchased credits. Bring-your-own-key calls use your provider account directly.',
    },
    {
        question: 'What is the difference between hosted and self-hosted?',
        answer: 'The source is available to self-host at no cost. Hosted Agent Room runs the isolation, runtime, and credential handling for you so your team does not operate the stack.',
    },
    {
        question: 'Which plan includes managed Browserbase?',
        answer: 'Managed Browserbase access is included only with Pro. Starter and Standard can still use Browserbase when you provide your own Browserbase API key.',
    },
]

export const waitlistFields: WaitlistField[] = [
    { name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'Your name' },
    {
        name: 'email',
        label: 'Email',
        type: 'email',
        required: true,
        placeholder: 'you@company.com',
    },
    {
        name: 'company',
        label: 'Company or project',
        type: 'text',
        required: true,
        placeholder: 'Where this will be used',
    },
    {
        name: 'useCase',
        label: 'Expected use case',
        type: 'textarea',
        required: false,
        placeholder: 'What kind of rooms do you want to run?',
    },
    {
        name: 'interest',
        label: 'Hosted or self-hosted interest',
        type: 'select',
        required: true,
        options: ['Hosted', 'Self-hosted', 'Both'],
    },
]
