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
}

export type MarketingAsset = {
    src: string
    alt: string
    width: number
    height: number
}

export type Capability = {
    name: string
    detail: string
}

export type FeatureGroup = {
    id: string
    eyebrow: string
    title: string
    summary: string
    points: string[]
}

export type SecurityPrinciple = {
    id: string
    title: string
    summary: string
    points: string[]
}

export type FaqItem = {
    question: string
    answer: string
}

export type WaitlistField = {
    name: string
    label: string
    type: 'text' | 'email' | 'select' | 'textarea'
    required: boolean
    placeholder?: string
    options?: string[]
}

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
