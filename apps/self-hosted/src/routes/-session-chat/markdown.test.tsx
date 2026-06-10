import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { renderMarkdown } from './markdown'

describe('chat markdown link rendering', () => {
    it('renders a standalone bare external URL as a contrasted link preview card', () => {
        const html = renderToStaticMarkup(renderMarkdown('https://example.com/articles/contrast'))

        expect(html).toContain('data-link-preview="true"')
        expect(html).toContain('bg-background')
        expect(html).toContain('border-border')
        expect(html).toContain('ring-1')
        expect(html).toContain('shadow-sm')
        expect(html).toContain('example.com')
        expect(html).toContain('https://example.com/articles/contrast')
    })

    it('keeps inline external links in prose as regular markdown links', () => {
        const html = renderToStaticMarkup(
            renderMarkdown('Read [the guide](https://example.com/guide) first.'),
        )

        expect(html).not.toContain('data-link-preview="true"')
        expect(html).toContain('font-medium text-primary underline')
        expect(html).toContain('the guide')
    })
})
