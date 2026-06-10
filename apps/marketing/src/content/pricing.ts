import type { FaqItem, WaitlistField } from './types'

export const pricing = {
    eyebrow: 'Hosted waitlist',
    title: 'Join the hosted waitlist.',
    summary:
        'Hosted Agent Room is being prepared for early access. There is nothing to buy yet. Join the waitlist and we will reach out as spots open.',
    philosophy: {
        title: 'How billing is expected to work',
        note: 'This is direction, not a published price. Usage will depend on the models each room uses.',
        points: [
            'A subscription covers hosted operation and room capacity.',
            'Model usage is billed as credits on top.',
            'Each room costs are visible, so you always know which job spent what.',
            'No charges until early access pricing is published and you opt in.',
        ],
    },
}

export const pricingFaq: FaqItem[] = [
    {
        question: 'How much does hosted Agent Room cost?',
        answer: 'Pricing is being finalized and is not published yet. Join the waitlist and we will share details with early access.',
    },
    {
        question: 'How will usage be measured?',
        answer: 'Usage will depend on the models and provider paths each room uses. The expected shape is a subscription plus model credits or top-ups.',
    },
    {
        question: 'What is the difference between hosted and self-hosted?',
        answer: 'The source is available to self-host at no cost. Hosted Agent Room runs the isolation, runtime, and credential handling for you so your team does not operate the stack.',
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
