import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { PiRuntimeConfig } from './pi-runtime-config'
import { ensureShellWritableDirectory, ensureShellWritableFile } from '../pi-runtime/shell-sandbox'

function encodeCredentialToken(token: string): string {
    return encodeURIComponent(token)
}

export async function writeGitHubRuntimeCredentials(input: {
    config: PiRuntimeConfig
    env: Record<string, string>
}): Promise<void> {
    const github = input.config.github
    if (!github.enabled || !github.tokenEnvKey) {
        await Promise.all([
            rm(join(input.config.paths.homeDir, '.config', 'gh', 'hosts.yml'), { force: true }),
            rm(join(input.config.paths.homeDir, '.git-credentials'), { force: true }),
            rm(join(input.config.paths.homeDir, '.gitconfig'), { force: true }),
        ])
        return
    }
    const token = input.env[github.tokenEnvKey]
    if (!token) {
        throw new Error('GitHub runtime token was not materialized')
    }
    if (!github.ghHostsPath || !github.gitCredentialsPath || !github.gitConfigPath) {
        throw new Error('GitHub runtime credential paths were not configured')
    }

    const ghConfigDir = dirname(github.ghHostsPath)
    const configDir = dirname(ghConfigDir)

    await ensureShellWritableDirectory(input.config.paths.homeDir)
    await mkdir(ghConfigDir, {
        recursive: true,
        mode: 0o700,
    })
    await ensureShellWritableDirectory(configDir)
    await ensureShellWritableDirectory(ghConfigDir)

    await writeFile(
        github.ghHostsPath,
        [
            'github.com:',
            `    oauth_token: ${token}`,
            '    git_protocol: https',
            '    user: x-access-token',
            '',
        ].join('\n'),
        {
            encoding: 'utf8',
            mode: 0o600,
        },
    )
    await writeFile(
        github.gitCredentialsPath,
        `https://x-access-token:${encodeCredentialToken(token)}@github.com\n`,
        {
            encoding: 'utf8',
            mode: 0o600,
        },
    )
    await writeFile(
        github.gitConfigPath,
        [
            '[credential]',
            `    helper = store --file ${github.gitCredentialsPath}`,
            '[url "https://github.com/"]',
            '    insteadOf = git@github.com:',
            '',
        ].join('\n'),
        {
            encoding: 'utf8',
            mode: 0o600,
        },
    )

    await Promise.all([
        ensureShellWritableFile(github.ghHostsPath),
        ensureShellWritableFile(github.gitCredentialsPath),
        ensureShellWritableFile(github.gitConfigPath),
    ])
}
