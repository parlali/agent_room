export const hostedRuntimeReadConcurrency = 8

export async function mapWithConcurrency<T, TResult>(
    items: readonly T[],
    limit: number,
    task: (item: T, index: number) => Promise<TResult>,
): Promise<TResult[]> {
    if (!Number.isInteger(limit) || limit < 1) {
        throw new Error('Concurrency limit must be a positive integer')
    }
    const results = new Array<TResult>(items.length)
    let nextIndex = 0
    let failed = false
    const workerCount = Math.min(limit, items.length)
    async function worker(): Promise<void> {
        while (!failed) {
            const index = nextIndex
            nextIndex += 1
            if (index >= items.length) {
                return
            }
            try {
                results[index] = await task(items[index]!, index)
            } catch (error) {
                failed = true
                throw error
            }
        }
    }
    await Promise.all(Array.from({ length: workerCount }, () => worker()))
    return results
}
