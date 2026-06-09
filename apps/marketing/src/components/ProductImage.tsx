import type { MarketingAsset } from '~/content/types'

export function ProductImage({
    asset,
    mobileAsset,
    label,
    priority = false,
    className = '',
}: {
    asset: MarketingAsset
    mobileAsset?: MarketingAsset
    label?: string
    priority?: boolean
    className?: string
}) {
    return (
        <figure
            className={`overflow-hidden rounded-[10px] border border-line bg-panel shadow-[var(--shadow-panel)] ${className}`}
        >
            <div className="flex items-center gap-2 border-b border-line bg-paper-sunken px-3 py-2">
                <span className="h-2 w-2 rounded-full bg-line-strong" aria-hidden />
                <span className="h-2 w-2 rounded-full bg-line-strong" aria-hidden />
                <span className="h-2 w-2 rounded-full bg-line-strong" aria-hidden />
                {label ? (
                    <span className="ml-2 truncate font-mono text-[0.6875rem] text-ink-faint">
                        {label}
                    </span>
                ) : null}
            </div>
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
