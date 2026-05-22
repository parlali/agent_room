import { piRuntimeEngineProfile } from './pi-runtime-engine-profile'
import type { RuntimeEngineProfile } from './runtime-engine-profile-contract'

export type {
    RuntimeEngineCommand,
    RuntimeEngineProfile,
    RuntimeEngineProfileBuildInput,
    RuntimeEngineProfileBuildResult,
} from './runtime-engine-profile-contract'

export function getRuntimeEngineProfile(): RuntimeEngineProfile {
    return piRuntimeEngineProfile
}
