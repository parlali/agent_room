import type { MarketingAsset } from './types'

export const marketingAssetBase = '/assets/marketing'

const base = marketingAssetBase

export const defaultOgImage = `${base}/og-share.png`

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
    capabilitiesDashboard: {
        src: `${base}/capabilities-artifacts-dashboard.png`,
        alt: 'Agent Room dashboard showing room capabilities and generated artifacts.',
        width: 1672,
        height: 941,
    },
    securityAudit: {
        src: `${base}/security-audit-runtime.png`,
        alt: 'Agent Room audit view showing per-room tool calls, run state, and usage telemetry.',
        width: 1672,
        height: 941,
    },
} satisfies Record<string, MarketingAsset>
