import type { FaqItem } from '~/content/types'

export function Faq({ items }: { items: FaqItem[] }) {
    return (
        <div className="divide-y divide-line overflow-hidden rounded-[10px] border border-line bg-panel">
            {items.map((item) => (
                <details key={item.question} className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-medium text-ink marker:hidden">
                        {item.question}
                        <span
                            className="font-mono text-ink-faint transition-transform group-open:rotate-45"
                            aria-hidden
                        >
                            +
                        </span>
                    </summary>
                    <p className="px-5 pb-5 text-sm leading-relaxed text-ink-soft">{item.answer}</p>
                </details>
            ))}
        </div>
    )
}
