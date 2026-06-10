export async function cancelReadableStreamReader<T>(
    reader: ReadableStreamDefaultReader<T>,
    onError?: (error: unknown) => void,
): Promise<void> {
    try {
        await reader.cancel()
    } catch (error) {
        onError?.(error)
    }
}

export function cancelReadableStreamReaderInBackground<T>(
    reader: ReadableStreamDefaultReader<T>,
    onError?: (error: unknown) => void,
): void {
    void cancelReadableStreamReader(reader, onError)
}
