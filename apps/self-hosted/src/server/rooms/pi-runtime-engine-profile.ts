import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { buildPiRuntimeConfig } from './pi-runtime-config'
import type {
    RuntimeEngineCommand,
    RuntimeEngineProfile,
    RuntimeEngineProfileBuildInput,
} from './runtime-engine-profile-contract'
import {
    assertNoReservedRoomRuntimeEnvKeys,
    shellVisibleStoreDirEnvKey,
    shellVisibleWorkspaceDirEnvKey,
} from '../security/process-env'
import { getAppEnv } from '../config/env'

function resolvePiRuntimeCommand(): RuntimeEngineCommand {
    return {
        command: 'bun',
        args: ['--no-env-file', 'run', join(process.cwd(), 'src/server/pi-runtime/main.ts')],
    }
}

function buildPiRuntimeProfile(input: RuntimeEngineProfileBuildInput) {
    const config = buildPiRuntimeConfig({
        roomId: input.roomId,
        displayName: input.displayName,
        port: input.port,
        token: input.token,
        paths: input.paths,
        sandbox: input.sandbox,
        sandboxHardening: getAppEnv().sandbox,
        roomConfiguration: input.roomConfiguration,
    })

    mkdirSync(config.paths.homeDir, {
        recursive: true,
        mode: 0o700,
    })
    mkdirSync(config.paths.tmpDir, {
        recursive: true,
        mode: 0o700,
    })

    assertNoReservedRoomRuntimeEnvKeys(
        input.roomConfiguration.entitlements.env,
        'Room materialized secrets',
    )

    const env: Record<string, string> = {
        ...input.roomConfiguration.entitlements.env,
        ...input.roomConfiguration.entitlements.internalEnv,
        AGENT_ROOM_PI_RUNTIME_CONFIG_PATH: input.paths.runtimeConfigPath,
        AGENT_ROOM_PI_RUNTIME_TOKEN: input.token,
        AGENT_ROOM_PI_STATE_DIR: input.paths.engineStateDir,
        [shellVisibleWorkspaceDirEnvKey]: input.paths.workspaceDir,
        [shellVisibleStoreDirEnvKey]: input.paths.storeDir,
        PI_CODING_AGENT_DIR: input.paths.engineStateDir,
        HOME: config.paths.homeDir,
        TMPDIR: config.paths.tmpDir,
    }

    return {
        config,
        env,
    }
}

export const piRuntimeEngineProfile: RuntimeEngineProfile = {
    stateDirName: 'pi-state',
    runtimeConfigFileName: 'pi-runtime.config.json',
    runtimeEnvFileName: 'pi-runtime.env',
    runtimeLogFileName: 'pi-runtime.log',
    resolveCommand: resolvePiRuntimeCommand,
    buildRuntimeProfile: buildPiRuntimeProfile,
}
