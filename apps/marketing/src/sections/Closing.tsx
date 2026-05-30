import { TextLink } from '../components/TextLink'

export function Closing() {
    return (
        <section className="relative border-t border-[var(--color-rule)] bg-[var(--color-night)] py-24 sm:py-32 lg:py-36">
            <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-10">
                <div className="grid-12">
                    <div className="col-span-12">
                        <div className="flex items-center gap-3">
                            <span className="label-mono">Get started</span>
                            <span className="h-px flex-1 bg-[var(--color-rule)]" />
                        </div>
                    </div>
                </div>

                <div className="mt-16 grid-12">
                    <div className="col-span-12 lg:col-span-8">
                        <h2 className="text-[42px] font-semibold leading-[1.08] sm:text-[58px] lg:text-[72px]">
                            Run Agent Room on your machine.
                        </h2>
                        <p className="mt-6 max-w-2xl text-[16px] leading-[1.6] text-[var(--color-ink-dim)]">
                            Start with the self-hosted stack, inspect the runtime state directly,
                            and add hosted or enterprise support when your deployment needs it.
                        </p>

                        <div className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-5">
                            <TextLink
                                href="https://github.com/parlali/agent_room"
                                external
                                className="cta-fill px-6 py-3.5 text-[14px] font-medium"
                            >
                                Run the stack
                            </TextLink>
                            <TextLink
                                href="#pricing"
                                className="inline-flex items-center gap-3 px-1 text-[14px] text-[var(--color-ink)] underline decoration-[var(--color-ink-faint)] decoration-1 underline-offset-[6px] transition hover:decoration-[var(--color-accent)]"
                            >
                                View pricing
                            </TextLink>
                            <TextLink
                                href="mailto:hello@openagentroom.com"
                                className="inline-flex items-center gap-3 px-1 text-[14px] text-[var(--color-ink-dim)] transition hover:text-[var(--color-ink)]"
                            >
                                hello@openagentroom.com
                            </TextLink>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    )
}
