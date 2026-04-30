let schedulerStarted = false
let schedulerTimer: ReturnType<typeof setInterval> | null = null
let tickPromise: Promise<void> | null = null

async function runSchedulerTick(): Promise<void> {
    if (tickPromise) {
        return tickPromise
    }

    tickPromise = import('./execution-engine')
        .then(({ runDueRoomCronJobs }) => runDueRoomCronJobs({ limit: 10 }))
        .then(() => {})
        .finally(() => {
            tickPromise = null
        })

    return tickPromise
}

export function startRoomCronScheduler(): void {
    if (schedulerStarted) {
        return
    }
    schedulerStarted = true
    void runSchedulerTick().catch((error) => {
        console.error(
            'Room cron scheduler tick failed',
            error instanceof Error ? error.message : error,
        )
    })
    schedulerTimer = setInterval(() => {
        void runSchedulerTick().catch((error) => {
            console.error(
                'Room cron scheduler tick failed',
                error instanceof Error ? error.message : error,
            )
        })
    }, 30000)
    schedulerTimer.unref?.()
}

export function stopRoomCronSchedulerForTests(): void {
    if (schedulerTimer) {
        clearInterval(schedulerTimer)
        schedulerTimer = null
    }
    schedulerStarted = false
    tickPromise = null
}
