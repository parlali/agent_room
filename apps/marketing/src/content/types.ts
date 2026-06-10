export type RoutePath =
    | '/'
    | '/features'
    | '/pricing'
    | '/security'
    | '/source'
    | '/terms'
    | '/privacy'

export type NavLink = {
    label: string
    href: string
    external?: boolean
}

export type Cta = {
    label: string
    href: string
    external?: boolean
}

export type SeoMeta = {
    title: string
    description: string
    image?: string
}

export type MarketingAsset = {
    src: string
    alt: string
    width: number
    height: number
}

export type FeatureGroup = {
    id: string
    eyebrow: string
    title: string
    summary: string
}

export type SecurityPrinciple = {
    id: string
    title: string
    summary: string
}

export type SecurityLogEntry = {
    room: string
    action: string
    target: string
    allowed: boolean
}

export type FaqItem = {
    question: string
    answer: string
}

export type ComparisonTone = 'red' | 'green' | 'amber' | 'blue'

export type ComparisonColumn = {
    label: string
    tone: ComparisonTone
}

export type ComparisonRow = {
    label: string
    cells: [string, string]
}

export type Comparison = {
    columns: [ComparisonColumn, ComparisonColumn]
    rows: ComparisonRow[]
}

export type WaitlistField = {
    name: string
    label: string
    type: 'text' | 'email' | 'select' | 'textarea'
    required: boolean
    placeholder?: string
    options?: string[]
}

export type WaitlistInterest = 'Hosted' | 'Self-hosted' | 'Both'

export type WaitlistSubmission = {
    name: string
    email: string
    company: string
    useCase: string
    interest: WaitlistInterest
}

export type WaitlistFieldName = keyof WaitlistSubmission

export type WaitlistFieldErrors = Partial<Record<WaitlistFieldName, string>>

export type WaitlistSubmitSuccess = {
    ok: true
}

export type WaitlistSubmitError = {
    ok: false
    message: string
    errors?: WaitlistFieldErrors
}

export type WaitlistSubmitResponse = WaitlistSubmitSuccess | WaitlistSubmitError

export type LegalSection = {
    heading: string
    body: string[]
}

export type LegalDocument = {
    title: string
    summary: string
    updated: string
    sections: LegalSection[]
}
