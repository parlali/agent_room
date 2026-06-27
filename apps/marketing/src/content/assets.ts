import type { MarketingAsset } from './types'

export const marketingAssetBase = '/assets/marketing'

const base = marketingAssetBase

export const defaultOgImage = `${base}/og-share.png`

export const assets = {
    securityAudit: {
        src: `${base}/security-audit-runtime.png`,
        alt: 'Agent Room audit view showing per-room tool calls, run state, and usage telemetry.',
        width: 1672,
        height: 941,
    },
} satisfies Record<string, MarketingAsset>
