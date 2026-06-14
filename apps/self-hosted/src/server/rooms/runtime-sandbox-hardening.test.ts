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

    it('maps configured limits and treats zero or missing values as unlimited', () => {
        expect(
            resolveRuntimeSandboxHardening({
                cpuSeconds: 120,
                addressSpaceBytes: 4294967296,
                fileSizeBytes: 0,
                processCount: undefined,
                openFiles: 4096,
                restrictPrivateNetwork: true,
            }),
        ).toEqual({
            limits: {
                cpuSeconds: 120,
                addressSpaceBytes: 4294967296,
                fileSizeBytes: null,
                processCount: null,
                openFiles: 4096,
            },
            restrictPrivateNetwork: true,
        })
    })
})
