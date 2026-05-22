import { SectionLabel } from '../components/SectionLabel'

export function Problem() {
    return (
        <section className="relative border-t border-[var(--color-rule)] bg-[var(--color-night)] py-24 sm:py-32">
            <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-10">
                <SectionLabel index="01">THE CASE FOR A ROOM</SectionLabel>

                <div className="mt-16 grid-12">
                    <div className="col-span-12 lg:col-span-5">
                        <h2
                            className="font-serif text-[44px] leading-[1.04] tracking-[-0.025em] sm:text-[56px] lg:text-[68px]"
                            style={{ fontVariationSettings: "'opsz' 144, 'SOFT' 50" }}
                        >
                            Most agents are{' '}
                            <em
                                className="font-serif-italic text-[var(--color-quote)]"
                                style={{ fontStyle: 'italic' }}
                            >
                                forgetful
                            </em>{' '}
                            chat windows wearing a costume.
                        </h2>
                    </div>

                    <div className="col-span-12 lg:col-span-6 lg:col-start-7">
                        <p className="text-[16.5px] leading-[1.65] text-[var(--color-ink-dim)] sm:text-[17.5px]">
                            They live for one session. They forget you the moment the tab closes. They share memory
                            with every other thread the same user opens. They run inside someone else&rsquo;s cloud,
                            with credentials, files, and prompts mingled across customers.
                        </p>
                        <p className="mt-7 text-[16.5px] leading-[1.65] text-[var(--color-ink-dim)] sm:text-[17.5px]">
                            A room is the opposite shape. It is one coworker, in one bounded workspace, on your
                            machine. Files stay in the room. Memory belongs to the room. Jobs run inside the room.
                            Provider keys never leave the room. The audit trail is yours.
                        </p>

                        <div className="mt-12 border-t border-[var(--color-rule)] pt-8">
                            <div className="grid grid-cols-2 gap-x-8 gap-y-6">
                                <Contrast
                                    label="OTHER AGENTS"
                                    items={[
                                        'a chat thread',
                                        'global memory',
                                        'their cloud',
                                        'their credentials',
                                        'opaque tools',
                                        'no audit',
                                    ]}
                                    tone="dim"
                                />
                                <Contrast
                                    label="AN AGENT ROOM"
                                    items={[
                                        'a coworker',
                                        'room-local JSON memory',
                                        'your hardware',
                                        'your provider binding',
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

function Contrast({ label, items, tone }: { label: string; items: string[]; tone: 'dim' | 'bright' }) {
    return (
        <div>
            <div className="label-mono mb-4">{label}</div>
            <ul className="space-y-2.5">
                {items.map((item) => (
                    <li
                        key={item}
                        className={`flex items-start gap-2 font-mono text-[12.5px] tracking-tight ${
                            tone === 'bright' ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink-faint)]'
                        }`}
                    >
                        <span
                            className={`mt-1.5 inline-block h-1.5 w-1.5 shrink-0 ${
                                tone === 'bright' ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-rule-bright)]'
                            }`}
                        />
                        <span>{item}</span>
                    </li>
                ))}
            </ul>
        </div>
    )
}
