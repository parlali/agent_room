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
    | 'browser'
    | 'subagent'
    | 'deep_work'
    | 'mcp'
    | 'other'

export function categorizeAgentRoomTool(name: string | null): AgentRoomToolCategory {
    if (!name) return 'other'
    if (name === 'memory_read' || name === 'agent_room_memory_read') return 'memory_read'
    if (
        name === 'memory_patch' ||
        name === 'memory_replace' ||
        name === 'agent_room_memory_patch' ||
        name === 'agent_room_memory_replace'
    ) {
        return 'memory_write'
    }
    if (
        name === 'read' ||
        name === 'find' ||
        name === 'ls' ||
        name === 'agent_room_read' ||
        name === 'agent_room_workspace_tree' ||
        name === 'agent_room_list'
    ) {
        return 'workspace_read'
    }
    if (name === 'grep' || name === 'agent_room_search') return 'workspace_search'
    if (
        name === 'write' ||
        name === 'edit' ||
        name === 'agent_room_write' ||
        name === 'agent_room_edit'
    ) {
        return 'workspace_write'
    }
    if (
        name === 'artifact_import' ||
        name === 'artifact_export' ||
        name === 'agent_room_artifact_import' ||
        name === 'agent_room_artifact_export'
    ) {
        return 'artifact'
    }
    if (
        name === 'shell' ||
        name === 'command_start' ||
        name === 'command_poll' ||
        name === 'command_status' ||
        name === 'command_terminate' ||
        name === 'agent_room_shell' ||
        name === 'agent_room_command_start' ||
        name === 'agent_room_command_poll' ||
        name === 'agent_room_command_status' ||
        name === 'agent_room_command_terminate'
    ) {
        return 'command'
    }
    if (name === 'web_search' || name === 'agent_room_web_search') return 'research_search'
    if (name === 'fetch_url' || name === 'agent_room_fetch_url') return 'research_fetch'
    if (
        name === 'pdf' ||
        name === 'read_pdf' ||
        name === 'agent_room_pdf' ||
        name === 'agent_room_read_pdf'
    ) {
        return 'document_pdf'
    }
    if (name === 'image_generate' || name === 'agent_room_image_generate') return 'image'
    if (name.startsWith('browser_') || name.startsWith('agent_room_browser_')) return 'browser'
    if (name === 'subagent' || name === 'agent_room_subagent') return 'subagent'
    if (name === 'deep_work' || name === 'agent_room_deep_work') return 'deep_work'
    if (name.startsWith('mcp_')) return 'mcp'
    return 'other'
}
