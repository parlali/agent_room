import type { SVGProps } from 'react'

import brandTokensJson from '../brand.tokens.json'

export const brandTokens = brandTokensJson

export type BrandMarkProps = SVGProps<SVGSVGElement> & {
    size?: number
    title?: string
}

export function BrandMark({ size = 24, title = 'Agent Room mark', ...props }: BrandMarkProps) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 1024 1024"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            role="img"
            aria-label={title}
            {...props}
        >
            <path
                d="M315 792V356L512 232L709 356V792H575M575 792H439V479H575"
                fill="none"
                stroke="currentColor"
                strokeWidth={72}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    )
}

export function BrandWordmark({
    className,
    showMark = true,
}: {
    className?: string
    showMark?: boolean
}) {
    const rootClassName = ['inline-flex items-center gap-2 text-current', className]
        .filter(Boolean)
        .join(' ')

    return (
        <span className={rootClassName}>
            {showMark ? <BrandMark size={22} /> : null}
            <span className="text-base font-semibold tracking-tight">Agent Room</span>
        </span>
    )
}
