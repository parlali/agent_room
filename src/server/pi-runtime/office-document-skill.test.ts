import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createPiResourceLoader } from './resource-loader'
import { officeDocumentScriptPath } from './bundled-skills'

const scriptPath = fileURLToPath(
    new URL('./skills/office-documents/scripts/office_document.py', import.meta.url),
)

interface ScriptRun {
    stdout: string
    stderr: string
    status: number | null
}

async function withRoom<T>(
    fn: (room: { root: string; workspace: string; store: string }) => Promise<T>,
) {
    const root = await mkdtemp(join(tmpdir(), 'agent-room-office-skill-'))
    const workspace = join(root, 'workspace')
    const store = join(root, 'store')
    try {
        return await fn({ root, workspace, store })
    } finally {
        await rm(root, {
            recursive: true,
            force: true,
        })
    }
}

function runOfficeScript(input: {
    workspace: string
    store: string
    args: string[]
}): Record<string, unknown> {
    const result = spawnSync('python3', [scriptPath, ...input.args], {
        encoding: 'utf8',
        env: {
            ...process.env,
            AGENT_ROOM_WORKSPACE_DIR: input.workspace,
            AGENT_ROOM_STORE_DIR: input.store,
        },
    }) as ScriptRun
    if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout)
    }
    return JSON.parse(result.stdout) as Record<string, unknown>
}

function contentJson(format: string): string {
    if (format === 'docx') {
        return JSON.stringify({
            title: 'Draft report',
            paragraphs: ['Revenue increased'],
        })
    }
    if (format === 'xlsx') {
        return JSON.stringify({
            sheets: [
                {
                    name: 'Data',
                    rows: [
                        ['Metric', 'Value'],
                        ['Draft report', 42],
                    ],
                },
            ],
        })
    }
    return JSON.stringify({
        slides: [
            {
                title: 'Draft report',
                bullets: ['Revenue increased'],
            },
        ],
    })
}

function inspectedText(result: Record<string, unknown>): string {
    return typeof result.text === 'string' ? result.text : ''
}

describe('office document skill', () => {
    it('loads the bundled office document skill into the Pi resource loader', () => {
        const loader = createPiResourceLoader('system prompt')
        const skills = loader.getSkills().skills
        expect(skills.map((skill) => skill.name)).toContain('office-documents')
        const appendPrompt = loader.getAppendSystemPrompt().join('\n')
        expect(appendPrompt).toContain('office_document.py')
        expect(appendPrompt).toContain('agent_room_shell')
        expect(officeDocumentScriptPath()).toBe(scriptPath)
    })

    it.each(['docx', 'xlsx', 'pptx'])(
        'creates, inspects, and edits %s through the bundled script',
        async (format) => {
            await withRoom(async ({ workspace, store }) => {
                const path = `artifact.${format}`
                runOfficeScript({
                    workspace,
                    store,
                    args: [
                        'create',
                        '--format',
                        format,
                        '--path',
                        path,
                        '--content-json',
                        contentJson(format),
                    ],
                })
                const before = runOfficeScript({
                    workspace,
                    store,
                    args: ['inspect', '--format', format, '--path', path],
                })
                expect(inspectedText(before)).toContain('Draft report')
                runOfficeScript({
                    workspace,
                    store,
                    args: [
                        'edit',
                        '--format',
                        format,
                        '--path',
                        path,
                        '--replacements-json',
                        JSON.stringify([
                            {
                                oldText: 'Draft report',
                                newText: 'Final report',
                            },
                        ]),
                    ],
                })
                const after = runOfficeScript({
                    workspace,
                    store,
                    args: ['inspect', '--format', format, '--path', path],
                })
                expect(inspectedText(after)).toContain('Final report')
                expect(inspectedText(after)).not.toContain('Draft report')
            })
        },
    )
})
