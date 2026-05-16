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
    let low = 0
    let high = value.length
    while (low < high) {
        const mid = Math.ceil((low + high) / 2)
        if (Buffer.byteLength(value.slice(0, mid), 'utf8') <= maxBytes) {
            low = mid
        } else {
            high = mid - 1
        }
    }
    return {
        text: value.slice(0, low),
        truncated: true,
    }
}
