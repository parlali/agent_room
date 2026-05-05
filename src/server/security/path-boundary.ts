import { isAbsolute, relative, resolve } from 'node:path'

export function assertPathInsideRoot(
    candidate: string,
    root: string,
    message: string | ((candidate: string) => string),
): string {
    const normalizedRoot = resolve(root)
    const normalizedCandidate = resolve(candidate)
    const diff = relative(normalizedRoot, normalizedCandidate)
    if (diff === '' || (!diff.startsWith('..') && !isAbsolute(diff))) {
        return normalizedCandidate
    }
    throw new Error(typeof message === 'function' ? message(candidate) : message)
}
