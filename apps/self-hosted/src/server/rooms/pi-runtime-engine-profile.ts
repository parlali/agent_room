import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { buildPiRuntimeConfig } from './pi-runtime-config'
import {
    buildPiRuntimeEntrypoint,
    piCodingAgentDirEnvKey,
    piRuntimeConfigPathEnvKey,
    piRuntimeMainRelativePath,
    piRuntimeStateDirEnvKey,
    piRuntimeTokenEnvKey,
} from './pi-runtime-contract'
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

function resolvePiRuntimeCommand(): RuntimeEngineCommand {
    const [command, ...args] = buildPiRuntimeEntrypoint(
        join(process.cwd(), piRuntimeMainRelativePath),
    )
    return {
        command,
        args,
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
        sandboxHardening: input.sandboxHardening,
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
        [piRuntimeConfigPathEnvKey]: input.paths.runtimeConfigPath,
        [piRuntimeTokenEnvKey]: input.token,
        [piRuntimeStateDirEnvKey]: input.paths.engineStateDir,
        [shellVisibleWorkspaceDirEnvKey]: input.paths.workspaceDir,
        [shellVisibleStoreDirEnvKey]: input.paths.storeDir,
        [piCodingAgentDirEnvKey]: input.paths.engineStateDir,
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
