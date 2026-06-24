export function timingSafeEqualString(left: string, right: string): boolean {
    const encoder = new TextEncoder()
    const leftBytes = encoder.encode(left)
    const rightBytes = encoder.encode(right)
    let diff = leftBytes.length ^ rightBytes.length
    const length = Math.max(leftBytes.length, rightBytes.length)
    for (let index = 0; index < length; index += 1) {
        diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0)
    }
    return diff === 0
}

export function timingSafeEqualHex(left: string, right: string): boolean {
    return timingSafeEqualString(left.toLowerCase(), right.toLowerCase())
}
