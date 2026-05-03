export const CAPABILITY_OPTIONS = [
    {
        id: 'web_search',
        key: 'webSearch',
        label: 'Web search',
        description: 'Search current public web results through Agent Room.',
    },
    {
        id: 'url_fetch',
        key: 'urlFetch',
        label: 'URL fetch',
        description: 'Fetch known public URLs with SSRF protections and size limits.',
    },
    {
        id: 'documents',
        key: 'documents',
        label: 'Documents',
        description: 'Create, inspect, edit, export, and preview DOCX files.',
    },
    {
        id: 'spreadsheets',
        key: 'spreadsheets',
        label: 'Spreadsheets',
        description: 'Create, inspect, edit, chart, export, and preview XLSX workbooks.',
    },
    {
        id: 'presentations',
        key: 'presentations',
        label: 'Presentations',
        description: 'Create, inspect, edit, export, and preview PPTX decks.',
    },
    {
        id: 'pdf',
        key: 'pdf',
        label: 'PDF',
        description: 'Create PDFs and render document previews.',
    },
    {
        id: 'images',
        key: 'images',
        label: 'Images',
        description: 'Generate provider-backed image artifacts with provenance.',
    },
    {
        id: 'mcp',
        key: 'mcp',
        label: 'MCP',
        description: 'Expose selected MCP server tools in this room.',
    },
    {
        id: 'shell_coding',
        key: 'shellCoding',
        label: 'Shell and coding',
        description: 'Read, write, edit, search files, and run bounded background commands.',
    },
] as const

export type CapabilityOption = (typeof CAPABILITY_OPTIONS)[number]
