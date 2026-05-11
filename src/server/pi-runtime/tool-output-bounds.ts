import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { currentToolRunContext } from './tool-run-context'

export const modelVisibleToolOutputMaxBytes = 32000

export interface ToolOutputArtifact {
    root: 'store'
    path: string
    byteLength: number
    modelVisibleByteLength: number
    saveError?: string
}

export interface BoundedToolOutput {
    text: string
    modelVisibleTruncated: boolean
    outputArtifact: ToolOutputArtifact | null
}

function textByteLength(text: string): number {
    return Buffer.byteLength(text, 'utf8')
}

function slug(value: string): string {
    const cleaned = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80)
    return cleaned || 'tool-output'
}

function artifactPath(input: {
    label: string
    extension: string
    sessionKey: string | null
    runId: string | null
}): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const extension = input.extension.replace(/[^a-z0-9]+/gi, '').toLowerCase() || 'txt'
    return [
        'tool-output',
        slug(input.sessionKey ?? 'detached-session'),
        slug(input.runId ?? 'detached-run'),
        `${timestamp}-${slug(input.label)}-${randomUUID().slice(0, 8)}.${extension}`,
    ].join('/')
}

function previewText(text: string, maxBytes: number, mode: 'head' | 'tail'): string {
    const bytes = Buffer.from(text, 'utf8')
    const slice =
        mode === 'tail'
            ? bytes.subarray(Math.max(0, bytes.byteLength - maxBytes))
            : bytes.subarray(0, maxBytes)
    return slice.toString('utf8')
}

function truncationNotice(input: {
    originalBytes: number
    visibleBytes: number
    artifact: ToolOutputArtifact | null
}): string {
    const lines = [
        '',
        '[Tool output truncated for model context]',
        `Visible bytes: ${input.visibleBytes}`,
        `Original bytes: ${input.originalBytes}`,
    ]
    if (input.artifact) {
        lines.push(`Full output saved: root=store path="${input.artifact.path}"`)
    } else {
        lines.push('Full output was not saved')
    }
    if (input.artifact?.saveError) {
        lines.push(`Save error: ${input.artifact.saveError}`)
    }
    return lines.join('\n')
}

export async function boundToolOutput(input: {
    config: PiRuntimeConfig
    text: string
    label: string
    extension?: string
    maxVisibleBytes?: number
    previewMode?: 'head' | 'tail'
}): Promise<BoundedToolOutput> {
    const originalBytes = textByteLength(input.text)
    const maxVisibleBytes = input.maxVisibleBytes ?? modelVisibleToolOutputMaxBytes
    if (originalBytes <= maxVisibleBytes) {
        return {
            text: input.text,
            modelVisibleTruncated: false,
            outputArtifact: null,
        }
    }

    const context = currentToolRunContext()
    const relativePath = artifactPath({
        label: input.label,
        extension: input.extension ?? 'txt',
        sessionKey: context?.sessionKey ?? null,
        runId: context?.runId ?? null,
    })
    const fullPath = join(input.config.paths.storeDir, relativePath)
    let outputArtifact: ToolOutputArtifact = {
        root: 'store',
        path: relativePath,
        byteLength: originalBytes,
        modelVisibleByteLength: maxVisibleBytes,
    }
    try {
        await mkdir(dirname(fullPath), {
            recursive: true,
            mode: 0o700,
        })
        await writeFile(fullPath, input.text, {
            encoding: 'utf8',
            mode: 0o600,
        })
    } catch (error) {
        outputArtifact = {
            ...outputArtifact,
            saveError: error instanceof Error ? error.message : 'Unknown output save error',
        }
    }

    const visible = previewText(input.text, maxVisibleBytes, input.previewMode ?? 'head')
    return {
        text: `${visible}${truncationNotice({
            originalBytes,
            visibleBytes: textByteLength(visible),
            artifact: outputArtifact,
        })}`,
        modelVisibleTruncated: true,
        outputArtifact,
    }
}
