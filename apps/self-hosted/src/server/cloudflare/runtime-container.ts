import { Container } from '@cloudflare/containers'
import type { AgentRoomHostedEnv } from './bindings'
import {
    hostedRuntimeContainerPort,
    hostedRuntimeDeniedHosts,
    hostedRuntimeEntrypoint,
    hostedRuntimeSleepAfter,
} from './runtime-contract'

export { buildHostedRuntimeStartOptions, hostedRuntimeContainerName } from './runtime-contract'

export class AgentRoomRuntimeContainer extends Container<AgentRoomHostedEnv> {
    defaultPort = hostedRuntimeContainerPort
    requiredPorts = [hostedRuntimeContainerPort]
    sleepAfter = hostedRuntimeSleepAfter
    entrypoint = [...hostedRuntimeEntrypoint]
    envVars = {}
    enableInternet = false
    interceptHttps = true
    deniedHosts = hostedRuntimeDeniedHosts

    override onStart() {
        console.log('Agent Room hosted runtime container started')
    }

    override onStop() {
        console.log('Agent Room hosted runtime container stopped')
    }

    override onError(error: unknown) {
        console.error(
            'Agent Room hosted runtime container error',
            error instanceof Error ? error.message : error,
        )
    }
}
