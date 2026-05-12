import type { ReactNode } from 'react'
import { parseMarkdown, StreamingMarkdownRenderer } from 'chat'
import { Link } from '@tanstack/react-router'

import { cn } from '#/lib/utils'

interface MarkdownNode {
    type: string
    value?: string
    children?: MarkdownNode[]
    url?: string
    title?: string | null
    lang?: string | null
    ordered?: boolean | null
    checked?: boolean | null
    depth?: number
}

export function renderMarkdown(
    text: string,
    options?: {
        streaming?: boolean
        complete?: boolean
    },
): ReactNode {
    if (!text) return null
    const markdown = options?.streaming ? streamingMarkdownText(text, options.complete) : text
    const ast = parseMarkdown(markdown) as MarkdownNode
    return (
        <div className="space-y-3 text-sm leading-6 break-words">
            {renderChildren(ast.children ?? [], 'root')}
        </div>
    )
}

function streamingMarkdownText(text: string, complete = false): string {
    const renderer = new StreamingMarkdownRenderer()
    renderer.push(text)
    return complete ? renderer.finish() : renderer.render()
}

function renderChildren(children: MarkdownNode[], keyPrefix: string): ReactNode[] {
    return children.map((child, index) => renderNode(child, `${keyPrefix}-${index}`))
}

function renderInlineChildren(children: MarkdownNode[] | undefined, keyPrefix: string): ReactNode {
    return renderChildren(children ?? [], keyPrefix)
}

function renderNode(node: MarkdownNode, key: string): ReactNode {
    switch (node.type) {
        case 'root':
            return <div key={key}>{renderChildren(node.children ?? [], key)}</div>
        case 'paragraph':
            return (
                <p key={key} className="my-0">
                    {renderInlineChildren(node.children, key)}
                </p>
            )
        case 'heading':
            return renderHeading(node, key)
        case 'text':
            return node.value ?? ''
        case 'strong':
            return <strong key={key}>{renderInlineChildren(node.children, key)}</strong>
        case 'emphasis':
            return <em key={key}>{renderInlineChildren(node.children, key)}</em>
        case 'delete':
            return <del key={key}>{renderInlineChildren(node.children, key)}</del>
        case 'inlineCode':
            return (
                <code key={key} className="rounded bg-muted/70 px-1 py-0.5 text-[0.85em]">
                    {node.value ?? ''}
                </code>
            )
        case 'code':
            return (
                <pre
                    key={key}
                    className="max-h-96 overflow-auto rounded-md bg-muted/70 px-3 py-2 text-xs leading-5"
                >
                    <code>{node.value ?? ''}</code>
                </pre>
            )
        case 'blockquote':
            return (
                <blockquote
                    key={key}
                    className="border-l-2 border-border pl-3 text-muted-foreground"
                >
                    {renderChildren(node.children ?? [], key)}
                </blockquote>
            )
        case 'list':
            return renderList(node, key)
        case 'listItem':
            return renderListItem(node, key)
        case 'link':
            return renderLink(node, key)
        case 'break':
            return <br key={key} />
        case 'thematicBreak':
            return <hr key={key} className="border-border" />
        case 'table':
            return renderTable(node, key)
        case 'tableRow':
            return <tr key={key}>{renderChildren(node.children ?? [], key)}</tr>
        case 'tableCell':
            return (
                <td key={key} className="border border-border px-2 py-1 align-top">
                    {renderInlineChildren(node.children, key)}
                </td>
            )
        default:
            return renderInlineChildren(node.children, key)
    }
}

function renderHeading(node: MarkdownNode, key: string): ReactNode {
    const className = 'my-0 font-semibold leading-tight text-foreground'
    const children = renderInlineChildren(node.children, key)
    if (node.depth === 1) {
        return (
            <h1 key={key} className={cn(className, 'text-lg')}>
                {children}
            </h1>
        )
    }
    if (node.depth === 2) {
        return (
            <h2 key={key} className={cn(className, 'text-base')}>
                {children}
            </h2>
        )
    }
    return (
        <h3 key={key} className={cn(className, 'text-sm')}>
            {children}
        </h3>
    )
}

function renderList(node: MarkdownNode, key: string): ReactNode {
    const className = 'my-0 space-y-1 pl-5'
    const children = renderChildren(node.children ?? [], key)
    return node.ordered ? (
        <ol key={key} className={cn(className, 'list-decimal')}>
            {children}
        </ol>
    ) : (
        <ul key={key} className={cn(className, 'list-disc')}>
            {children}
        </ul>
    )
}

function renderListItem(node: MarkdownNode, key: string): ReactNode {
    const hasTaskState = typeof node.checked === 'boolean'
    return (
        <li key={key} className={cn('pl-1', hasTaskState && 'list-none')}>
            <span className={cn(hasTaskState && '-ml-5 flex items-start gap-2')}>
                {hasTaskState ? (
                    <input
                        type="checkbox"
                        checked={node.checked ?? false}
                        readOnly
                        aria-label={node.checked ? 'Complete' : 'Incomplete'}
                        className="mt-1 size-3.5 shrink-0 accent-primary"
                    />
                ) : null}
                <span className="min-w-0">{renderChildren(node.children ?? [], key)}</span>
            </span>
        </li>
    )
}

function renderLink(node: MarkdownNode, key: string): ReactNode {
    const href = typeof node.url === 'string' ? node.url : ''
    if (isAppRouteHref(href)) {
        return (
            <Link
                key={key}
                to={href}
                title={node.title ?? undefined}
                className="font-medium text-primary underline underline-offset-3"
            >
                {renderInlineChildren(node.children, key)}
            </Link>
        )
    }

    return (
        <a
            key={key}
            href={href}
            title={node.title ?? undefined}
            target={isExternalHref(href) ? '_blank' : undefined}
            rel={isExternalHref(href) ? 'noreferrer' : undefined}
            className="font-medium text-primary underline underline-offset-3"
        >
            {renderInlineChildren(node.children, key)}
        </a>
    )
}

function renderTable(node: MarkdownNode, key: string): ReactNode {
    const rows = node.children ?? []
    const [head, ...body] = rows

    return (
        <div key={key} className="overflow-x-auto">
            <table className="w-full min-w-80 border-collapse text-left text-xs">
                {head ? (
                    <thead className="bg-muted/60">
                        <tr>
                            {(head.children ?? []).map((cell, index) => (
                                <th
                                    key={`${key}-head-${index}`}
                                    className="border border-border px-2 py-1 font-medium"
                                >
                                    {renderInlineChildren(cell.children, `${key}-head-${index}`)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                ) : null}
                <tbody>
                    {body.map((row, rowIndex) => (
                        <tr key={`${key}-row-${rowIndex}`}>
                            {(row.children ?? []).map((cell, cellIndex) => (
                                <td
                                    key={`${key}-cell-${rowIndex}-${cellIndex}`}
                                    className="border border-border px-2 py-1 align-top"
                                >
                                    {renderInlineChildren(
                                        cell.children,
                                        `${key}-cell-${rowIndex}-${cellIndex}`,
                                    )}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
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
