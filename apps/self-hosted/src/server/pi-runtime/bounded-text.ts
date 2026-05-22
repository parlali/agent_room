export interface BoundedText {
    text: string
    truncated: boolean
}

export function boundTextByChars(value: string, maxChars: number): BoundedText {
    if (value.length <= maxChars) {
        return {
            text: value,
            truncated: false,
        }
    }
    return {
        text: value.slice(0, Math.max(0, maxChars)),
        truncated: true,
    }
}

export function boundTextByUtf8Bytes(value: string, maxBytes: number): BoundedText {
    if (Buffer.byteLength(value, 'utf8') <= maxBytes) {
        return {
            text: value,
            truncated: false,
        }
    }
    let bytes = 0
    let end = 0
    for (const char of value) {
        const nextBytes = bytes + Buffer.byteLength(char, 'utf8')
        if (nextBytes > maxBytes) {
            break
        }
        bytes = nextBytes
        end += char.length
    }
    return {
        text: value.slice(0, end),
        truncated: true,
    }
}
