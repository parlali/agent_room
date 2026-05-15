export type AgentRoomToolCategory =
    | 'memory_read'
    | 'memory_write'
    | 'workspace_read'
    | 'workspace_search'
    | 'workspace_write'
    | 'artifact'
    | 'command'
    | 'research_search'
    | 'research_fetch'
    | 'document_pdf'
    | 'image'
    | 'subagent'
    | 'deep_work'
    | 'mcp'
    | 'other'

/**
 * Map an agent room tool name to its corresponding AgentRoomToolCategory.
 *
 * @param name - The tool name to categorize; may be `null`.
 * @returns The matching `AgentRoomToolCategory`. Returns `'other'` if `name` is `null` or does not match a known tool.
 */
export function categorizeAgentRoomTool(name: string | null): AgentRoomToolCategory {
    if (!name) return 'other'
    if (name === 'agent_room_memory_read') return 'memory_read'
    if (name === 'agent_room_memory_patch' || name === 'agent_room_memory_replace') {
        return 'memory_write'
    }
    if (
        name === 'agent_room_read' ||
        name === 'agent_room_workspace_tree' ||
        name === 'agent_room_list'
    ) {
        return 'workspace_read'
    }
    if (name === 'agent_room_search') return 'workspace_search'
    if (name === 'agent_room_write' || name === 'agent_room_edit') return 'workspace_write'
    if (name === 'agent_room_artifact_import' || name === 'agent_room_artifact_export') {
        return 'artifact'
    }
    if (
        name === 'agent_room_shell' ||
        name === 'agent_room_command_start' ||
        name === 'agent_room_command_poll' ||
        name === 'agent_room_command_status' ||
        name === 'agent_room_command_terminate'
    ) {
        return 'command'
    }
    if (name === 'agent_room_web_search') return 'research_search'
    if (name === 'agent_room_fetch_url') return 'research_fetch'
    if (name === 'agent_room_pdf' || name === 'agent_room_read_pdf') {
        return 'document_pdf'
    }
    if (name === 'agent_room_image_generate') return 'image'
    if (name === 'agent_room_subagent') return 'subagent'
    if (name === 'agent_room_deep_work') return 'deep_work'
    if (name.startsWith('mcp_')) return 'mcp'
    return 'other'
}
