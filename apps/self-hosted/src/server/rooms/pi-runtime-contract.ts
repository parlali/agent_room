export const piRuntimeMainRelativePath = 'src/server/pi-runtime/main.ts'

export const piRuntimeConfigPathEnvKey = 'AGENT_ROOM_PI_RUNTIME_CONFIG_PATH'
export const piRuntimeTokenEnvKey = 'AGENT_ROOM_PI_RUNTIME_TOKEN'
export const piRuntimeStateDirEnvKey = 'AGENT_ROOM_PI_STATE_DIR'
export const piCodingAgentDirEnvKey = 'PI_CODING_AGENT_DIR'

export function buildPiRuntimeEntrypoint(mainPath = piRuntimeMainRelativePath): string[] {
    return ['bun', '--no-env-file', 'run', mainPath]
}
