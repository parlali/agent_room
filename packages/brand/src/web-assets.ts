export type BrandWebTarget = 'marketing' | 'self-hosted'

export type BrandWebManifestIcon = {
    src: string
    sizes: string
    type: string
    purpose?: 'maskable'
}

export type BrandWebManifest = {
    name: string
    short_name: string
    description?: string
    icons: BrandWebManifestIcon[]
    start_url?: string
    scope?: string
    display: 'browser' | 'fullscreen' | 'minimal-ui' | 'standalone'
    theme_color: string
    background_color: string
}

export const brandWebAssetCatalog = {
    faviconSvg: {
        sourcePath: 'exports/favicon/favicon.svg',
        fileName: 'favicon.svg',
    },
    faviconIco: {
        sourcePath: 'exports/favicon/favicon.ico',
        fileName: 'favicon.ico',
    },
    appleTouchIcon: {
        sourcePath: 'exports/web/apple-touch-icon.png',
        fileName: 'apple-touch-icon.png',
    },
    androidChrome192: {
        sourcePath: 'exports/web/android-chrome-192x192.png',
        fileName: 'android-chrome-192x192.png',
    },
    androidChrome512: {
        sourcePath: 'exports/web/android-chrome-512x512.png',
        fileName: 'android-chrome-512x512.png',
    },
    maskableIcon192: {
        sourcePath: 'exports/web/maskable-icon-192x192.png',
        fileName: 'maskable-icon-192x192.png',
    },
    maskableIcon512: {
        sourcePath: 'exports/web/maskable-icon-512x512.png',
        fileName: 'maskable-icon-512x512.png',
    },
} as const

export type BrandWebAssetKey = keyof typeof brandWebAssetCatalog

type BrandWebTargetConfig = {
    assets: readonly BrandWebAssetKey[]
    marketingAssets?: readonly MarketingAssetKey[]
    manifest: BrandWebManifest | null
    robotsTxt: string | null
}

const selfHostedWebManifest: BrandWebManifest = {
    name: 'Agent Room',
    short_name: 'Agent Room',
    description: 'A self-hosted control room for persistent AI coworkers.',
    icons: [
        {
            src: brandWebAssetCatalog.androidChrome192.fileName,
            sizes: '192x192',
            type: 'image/png',
        },
        {
            src: brandWebAssetCatalog.androidChrome512.fileName,
            sizes: '512x512',
            type: 'image/png',
        },
        {
            src: brandWebAssetCatalog.maskableIcon192.fileName,
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
        },
        {
            src: brandWebAssetCatalog.maskableIcon512.fileName,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
        },
    ],
    start_url: '/',
    scope: '/',
    display: 'standalone',
    theme_color: '#faf9f4',
    background_color: '#faf9f4',
}

export const marketingAssetCatalog = {
    ogShare: {
        sourcePath: 'exports/marketing/og-share.png',
        fileName: 'assets/marketing/og-share.png',
    },
} as const

export type MarketingAssetKey = keyof typeof marketingAssetCatalog

export const brandWebTargets = {
    marketing: {
        assets: ['faviconSvg', 'faviconIco', 'appleTouchIcon'],
        marketingAssets: Object.keys(marketingAssetCatalog) as MarketingAssetKey[],
        manifest: null,
        robotsTxt: 'User-agent: *\nAllow: /\n',
    },
    'self-hosted': {
        assets: [
            'faviconSvg',
            'faviconIco',
            'appleTouchIcon',
            'androidChrome192',
            'androidChrome512',
            'maskableIcon192',
            'maskableIcon512',
        ],
        marketingAssets: [],
        manifest: selfHostedWebManifest,
        robotsTxt: 'User-agent: *\nDisallow:\n',
    },
} satisfies Record<BrandWebTarget, BrandWebTargetConfig>

export function formatWebManifest(manifest: BrandWebManifest): string {
    return `${JSON.stringify(manifest, null, 4)}\n`
}
