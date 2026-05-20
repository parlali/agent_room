import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import { Link } from '@tanstack/react-router'
import remend from 'remend'
import remarkGfm from 'remark-gfm'

import { cn } from '#/lib/utils'

export function renderMarkdown(
    text: string,
    options?: {
        streaming?: boolean
        complete?: boolean
    },
): ReactNode {
    if (!text) return null
    const markdown = options?.streaming && !options.complete ? remend(text) : text
    return (
        <div className="space-y-3 text-sm leading-6 break-words">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={markdownComponents}
                skipHtml
                unwrapDisallowed
            >
                {markdown}
            </ReactMarkdown>
        </div>
    )
}

const markdownComponents = {
    p({ children }: ComponentPropsWithoutRef<'p'>) {
        return <p className="my-0">{children}</p>
    },
    h1({ children }: ComponentPropsWithoutRef<'h1'>) {
        return (
            <h1 className="my-0 text-lg font-semibold leading-tight text-foreground">{children}</h1>
        )
    },
    h2({ children }: ComponentPropsWithoutRef<'h2'>) {
        return (
            <h2 className="my-0 text-base font-semibold leading-tight text-foreground">
                {children}
            </h2>
        )
    },
    h3({ children }: ComponentPropsWithoutRef<'h3'>) {
        return (
            <h3 className="my-0 text-sm font-semibold leading-tight text-foreground">{children}</h3>
        )
    },
    strong({ children }: ComponentPropsWithoutRef<'strong'>) {
        return <strong>{children}</strong>
    },
    em({ children }: ComponentPropsWithoutRef<'em'>) {
        return <em>{children}</em>
    },
    del({ children }: ComponentPropsWithoutRef<'del'>) {
        return <del>{children}</del>
    },
    code({ children, className }: ComponentPropsWithoutRef<'code'>) {
        const inline = !className
        if (inline) {
            return <code className="rounded bg-muted/70 px-1 py-0.5 text-[0.85em]">{children}</code>
        }
        return <code>{children}</code>
    },
    pre({ children }: ComponentPropsWithoutRef<'pre'>) {
        return (
            <pre className="max-h-96 overflow-auto rounded-md bg-muted/70 px-3 py-2 text-xs leading-5">
                {children}
            </pre>
        )
    },
    blockquote({ children }: ComponentPropsWithoutRef<'blockquote'>) {
        return (
            <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">
                {children}
            </blockquote>
        )
    },
    ul({ children }: ComponentPropsWithoutRef<'ul'>) {
        return <ul className="my-0 list-disc space-y-1 pl-5">{children}</ul>
    },
    ol({ children }: ComponentPropsWithoutRef<'ol'>) {
        return <ol className="my-0 list-decimal space-y-1 pl-5">{children}</ol>
    },
    li({ children, className }: ComponentPropsWithoutRef<'li'>) {
        return <li className={cn('pl-1', className)}>{children}</li>
    },
    a({ children, href, title }: ComponentPropsWithoutRef<'a'>) {
        const targetHref = typeof href === 'string' ? href : ''
        if (isAppRouteHref(targetHref)) {
            return (
                <Link
                    to={targetHref}
                    title={title}
                    className="font-medium text-primary underline underline-offset-3"
                >
                    {children}
                </Link>
            )
        }
        return (
            <a
                href={targetHref}
                title={title}
                target={isExternalHref(targetHref) ? '_blank' : undefined}
                rel={isExternalHref(targetHref) ? 'noreferrer' : undefined}
                className="font-medium text-primary underline underline-offset-3"
            >
                {children}
            </a>
        )
    },
    table({ children }: ComponentPropsWithoutRef<'table'>) {
        return (
            <div className="overflow-x-auto">
                <table className="w-full min-w-80 border-collapse text-left text-xs">
                    {children}
                </table>
            </div>
        )
    },
    thead({ children }: ComponentPropsWithoutRef<'thead'>) {
        return <thead className="bg-muted/60">{children}</thead>
    },
    th({ children }: ComponentPropsWithoutRef<'th'>) {
        return <th className="border border-border px-2 py-1 font-medium">{children}</th>
    },
    td({ children }: ComponentPropsWithoutRef<'td'>) {
        return <td className="border border-border px-2 py-1 align-top">{children}</td>
    },
    hr() {
        return <hr className="border-border" />
    },
}

function isExternalHref(href: string): boolean {
    return /^https?:\/\//i.test(href)
}

function isAppRouteHref(href: string): boolean {
    if (!href.startsWith('/') || href.startsWith('//')) return false
    const pathname = href.split(/[?#]/, 1)[0] ?? ''
    if (pathname === '/') return true
    if (pathname.startsWith('/api/') || pathname.startsWith('/assets/')) return false
    if (pathname.startsWith('/_serverFn/')) return false
    return (
        pathname === '/about' ||
        pathname === '/activity' ||
        pathname === '/files' ||
        pathname === '/jobs' ||
        pathname === '/login' ||
        pathname === '/onboarding' ||
        pathname === '/settings' ||
        pathname === '/usage' ||
        pathname.startsWith('/github/app/callback') ||
        pathname.startsWith('/rooms/')
    )
}
