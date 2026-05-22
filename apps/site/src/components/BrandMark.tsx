type Props = {
    size?: number
    className?: string
}

export function BrandMark({ size = 28, className }: Props) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 1024 1024"
            xmlns="http://www.w3.org/2000/svg"
            role="img"
            aria-label="Agent Room"
            className={className}
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

export function BrandWordmark({ className }: { className?: string }) {
    return (
        <span className={`inline-flex items-center gap-2.5 ${className ?? ''}`}>
            <BrandMark size={22} />
            <span className="font-sans text-[15px] font-medium tracking-tight">Agent Room</span>
        </span>
    )
}
