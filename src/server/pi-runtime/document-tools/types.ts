import type { PiRuntimeConfig } from '../../rooms/pi-runtime-config'
import type { ToolRoot } from '../room-tools/shared'

export interface DocumentToolContext {
    config: PiRuntimeConfig
    audit: (event: string, payload: unknown) => Promise<void>
}

export interface DocumentToolDetails {
    path?: string
    root?: ToolRoot
    artifactId?: string
    sha256?: string
    byteLength?: number
    mediaType?: string
    exportedPath?: string
    previewPath?: string
    operation?: string
    format?: string
    durationMs?: number
}

export interface Replacement {
    oldText: string
    newText: string
}

export interface WorkbookCellEdit {
    sheet?: string
    cell: string
    value?: unknown
    formula?: string
}

export interface WorkbookChartInput {
    type?: 'bar' | 'line' | 'pie'
    title?: string
    seriesName?: string
    labelsRange: string
    valuesRange: string
    anchor?: string
}

export interface WorkbookSheetInput {
    name: string
    rows: unknown[][]
    charts: WorkbookChartInput[]
}

export interface SlideInput {
    title: string
    bullets?: string[]
    notes?: string
    imagePath?: string
    chart?: {
        type?: 'bar' | 'line' | 'pie'
        labels: string[]
        values: number[]
        name?: string
    }
}

export const officeExportFormats = {
    docx: {
        label: 'DOCX',
        extensionPattern: /\.docx$/i,
    },
    xlsx: {
        label: 'XLSX',
        extensionPattern: /\.xlsx$/i,
    },
    pptx: {
        label: 'PPTX',
        extensionPattern: /\.pptx$/i,
    },
} as const

export type OfficeExportFormat = keyof typeof officeExportFormats
export type OfficeExportOperation = 'export_pdf' | 'preview'
