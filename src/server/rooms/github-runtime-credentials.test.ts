import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestPiRuntimeConfig } from '../pi-runtime/test-runtime-defaults'
import { writeGitHubRuntimeCredentials } from './github-runtime-credentials'

const mocks = vi.hoisted(() => ({
    ensureShellWritableDirectory: vi.fn(),
    ensureShellWritableFile: vi.fn(),
}))

vi.mock('../pi-runtime/shell-sandbox', () => ({
    ensureShellWritableDirectory: mocks.ensureShellWritableDirectory,
    ensureShellWritableFile: mocks.ensureShellWritableFile,
}))

describe('GitHub runtime credential materialization', () => {
    let root: string

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'agent-room-github-runtime-'))
        mocks.ensureShellWritableDirectory.mockReset()
        mocks.ensureShellWritableDirectory.mockResolvedValue(undefined)
        mocks.ensureShellWritableFile.mockReset()
        mocks.ensureShellWritableFile.mockResolvedValue(undefined)
    })

    afterEach(async () => {
        await rm(root, {
            recursive: true,
            force: true,
        })
    })

    it('keeps both git and gh credentials under shell-readable room home paths', async () => {
        const homeDir = join(root, 'home')
        await mkdir(homeDir, {
            recursive: true,
        })
        const config = createTestPiRuntimeConfig({
            root,
            paths: {
                homeDir,
            },
            github: {
                enabled: true,
                installationId: '123',
                accountLogin: 'agent-room',
                repositories: ['agent-room/example'],
                tokenEnvKey: 'AGENT_ROOM_GITHUB_INSTALLATION_TOKEN',
                tokenExpiresAt: '2026-05-13T00:00:00.000Z',
                ghHostsPath: join(homeDir, '.config', 'gh', 'hosts.yml'),
                gitCredentialsPath: join(homeDir, '.git-credentials'),
                gitConfigPath: join(homeDir, '.gitconfig'),
            },
        })

        await writeGitHubRuntimeCredentials({
            config,
            env: {
                AGENT_ROOM_GITHUB_INSTALLATION_TOKEN: 'github-token',
            },
        })

        expect(mocks.ensureShellWritableDirectory).toHaveBeenCalledWith(homeDir)
        expect(mocks.ensureShellWritableDirectory).toHaveBeenCalledWith(join(homeDir, '.config'))
        expect(mocks.ensureShellWritableDirectory).toHaveBeenCalledWith(
            join(homeDir, '.config', 'gh'),
        )
        expect(mocks.ensureShellWritableFile).toHaveBeenCalledWith(
            join(homeDir, '.config', 'gh', 'hosts.yml'),
        )
        expect(mocks.ensureShellWritableFile).toHaveBeenCalledWith(
            join(homeDir, '.git-credentials'),
        )
        expect(mocks.ensureShellWritableFile).toHaveBeenCalledWith(join(homeDir, '.gitconfig'))

        await expect(
            readFile(join(homeDir, '.config', 'gh', 'hosts.yml'), 'utf8'),
        ).resolves.toContain('oauth_token: github-token')
        await expect(readFile(join(homeDir, '.gitconfig'), 'utf8')).resolves.toContain(
            `helper = store --file ${join(homeDir, '.git-credentials')}`,
        )
    })
})
