import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { SessionContextMenuTrigger } from './session-context-menu'

describe('SessionContextMenuTrigger', () => {
    it('forwards primitive trigger props to the rendered button', () => {
        const markup = renderToStaticMarkup(
            <SessionContextMenuTrigger
                aria-controls="session-menu"
                aria-expanded="true"
                data-state="open"
                id="session-trigger"
            />,
        )

        expect(markup).toContain('id="session-trigger"')
        expect(markup).toContain('aria-controls="session-menu"')
        expect(markup).toContain('aria-expanded="true"')
        expect(markup).toContain('data-state="open"')
    })
})
