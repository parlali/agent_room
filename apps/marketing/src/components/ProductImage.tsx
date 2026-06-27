import type { MarketingAsset } from '~/content/types'

export function ProductImage({
    asset,
    className = '',
}: {
    asset: MarketingAsset
    className?: string
}) {
    return (
        <figure
            className={`relative overflow-hidden rounded-[var(--radius-media)] border border-line ${className}`}
        >
            <img
                src={asset.src}
                alt={asset.alt}
                width={asset.width}
                height={asset.height}
                loading="lazy"
                decoding="async"
                className="block h-auto w-full"
            />
        </figure>
    )
}
