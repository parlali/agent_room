import { isRecord } from './runtime-redaction'

export interface NativePdfPayloadRewriteResult {
    payload: unknown
    count: number
}

/**
 * Scans the given payload for native PDF image blocks, converts them into native PDF document blocks, and returns the payload along with the number of conversions performed.
 *
 * @param payload - The input payload to scan; array and object elements may be mutated in place.
 * @returns An object with `payload` (the same reference provided) and `count` — the number of image blocks converted to document blocks.
 */
export function rewriteNativePdfPayload(payload: unknown): NativePdfPayloadRewriteResult {
    return {
        payload,
        count: rewriteContentValue(payload),
    }
}

/**
 * Recursively traverses a value tree and rewrites native PDF image blocks into native PDF document blocks.
 *
 * The function walks arrays and records, following `content` and `messages` arrays on objects. When a native PDF
 * image block is found it is replaced in-place with a document block (preserving `source.data` and optional
 * `cache_control`).
 *
 * @param value - The root value to traverse and potentially modify
 * @returns The number of native PDF image blocks that were rewritten
 */
function rewriteContentValue(value: unknown): number {
    if (Array.isArray(value)) {
        let count = 0
        for (let index = 0; index < value.length; index += 1) {
            const block = value[index]
            if (isNativePdfImageBlock(block)) {
                value[index] = nativePdfDocumentBlock(block)
                count += 1
            } else {
                count += rewriteContentValue(block)
            }
        }
        return count
    }

    if (!isRecord(value)) {
        return 0
    }

    let count = 0
    if (Array.isArray(value.content)) {
        count += rewriteContentValue(value.content)
    }
    if (Array.isArray(value.messages)) {
        count += rewriteContentValue(value.messages)
    }
    return count
}

/**
 * Determines whether a value is an image block whose source is a base64-encoded PDF.
 *
 * @param value - The value to test
 * @returns `true` if `value` is a record with `type: 'image'` and a `source` record whose `type` is `'base64'` and `media_type` is `'application/pdf'`, `false` otherwise.
 */
function isNativePdfImageBlock(value: unknown): value is Record<string, unknown> & {
    source: Record<string, unknown>
} {
    if (!isRecord(value) || value.type !== 'image' || !isRecord(value.source)) {
        return false
    }
    return value.source.type === 'base64' && value.source.media_type === 'application/pdf'
}

/**
 * Convert a native PDF image block into a document block representation.
 *
 * @param block - The original image block whose `source.data` contains base64 PDF bytes; may include `cache_control`.
 * @returns A new block object with `type` set to `'document'`, `source` set to a base64 PDF containing the original `data`, and `cache_control` copied if present on the input
 */
function nativePdfDocumentBlock(
    block: Record<string, unknown> & { source: Record<string, unknown> },
): Record<string, unknown> {
    return {
        type: 'document',
        source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: block.source.data,
        },
        ...(block.cache_control ? { cache_control: block.cache_control } : {}),
    }
}
