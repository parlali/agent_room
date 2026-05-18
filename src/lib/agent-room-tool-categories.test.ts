import { describe, expect, it } from 'vitest'
import { categorizeAgentRoomTool } from './agent-room-tool-categories'

describe('agent room tool categories', () => {
    it('keeps browser automation separate from MCP tools', () => {
        expect(categorizeAgentRoomTool('browser_navigate')).toBe('browser')
        expect(categorizeAgentRoomTool('agent_room_browser_click')).toBe('browser')
        expect(categorizeAgentRoomTool('mcp_docs_search')).toBe('mcp')
    })
})
