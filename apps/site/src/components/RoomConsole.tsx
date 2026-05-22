import { useEffect, useState } from 'react'

type Event = {
    ts: string
    kind: 'mem' | 'tool' | 'file' | 'job' | 'web' | 'msg'
    text: string
}

const script: Event[] = [
    { ts: '14:02:01', kind: 'msg', text: 'session.open · operator → studio-3' },
    { ts: '14:02:02', kind: 'mem', text: 'memory.read · 3 standing facts loaded' },
    { ts: '14:02:04', kind: 'web', text: 'web.search · "lithium spot price may 2026"' },
    { ts: '14:02:06', kind: 'web', text: 'web.fetch · reuters.com · 38KB' },
    { ts: '14:02:09', kind: 'file', text: 'file.write · /reports/may-pricing.md · 4.2KB' },
    { ts: '14:02:11', kind: 'tool', text: 'docx.compose · briefing.docx · 12 pages' },
    { ts: '14:02:13', kind: 'file', text: 'file.write · /out/briefing.docx · 81KB' },
    { ts: '14:02:14', kind: 'mem', text: 'memory.write · new decision · "stick with Q3 vendor"' },
    { ts: '14:02:16', kind: 'job', text: 'job.schedule · daily-report · 09:00 PT' },
    { ts: '14:02:17', kind: 'msg', text: 'session.idle · awaiting operator' },
]

const kindLabel: Record<Event['kind'], string> = {
    msg: 'SESSION',
    mem: 'MEMORY',
    tool: 'TOOL',
    file: 'FILE',
    job: 'JOB',
    web: 'WEB',
}

const kindColor: Record<Event['kind'], string> = {
    msg: 'text-[var(--color-ink-dim)]',
    mem: 'text-[var(--color-quote)]',
    tool: 'text-[var(--color-accent)]',
    file: 'text-[var(--color-ink)]',
    job: 'text-[var(--color-attention)]',
    web: 'text-[#9bbfe6]',
}

export function RoomConsole() {
    const [visible, setVisible] = useState<Event[]>([])
    useEffect(() => {
        let i = 0
        const tick = () => {
            setVisible((prev) => {
                const next = [...prev, script[i % script.length]]
                return next.slice(-8)
            })
            i++
        }
        tick()
        const id = setInterval(tick, 1700)
        return () => clearInterval(id)
    }, [])

    return (
        <div className="relative overflow-hidden border border-[var(--color-rule)] bg-[var(--color-night-elev)]">
            <div className="scan-line" />
            <div className="flex items-center justify-between border-b border-[var(--color-rule)] px-4 py-2.5">
                <div className="flex items-center gap-2.5">
                    <span className="relative inline-flex h-1.5 w-1.5">
                        <span className="absolute inset-0 rounded-full bg-[var(--color-accent)] animate-pulse-soft" />
                    </span>
                    <span className="label-mono text-[var(--color-ink)]">ROOM · studio-3</span>
                </div>
                <span className="label-mono">ONLINE · 12d 04h</span>
            </div>

            <div className="grid grid-cols-2 gap-px bg-[var(--color-rule)]">
                <Panel
                    label="MEMORY"
                    primary="14 facts"
                    secondary="last write 04m ago"
                    hint="render brief · 1.8KB / 4KB"
                />
                <Panel
                    label="FILES"
                    primary="138 files"
                    secondary="42.6 MB · in /room"
                    hint="2 just written"
                />
                <Panel label="JOBS" primary="3 active" secondary="next 09:00 PT" hint="daily-report · weekly-recap" />
                <Panel label="PROVIDER" primary="codex / oai" secondary="oauth bound" hint="ratelimit ok" />
            </div>

            <div className="border-t border-[var(--color-rule)] px-4 py-2.5">
                <div className="flex items-center justify-between">
                    <span className="label-mono text-[var(--color-ink)]">EVENT LOG</span>
                    <span className="label-mono">live · idempotent · audit</span>
                </div>
            </div>

            <div className="h-[220px] overflow-hidden px-4 py-2 font-mono text-[11.5px] leading-[1.65]">
                {visible.map((e, idx) => (
                    <div
                        key={`${e.ts}-${idx}`}
                        className="flex gap-3 opacity-0"
                        style={{ animation: 'reveal-up 320ms ease forwards' }}
                    >
                        <span className="w-[58px] shrink-0 text-[var(--color-ink-faint)]">{e.ts}</span>
                        <span className={`w-[58px] shrink-0 text-[10px] tracking-wider ${kindColor[e.kind]}`}>
                            {kindLabel[e.kind]}
                        </span>
                        <span className="truncate text-[var(--color-ink-dim)]">{e.text}</span>
                    </div>
                ))}
            </div>

            <div className="flex items-center justify-between border-t border-[var(--color-rule)] px-4 py-2.5">
                <div className="flex items-center gap-3">
                    <span className="label-mono">USAGE TODAY</span>
                    <span className="font-mono text-[11px] text-[var(--color-ink)]">42,318 tok</span>
                    <span className="font-mono text-[11px] text-[var(--color-ink-dim)]">$0.47</span>
                </div>
                <div className="flex items-end gap-0.5">
                    {[0.4, 0.7, 0.5, 0.9, 0.6, 0.95, 0.7, 0.5, 0.8, 0.6, 0.45, 0.7].map((h, i) => (
                        <span
                            key={i}
                            className="block w-1 bg-[var(--color-accent)] opacity-80"
                            style={{
                                height: `${h * 18}px`,
                                animation: `wave 1.6s ease-in-out ${i * 90}ms infinite`,
                                transformOrigin: 'bottom',
                            }}
                        />
                    ))}
                </div>
            </div>
        </div>
    )
}

type PanelProps = {
    label: string
    primary: string
    secondary: string
    hint: string
}

function Panel({ label, primary, secondary, hint }: PanelProps) {
    return (
        <div className="bg-[var(--color-night-elev)] px-4 py-3">
            <div className="label-mono">{label}</div>
            <div className="mt-1.5 font-serif text-[22px] leading-none text-[var(--color-ink)]">{primary}</div>
            <div className="mt-1.5 font-mono text-[10.5px] text-[var(--color-ink-dim)]">{secondary}</div>
            <div className="mt-0.5 font-mono text-[10.5px] text-[var(--color-ink-faint)]">{hint}</div>
        </div>
    )
}
