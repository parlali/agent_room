import { SectionLabel } from '../components/SectionLabel'

export function Problem() {
    return (
        <section className="relative border-t border-[var(--color-rule)] bg-[var(--color-night)] py-24 sm:py-32">
            <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-10">
                <SectionLabel>Why rooms</SectionLabel>

                <div className="mt-16 grid-12">
                    <div className="col-span-12 lg:col-span-5">
                        <h2 className="text-[38px] font-semibold leading-[1.08] sm:text-[48px] lg:text-[58px]">
                            Agents need a real workspace to be useful over time.
                        </h2>
                    </div>

                    <div className="col-span-12 lg:col-span-6 lg:col-start-7">
                        <p className="text-[16.5px] leading-[1.65] text-[var(--color-ink-dim)] sm:text-[17.5px]">
                            A chat thread is not a durable operating environment. It usually loses
                            context after the session, shares state across unrelated work, and hides
                            the runtime details that matter when credentials and files are involved.
                        </p>
                        <p className="mt-7 text-[16.5px] leading-[1.65] text-[var(--color-ink-dim)] sm:text-[17.5px]">
                            A room is a bounded workspace for one AI coworker. Its memory, files,
                            tools, jobs, provider credentials, and event log are scoped to that room
                            and stay inside the deployment you control.
                        </p>

                        <div className="mt-12 border-t border-[var(--color-rule)] pt-8">
                            <div className="grid grid-cols-2 gap-x-8 gap-y-6">
                                <Contrast
                                    label="Typical chat agent"
                                    items={[
                                        'single chat thread',
                                        'shared user memory',
                                        'provider-hosted workspace',
                                        'external credentials',
                                        'opaque tool execution',
                                        'limited audit trail',
                                    ]}
                                    tone="dim"
                                />
                                <Contrast
                                    label="Agent Room"
                                    items={[
                                        'one persistent coworker',
                                        'room-local JSON memory',
                                        'your deployment',
                                        'explicit provider binding',
                                        'inspectable tools',
                                        'full event log',
                                    ]}
                                    tone="bright"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    )
}

function Contrast({
    label,
    items,
    tone,
}: {
    label: string
    items: string[]
    tone: 'dim' | 'bright'
}) {
    return (
        <div>
            <div className="label-mono mb-4">{label}</div>
            <ul className="space-y-2.5">
                {items.map((item) => (
                    <li
                        key={item}
                        className={`flex items-start gap-2 font-mono text-[12.5px] ${
                            tone === 'bright'
                                ? 'text-[var(--color-ink)]'
                                : 'text-[var(--color-ink-faint)]'
                        }`}
                    >
                        <span
                            className={`mt-1.5 inline-block h-1.5 w-1.5 shrink-0 ${
                                tone === 'bright'
                                    ? 'bg-[var(--color-accent)]'
                                    : 'bg-[var(--color-rule-bright)]'
                            }`}
                        />
                        <span>{item}</span>
                    </li>
                ))}
            </ul>
        </div>
    )
}
