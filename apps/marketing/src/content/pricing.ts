import type { FaqItem, WaitlistField } from './types'

export const waitlistEmail = 'waitlist@agent-room.dev'

export const pricing = {
    eyebrow: 'Hosted waitlist',
    title: 'Join the hosted waitlist.',
    summary:
        'Hosted Agent Room is being prepared for early access. Pricing is being finalized, so there is nothing to buy yet. Join the waitlist and we will reach out as hosted spots open.',
    philosophy: {
        title: 'How billing is expected to work',
        note: 'This is direction, not a published price. Usage will depend on the models and provider paths you choose.',
        points: [
            'A subscription for hosted operation and room capacity.',
            'Model usage billed as credits or top-ups on top of the subscription.',
            'Usage depends on the models and provider paths each room uses.',
            'Self-hosting stays free from the open source repository.',
        ],
    },
    sourceNote: {
        title: 'Source stays available',
        body: 'The repository remains open source. Hosted Agent Room removes the operations work of running isolation, runtime, and credential handling yourself. You can always self-host instead.',
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
        question: 'Can I bring my own provider keys?',
        answer: 'Provider binding is explicit per room. Whether early hosted accounts bring their own keys, use pooled credits, or both is still being decided, and is one of the things we want waitlist feedback on.',
    },
    {
        question: 'What is the difference between hosted and self-hosted?',
        answer: 'The source is available to self-host at no cost. Hosted Agent Room runs the isolation, runtime, and credential handling for you so your team does not operate the stack.',
    },
    {
        question: 'Which models are supported?',
        answer: 'Rooms select a provider and model explicitly. The exact hosted model lineup will be confirmed before early access opens.',
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
