import type { MarketingAsset } from './types'

const base = '/assets/marketing'

export const assets = {
    heroDesktop: {
        src: `${base}/hero-desktop-room-console.png`,
        alt: 'Agent Room console showing a room list, an active session, generated artifacts, usage meters, and run status.',
        width: 1672,
        height: 941,
    },
    heroMobile: {
        src: `${base}/hero-mobile-room-console.png`,
        alt: 'Agent Room mobile room interface showing a single room with its session, files, and status.',
        width: 941,
        height: 1672,
    },
    roomIsolation: {
        src: `${base}/room-isolation-diagram.png`,
        alt: 'Four separate room modules, each with its own isolated memory, files, tools, schedules, and credentials.',
        width: 1672,
        height: 941,
    },
    capabilities: {
        src: `${base}/capabilities-artifacts-dashboard.png`,
        alt: 'Capability dashboard showing tools, generated artifacts, scheduled jobs, and an activity and audit feed.',
        width: 1672,
        height: 941,
    },
    securityRuntime: {
        src: `${base}/security-audit-runtime.png`,
        alt: 'Security and audit view showing credential boundaries, provider binding, and runtime traceability.',
        width: 1672,
        height: 941,
    },
    pricingWaitlist: {
        src: `${base}/pricing-waitlist-credits.png`,
        alt: 'Waitlist and usage visual showing credit meters and top-up style controls.',
        width: 1536,
        height: 1024,
    },
} satisfies Record<string, MarketingAsset>
