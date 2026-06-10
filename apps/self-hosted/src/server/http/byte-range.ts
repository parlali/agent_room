export interface HttpByteRange {
    start: number
    end: number
    contentLength: number
}

export type HttpByteRangeResult =
    | {
          kind: 'none'
      }
    | {
          kind: 'satisfiable'
          range: HttpByteRange
      }
    | {
          kind: 'unsatisfiable'
      }

export function resolveHttpByteRange(
    rangeHeader: string | null,
    byteLength: number,
): HttpByteRangeResult {
    if (!rangeHeader) return { kind: 'none' }
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) return { kind: 'unsatisfiable' }

    const prefix = 'bytes='
    if (!rangeHeader.startsWith(prefix)) return { kind: 'unsatisfiable' }

    const rangeSpec = rangeHeader.slice(prefix.length).trim()
    if (!rangeSpec || rangeSpec.includes(',')) return { kind: 'unsatisfiable' }

    const separatorIndex = rangeSpec.indexOf('-')
    if (separatorIndex === -1) return { kind: 'unsatisfiable' }

    const rawStart = rangeSpec.slice(0, separatorIndex).trim()
    const rawEnd = rangeSpec.slice(separatorIndex + 1).trim()
    if (!rawStart && !rawEnd) return { kind: 'unsatisfiable' }
    if (byteLength === 0) return { kind: 'unsatisfiable' }

    const range = rawStart
        ? resolveExplicitByteRange(rawStart, rawEnd, byteLength)
        : resolveSuffixByteRange(rawEnd, byteLength)

    if (!range) return { kind: 'unsatisfiable' }

    return {
        kind: 'satisfiable',
        range,
    }
}

function resolveExplicitByteRange(
    rawStart: string,
    rawEnd: string,
    byteLength: number,
): HttpByteRange | null {
    const start = parseBytePosition(rawStart)
    if (start === null || start >= byteLength) return null

    const requestedEnd = rawEnd ? parseBytePosition(rawEnd) : byteLength - 1
    if (requestedEnd === null || requestedEnd < start) return null

    const end = Math.min(requestedEnd, byteLength - 1)
    return {
        start,
        end,
        contentLength: end - start + 1,
    }
}

function resolveSuffixByteRange(rawEnd: string, byteLength: number): HttpByteRange | null {
    const suffixLength = parseBytePosition(rawEnd)
    if (suffixLength === null || suffixLength <= 0) return null

    const start = Math.max(byteLength - suffixLength, 0)
    const end = byteLength - 1
    return {
        start,
        end,
        contentLength: end - start + 1,
    }
}

function parseBytePosition(value: string): number | null {
    if (!/^\d+$/.test(value)) return null
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed) || parsed < 0) return null
    return parsed
}
