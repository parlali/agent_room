import { chmod, mkdir } from 'node:fs/promises'
import type { PiRuntimeConfig } from '../rooms/pi-runtime-config'
import { ensureInternalState } from './internal-state'
import { ensureShellWritableDirectory } from './shell-sandbox'

export async function ensureRuntimeLayout(config: PiRuntimeConfig): Promise<void> {
    const shellEnabled = config.tools.profile !== 'read-only'
    await Promise.all([
        mkdir(config.paths.stateDir, { recursive: true, mode: 0o700 }),
        mkdir(config.paths.sessionsDir, { recursive: true, mode: 0o700 }),
        mkdir(config.paths.internalStateDir, { recursive: true, mode: 0o700 }),
        mkdir(config.paths.workspaceDir, { recursive: true, mode: 0o700 }),
        mkdir(config.paths.storeDir, { recursive: true, mode: 0o700 }),
        mkdir(config.paths.homeDir, { recursive: true, mode: 0o700 }),
        mkdir(config.paths.tmpDir, { recursive: true, mode: 0o700 }),
    ])
    await Promise.all([
        chmod(config.paths.roomRootDir, shellEnabled ? 0o711 : 0o700),
        chmod(config.paths.stateDir, shellEnabled ? 0o711 : 0o700),
        chmod(config.paths.sessionsDir, 0o700),
        chmod(config.paths.internalStateDir, 0o700),
        chmod(config.paths.workspaceDir, 0o700),
        chmod(config.paths.storeDir, 0o700),
        chmod(config.paths.homeDir, 0o700),
        chmod(config.paths.tmpDir, 0o700),
    ])
    if (shellEnabled) {
        await Promise.all([
            ensureShellWritableDirectory(config.paths.workspaceDir),
            ensureShellWritableDirectory(config.paths.storeDir),
            ensureShellWritableDirectory(config.paths.homeDir),
            ensureShellWritableDirectory(config.paths.tmpDir),
        ])
    }
    await ensureInternalState(config)
}
