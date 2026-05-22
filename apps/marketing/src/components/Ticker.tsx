import { useEffect, useState } from 'react'

const items = [
    'OPENAGENTROOM.COM',
    'v0.9 · ALPHA',
    'OSS · MIT LICENSE',
    'CLOSED ALPHA · SELF-HOSTED ONLY',
    'SINGLE DOCKER COMMAND',
    'ROOM-LOCAL MEMORY · FILES · JOBS',
    'RUNTIME · PI KERNEL · MCP',
]

export function Ticker() {
    const [now, setNow] = useState<string>(() => formatNow())
    useEffect(() => {
        const id = setInterval(() => setNow(formatNow()), 1000)
        return () => clearInterval(id)
    }, [])

    return (
        <div className="flex items-center justify-between gap-6 border-b border-[var(--color-rule)] bg-[var(--color-night)] px-4 py-2 sm:px-6 lg:px-10">
            <div className="flex items-center gap-3">
                <span className="relative inline-flex h-1.5 w-1.5">
                    <span className="absolute inset-0 rounded-full bg-[var(--color-accent)] animate-pulse-soft" />
                    <span className="absolute inset-0 rounded-full bg-[var(--color-accent)] opacity-60" />
                </span>
                <span className="label-mono text-[var(--color-ink)]">LIVE</span>
                <span className="label-mono">CHANNEL OPEN</span>
            </div>
            <div className="hidden flex-1 overflow-hidden md:block">
                <div
                    className="flex w-[200%] gap-10"
                    style={{ animation: 'ticker 60s linear infinite' }}
                >
                    {[...items, ...items, ...items, ...items].map((item, i) => (
                        <span
                            key={i}
                            className="label-mono whitespace-nowrap text-[var(--color-ink-dim)]"
                        >
                            {item}
                            <span className="ml-10 text-[var(--color-ink-faint)]">/</span>
                        </span>
                    ))}
                </div>
            </div>
            <div className="flex items-center gap-3">
                <span className="label-mono">UTC</span>
                <span className="font-mono text-[11px] tracking-wider text-[var(--color-ink)]">
                    {now}
                </span>
            </div>
        </div>
    )
}

function formatNow() {
    const d = new Date()
    const h = String(d.getUTCHours()).padStart(2, '0')
    const m = String(d.getUTCMinutes()).padStart(2, '0')
    const s = String(d.getUTCSeconds()).padStart(2, '0')
    return `${h}:${m}:${s}`
}
