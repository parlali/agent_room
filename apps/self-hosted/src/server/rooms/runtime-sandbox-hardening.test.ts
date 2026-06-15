import { describe, expect, it } from 'vitest'
import {
    defaultRuntimeSandboxHardening,
    resolveRuntimeSandboxHardening,
    sandboxDefaultMaxProcesses,
} from './runtime-sandbox-hardening'

describe('runtime sandbox hardening policy', () => {
    it('defaults to a fork-bomb guard with private-network egress allowed', () => {
        expect(defaultRuntimeSandboxHardening()).toEqual({
            limits: {
                cpuSeconds: null,
                addressSpaceBytes: null,
                fileSizeBytes: null,
                processCount: sandboxDefaultMaxProcesses,
                openFiles: null,
            },
            restrictPrivateNetwork: false,
        })
    })

    it('maps configured limits and treats zero values as unlimited', () => {
        expect(
            resolveRuntimeSandboxHardening({
                cpuSeconds: 120,
                addressSpaceBytes: 4294967296,
                fileSizeBytes: 0,
                processCount: 1024,
                openFiles: 4096,
                restrictPrivateNetwork: true,
            }),
        ).toEqual({
            limits: {
                cpuSeconds: 120,
                addressSpaceBytes: 4294967296,
                fileSizeBytes: null,
                processCount: 1024,
                openFiles: 4096,
            },
            restrictPrivateNetwork: true,
        })
    })

    it('applies the process-count default when unset and disables it when explicitly zero', () => {
        const unset = resolveRuntimeSandboxHardening({
            cpuSeconds: undefined,
            addressSpaceBytes: undefined,
            fileSizeBytes: undefined,
            processCount: undefined,
            openFiles: undefined,
            restrictPrivateNetwork: false,
        })
        expect(unset.limits.processCount).toBe(sandboxDefaultMaxProcesses)

        const disabled = resolveRuntimeSandboxHardening({
            cpuSeconds: undefined,
            addressSpaceBytes: undefined,
            fileSizeBytes: undefined,
            processCount: 0,
            openFiles: undefined,
            restrictPrivateNetwork: false,
        })
        expect(disabled.limits.processCount).toBeNull()
    })
})
