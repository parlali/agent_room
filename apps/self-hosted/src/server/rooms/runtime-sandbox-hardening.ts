import type { RuntimeSandboxHardening, RuntimeSandboxResourceLimits } from '#/domain/domain-types'

export const sandboxDefaultMaxProcesses = 8192

function toLimit(value: number | undefined): number | null {
    if (value === undefined || value <= 0) {
        return null
    }
    return value
}

export function defaultRuntimeSandboxHardening(): RuntimeSandboxHardening {
    return {
        limits: {
            cpuSeconds: null,
            addressSpaceBytes: null,
            fileSizeBytes: null,
            processCount: sandboxDefaultMaxProcesses,
            openFiles: null,
        },
        restrictPrivateNetwork: false,
    }
}

export function resolveRuntimeSandboxHardening(input: {
    cpuSeconds: number | undefined
    addressSpaceBytes: number | undefined
    fileSizeBytes: number | undefined
    processCount: number | undefined
    openFiles: number | undefined
    restrictPrivateNetwork: boolean
}): RuntimeSandboxHardening {
    const limits: RuntimeSandboxResourceLimits = {
        cpuSeconds: toLimit(input.cpuSeconds),
        addressSpaceBytes: toLimit(input.addressSpaceBytes),
        fileSizeBytes: toLimit(input.fileSizeBytes),
        processCount: toLimit(input.processCount ?? sandboxDefaultMaxProcesses),
        openFiles: toLimit(input.openFiles),
    }
    return {
        limits,
        restrictPrivateNetwork: input.restrictPrivateNetwork,
    }
}
