export const piRuntimeMainRelativePath = 'src/server/pi-runtime/main.ts'

export const piRuntimeConfigPathEnvKey = 'AGENT_ROOM_PI_RUNTIME_CONFIG_PATH'
export const piRuntimeTokenEnvKey = 'AGENT_ROOM_PI_RUNTIME_TOKEN'
export const piRuntimeStateDirEnvKey = 'AGENT_ROOM_PI_STATE_DIR'
export const piCodingAgentDirEnvKey = 'PI_CODING_AGENT_DIR'
export const piRuntimeFileBundleEnvKey = 'AGENT_ROOM_PI_RUNTIME_FILE_BUNDLE_B64'
export const piRuntimeRedactionSecretsEnvKey = 'AGENT_ROOM_PI_RUNTIME_REDACTION_SECRETS_B64'
export const hostedRuntimeUsageCallbackUrlEnvKey = 'AGENT_ROOM_HOSTED_USAGE_CALLBACK_URL'
export const hostedRuntimeUsageCallbackTokenEnvKey = 'AGENT_ROOM_HOSTED_USAGE_CALLBACK_TOKEN'
export const hostedRuntimeFileCallbackUrlEnvKey = 'AGENT_ROOM_HOSTED_FILE_CALLBACK_URL'
export const hostedRuntimeStateCallbackUrlEnvKey = 'AGENT_ROOM_HOSTED_STATE_CALLBACK_URL'
export const hostedRuntimeQuotaCallbackUrlEnvKey = 'AGENT_ROOM_HOSTED_QUOTA_CALLBACK_URL'
export const hostedRuntimeWorkspaceIdEnvKey = 'AGENT_ROOM_HOSTED_WORKSPACE_ID'
export const hostedRuntimeRoomIdEnvKey = 'AGENT_ROOM_HOSTED_ROOM_ID'
export const hostedRuntimeManagedOpenRouterEnvKey = 'AGENT_ROOM_HOSTED_MANAGED_OPENROUTER'

export function buildPiRuntimeEntrypoint(mainPath = piRuntimeMainRelativePath): string[] {
    return ['bun', '--no-env-file', 'run', mainPath]
}
