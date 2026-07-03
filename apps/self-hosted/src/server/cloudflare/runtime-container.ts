import { Container } from '@cloudflare/containers'
import type { StopParams } from '@cloudflare/containers'
import type { DurableObjectState } from '@cloudflare/workers-types'
import type { AgentRoomHostedEnv } from './bindings'
import { handleHostedRuntimeContainerStop } from './hosted-runtime-container-stop'
import {
    hostedRuntimeContainerPort,
    hostedRuntimeDeniedHosts,
    hostedRuntimeEntrypoint,
    hostedRuntimeSleepAfter,
} from './runtime-contract'

export { buildHostedRuntimeStartOptions, hostedRuntimeContainerName } from './runtime-contract'
export {
    handleHostedRuntimeContainerStop,
    parseHostedRuntimeContainerName,
} from './hosted-runtime-container-stop'

export class AgentRoomRuntimeContainer extends Container<AgentRoomHostedEnv> {
    defaultPort = hostedRuntimeContainerPort
    requiredPorts = [hostedRuntimeContainerPort]
    sleepAfter = hostedRuntimeSleepAfter
    entrypoint = [...hostedRuntimeEntrypoint]
    envVars = {}
    enableInternet = false
    interceptHttps = true
    deniedHosts = hostedRuntimeDeniedHosts

    private readonly hostedEnv: AgentRoomHostedEnv
    private readonly hostedContainerName: string | undefined

    constructor(ctx: DurableObjectState, env: AgentRoomHostedEnv) {
        super(ctx, env)
        this.hostedEnv = env
        this.hostedContainerName = ctx.id.name
    }

    override onStart() {
        console.log('Agent Room hosted runtime container started')
    }

    override async onStop(params: StopParams) {
        await handleHostedRuntimeContainerStop({
            env: this.hostedEnv,
            containerName: this.hostedContainerName,
            stop: params,
        })
    }

    override onError(error: unknown) {
        console.error(
            'Agent Room hosted runtime container error',
            error instanceof Error ? error.message : error,
        )
    }
}
