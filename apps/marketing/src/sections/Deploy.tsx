import { SectionLabel } from '../components/SectionLabel'

export function Deploy() {
    return (
        <section className="relative border-t border-[var(--color-rule)] bg-[var(--color-night)] py-24 sm:py-32">
            <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-10">
                <SectionLabel>Deploy</SectionLabel>

                <div className="mt-12 grid-12">
                    <div className="col-span-12 lg:col-span-5">
                        <h2 className="text-[36px] font-semibold leading-[1.1] sm:text-[48px] lg:text-[56px]">
                            Run the stack on your own hardware.
                        </h2>
                        <p className="mt-8 max-w-md text-[15.5px] leading-[1.6] text-[var(--color-ink-dim)]">
                            The whole stack is one Docker Compose file. App, Postgres, internal
                            SearXNG. Generated credentials on first boot. Encrypted secret storage.
                            Local-first by default.
                        </p>

                        <div className="mt-10 space-y-1.5">
                            <Step
                                n="01"
                                title="Clone"
                                hint="MIT license, no telemetry"
                                code="git clone github.com/parlali/agent_room"
                            />
                            <Step
                                n="02"
                                title="Boot"
                                hint="starts app, Postgres, and SearXNG"
                                code="docker compose up -d --build"
                            />
                            <Step
                                n="03"
                                title="Recover root"
                                hint="generated on first boot, never shipped"
                                code="docker compose exec app cat /app/.agent-room/system/bootstrap.json"
                            />
                            <Step
                                n="04"
                                title="Open"
                                hint="binds to 127.0.0.1, put a reverse proxy in front for LAN/WAN"
                                code="http://localhost:3000"
                            />
                        </div>
                    </div>

                    <div className="col-span-12 mt-16 lg:col-span-7 lg:mt-0">
                        <div className="border border-[var(--color-rule)] bg-[var(--color-night-elev)]">
                            <div className="flex items-center justify-between border-b border-[var(--color-rule)] px-4 py-2.5">
                                <span className="label-mono text-[var(--color-ink)]">
                                    Compose topology
                                </span>
                                <span className="label-mono">Local-first default</span>
                            </div>
                            <pre className="overflow-x-auto whitespace-pre p-5 font-mono text-[10.5px] leading-[1.6] text-[var(--color-ink-dim)]">{`host
  127.0.0.1:3000 -> app
                    |-- pi runtime per room
                    |   |-- workspace /room/...
                    |   |-- memory.json
                    |   |-- jobs queue
                    |   +-- mcp clients
                    |-- postgres private
                    |   |-- accounts, sessions
                    |   |-- rooms, runs, audit
                    |   +-- encrypted secrets
                    +-- searxng private
                        +-- private search backend

volumes: agent-room-data, postgres-data, searxng-config`}</pre>
                        </div>

                        <div className="mt-6 grid grid-cols-2 gap-px bg-[var(--color-rule)]">
                            <Spec
                                label="DEFAULT BIND"
                                value="127.0.0.1:3000"
                                hint="local-first by design"
                            />
                            <Spec
                                label="POSTGRES"
                                value="not published"
                                hint="lives on the docker network"
                            />
                            <Spec
                                label="SEARXNG"
                                value="not published"
                                hint="internal, no shared key"
                            />
                            <Spec
                                label="SECRETS"
                                value="encrypted at rest"
                                hint="aes-gcm, per-deployment key"
                            />
                            <Spec
                                label="BOOTSTRAP"
                                value="first-boot"
                                hint="root creds generated, recoverable"
                            />
                            <Spec
                                label="UPDATES"
                                value="git pull, rebuild"
                                hint="migrations run automatically"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </section>
    )
}

function Step({ n, title, hint, code }: { n: string; title: string; hint: string; code: string }) {
    return (
        <div className="grid grid-cols-[36px_1fr] gap-4 border-t border-[var(--color-rule)] py-4">
            <span className="label-mono pt-1 text-[var(--color-ink-faint)]">{n}</span>
            <div>
                <div className="flex items-baseline justify-between gap-3">
                    <div className="text-[20px] font-semibold text-[var(--color-ink)]">{title}</div>
                    <div className="label-mono text-right text-[var(--color-ink-faint)]">
                        {hint}
                    </div>
                </div>
                <code className="mt-2 block border-l-2 border-[var(--color-accent)] bg-[var(--color-night-elev)] px-3 py-2 font-mono text-[12.5px] text-[var(--color-accent)]">
                    {code}
                </code>
            </div>
        </div>
    )
}

function Spec({ label, value, hint }: { label: string; value: string; hint: string }) {
    return (
        <div className="bg-[var(--color-night)] p-4">
            <div className="label-mono">{label}</div>
            <div className="mt-1.5 text-[18px] font-semibold text-[var(--color-ink)]">{value}</div>
            <div className="mt-1 font-mono text-[10.5px] text-[var(--color-ink-faint)]">{hint}</div>
        </div>
    )
}
