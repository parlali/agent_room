import { formatHostedUsd, hostedBillingCatalog } from '@agent-room/billing'
import type { FaqItem, WaitlistField } from './types'

export const pricing = {
    eyebrow: 'Hosted pricing',
    title: 'Hosted Agent Room pricing.',
    summary:
        'Subscriptions cover hosted operation and per-room isolation. Managed AI, web search, page reading, and live browsing draw from your included monthly usage first, then any credits you add.',
}

export const pricingPlans = hostedBillingCatalog.plans.map((plan) => ({
    key: plan.key,
    name: plan.name,
    summary: plan.summary,
    monthly: formatHostedUsd(plan.monthlyCents),
    includedUsage:
        plan.includedCents > 0
            ? `${formatHostedUsd(plan.includedCents)} of monthly usage included`
            : 'No included monthly usage',
    features: [
        'Hosted, isolated rooms',
        'Bring your own AI keys',
        plan.managedOpenRouter ? 'Managed AI models' : null,
        plan.managedBrave || plan.managedFetchUrl ? 'Web search and page reading' : null,
        plan.managedBrowserbase ? 'Live web browsing' : 'Live web browsing with your own key',
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

function includedOrOwnKey(enabled: boolean): string {
    return enabled ? 'Included' : 'Your own key'
}

export const pricingFeatureRows = [
    {
        label: 'Hosted, isolated rooms',
        values: valuesByPlan(() => 'Included'),
    },
    {
        label: 'Bring your own keys',
        values: valuesByPlan(() => 'AI, search, browsing'),
    },
    {
        label: 'Managed AI models',
        values: valuesByPlan((plan) => includedOrOwnKey(plan.managedOpenRouter)),
    },
    {
        label: 'Web search',
        values: valuesByPlan((plan) => includedOrOwnKey(plan.managedBrave)),
    },
    {
        label: 'Web page reading',
        values: valuesByPlan((plan) => includedOrOwnKey(plan.managedFetchUrl)),
    },
    {
        label: 'Live web browsing',
        values: valuesByPlan((plan) => includedOrOwnKey(plan.managedBrowserbase)),
    },
    {
        label: 'Included monthly usage',
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
        question: 'How is usage measured?',
        answer: 'Managed AI, web search, page reading, and live browsing are metered per room and billed against your included monthly usage first, then any credits you add. Anything you run with your own keys bills to your own provider account.',
    },
    {
        question: 'What is the difference between hosted and self-hosted?',
        answer: 'The source is available to self-host at no cost. Hosted Agent Room runs the isolation, runtime, and credential handling for you so your team does not operate the stack.',
    },
    {
        question: 'Which plans include live web browsing?',
        answer: 'Live web browsing is included with Pro. Starter and Standard can still use live browsing when you provide your own key.',
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
