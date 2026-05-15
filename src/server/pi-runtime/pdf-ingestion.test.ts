import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { renderPdfPageImages, type PdfPageSelection } from './pdf-ingestion'
import { createTestPiRuntimeConfig, ensureTestPiRuntimeDirectories } from './test-runtime-defaults'

const runDocumentWorkerMock = vi.hoisted(() => vi.fn())

vi.mock('./document-tools/worker', () => ({
    runDocumentWorker: runDocumentWorkerMock,
}))

async function withConfig<T>(fn: (root: string) => Promise<T>): Promise<T> {
    const root = await mkdtemp(join(tmpdir(), 'agent-room-pdf-ingestion-'))
    try {
        return await fn(root)
    } finally {
        await rm(root, {
            recursive: true,
            force: true,
        })
    }
}

describe('PDF ingestion', () => {
    it('renders non-contiguous page selections one page at a time', async () => {
        await withConfig(async (root) => {
            const config = createTestPiRuntimeConfig({ root })
            await ensureTestPiRuntimeDirectories(config)
            await mkdir(config.paths.workspaceDir, {
                recursive: true,
            })
            const source = join(config.paths.workspaceDir, 'source.pdf')
            await writeFile(source, Buffer.from('%PDF-1.7'))
            runDocumentWorkerMock.mockReset()
            runDocumentWorkerMock.mockImplementation(async (input: { args: string[] }) => {
                const page = input.args[2]
                const prefix = input.args[6]
                if (!page || !prefix) {
                    throw new Error('Missing render arguments')
                }
                await writeFile(`${prefix}-${page}.png`, Buffer.from(`page ${page}`))
            })

            const selection: PdfPageSelection = {
                pages: [1, 500],
                label: 'pages 1,500',
                truncated: false,
            }
            const images = await renderPdfPageImages({
                config,
                path: source,
                selection,
            })

            expect(images).toHaveLength(2)
            expect(runDocumentWorkerMock).toHaveBeenCalledTimes(2)
            expect(
                runDocumentWorkerMock.mock.calls.map((call) => call[0].args.slice(0, 5)),
            ).toEqual([
                ['-png', '-f', '1', '-l', '1'],
                ['-png', '-f', '500', '-l', '500'],
            ])
        })
    })
})
