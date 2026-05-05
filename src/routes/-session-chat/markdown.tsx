import type { ReactNode } from 'react'

export function renderInlineMarkdown(text: string): ReactNode[] {
    const out: ReactNode[] = []
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i += 1) {
        out.push(<span key={`l${i}`}>{parseInline(lines[i]!, `l${i}`)}</span>)
        if (i < lines.length - 1) out.push(<br key={`b${i}`} />)
    }
    return out
}

function parseInline(input: string, prefix: string): ReactNode[] {
    const out: ReactNode[] = []
    const pattern = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g
    let last = 0
    let idx = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(input)) !== null) {
        if (match.index > last) {
            out.push(<span key={`${prefix}t${idx++}`}>{input.slice(last, match.index)}</span>)
        }
        if (match[2] !== undefined) out.push(<strong key={`${prefix}b${idx++}`}>{match[2]}</strong>)
        else if (match[3] !== undefined) out.push(<em key={`${prefix}i${idx++}`}>{match[3]}</em>)
        else if (match[4] !== undefined)
            out.push(
                <code
                    key={`${prefix}c${idx++}`}
                    className="rounded bg-muted/70 px-1 py-0.5 text-[0.85em]"
                >
                    {match[4]}
                </code>,
            )
        last = match.index + match[0].length
    }
    if (last < input.length) out.push(<span key={`${prefix}r${idx}`}>{input.slice(last)}</span>)
    if (out.length === 0) out.push(<span key={`${prefix}e`}>{input}</span>)
    return out
}
