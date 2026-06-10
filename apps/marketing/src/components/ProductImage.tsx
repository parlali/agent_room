import type { MarketingAsset } from '~/content/types'

export function ProductImage({
    asset,
    mobileAsset,
    priority = false,
    className = '',
}: {
    asset: MarketingAsset
    mobileAsset?: MarketingAsset
    priority?: boolean
    className?: string
}) {
    return (
        <figure
            className={`relative overflow-hidden rounded-[var(--radius-media)] border border-line ${className}`}
        >
            {mobileAsset ? (
                <picture>
                    <source media="(max-width: 640px)" srcSet={mobileAsset.src} />
                    <img
                        src={asset.src}
                        alt={asset.alt}
                        width={asset.width}
                        height={asset.height}
                        loading={priority ? 'eager' : 'lazy'}
                        decoding="async"
                        className="block h-auto w-full"
                    />
                </picture>
            ) : (
                <img
                    src={asset.src}
                    alt={asset.alt}
                    width={asset.width}
                    height={asset.height}
                    loading={priority ? 'eager' : 'lazy'}
                    decoding="async"
                    className="block h-auto w-full"
                />
            )}
        </figure>
    )
}
