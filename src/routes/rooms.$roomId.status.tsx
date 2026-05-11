import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { AttentionBanner, LoadingPage } from '#/components/agent-room'
import { RoomDashboardLayout } from '#/components/room-dashboard'
import type { RoomRunHistoryEntry } from '#/lib/room-execution-types'

import {
    getRoomExecutionServer,
    getRoomSetupReadinessServer,
    listCronJobsServer,
    listRoomRunHistoryServer,
} from './-room-runtime-server'
import { getRoomConfigServer } from './-operator-config-server'
import { requireRouteUser } from './-route-auth'
import {
    ChecksSection,
    LastWorkSummary,
    OverallBanner,
    RecentRunsSection,
    RunDetailSheet,
} from './-room-status/components'
import { buildOverall, buildStatusChecks, isFailed, isSucceeded } from './-room-status/model'

export const Route = createFileRoute('/rooms/$roomId/status')({
    beforeLoad: requireRouteUser,
    component: RoomStatusPage,
})

function RoomStatusPage() {
    const { roomId } = Route.useParams()
    const executionQuery = useQuery({
        queryKey: ['room-execution', roomId],
        queryFn: () => getRoomExecutionServer({ data: { roomId } }),
        staleTime: 5_000,
    })
    const configQuery = useQuery({
        queryKey: ['room-config', roomId],
        queryFn: () => getRoomConfigServer({ data: { roomId } }),
        staleTime: 30_000,
    })
    const readinessQuery = useQuery({
        queryKey: ['room-setup-readiness'],
        queryFn: () => getRoomSetupReadinessServer(),
        staleTime: 10_000,
    })
    const historyQuery = useQuery({
        queryKey: ['room-run-history', roomId],
        queryFn: () => listRoomRunHistoryServer({ data: { roomId, limit: 20 } }),
        staleTime: 5_000,
    })
    const jobsQuery = useQuery({
        queryKey: ['room-cron-jobs', roomId],
        queryFn: () => listCronJobsServer({ data: { roomId } }),
        staleTime: 5_000,
    })

    const [selectedRun, setSelectedRun] = useState<RoomRunHistoryEntry | null>(null)

    const initialLoading =
        executionQuery.isLoading ||
        configQuery.isLoading ||
        readinessQuery.isLoading ||
        historyQuery.isLoading ||
        jobsQuery.isLoading

    const execution = executionQuery.data ?? null
    const config = configQuery.data ?? null
    const readiness = readinessQuery.data ?? null
    const history = historyQuery.data?.entries ?? []
    const jobs = jobsQuery.data ?? []

    const overall = useMemo(
        () => buildOverall({ execution, config, readiness, history }),
        [execution, config, readiness, history],
    )
    const checks = useMemo(
        () => buildStatusChecks({ config, readiness, jobs, history }),
        [config, jobs, history, readiness],
    )
    const lastSuccess = useMemo(
        () => history.find((entry) => isSucceeded(entry)) ?? null,
        [history],
    )
    const lastFailure = useMemo(() => history.find((entry) => isFailed(entry)) ?? null, [history])
    const mismatchCount = historyQuery.data?.mismatchCount ?? 0

    if (initialLoading) {
        return (
            <RoomDashboardLayout roomId={roomId} activeTab="status">
                <LoadingPage />
            </RoomDashboardLayout>
        )
    }

    return (
        <RoomDashboardLayout roomId={roomId} activeTab="status">
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
                <OverallBanner status={overall} />
                {mismatchCount > 0 ? (
                    <AttentionBanner
                        tone="attention"
                        title="Some past runs do not match this room"
                        description={`${mismatchCount} ${mismatchCount === 1 ? 'run is' : 'runs are'} hidden because they belong to another room agent.`}
                    />
                ) : null}
                <ChecksSection checks={checks} />
                <RecentRunsSection history={history} onSelect={setSelectedRun} />
                <LastWorkSummary
                    roomId={roomId}
                    lastSuccess={lastSuccess}
                    lastFailure={lastFailure}
                />
            </div>
            <RunDetailSheet
                entry={selectedRun}
                open={selectedRun !== null}
                onOpenChange={(next) => {
                    if (!next) setSelectedRun(null)
                }}
                roomId={roomId}
            />
        </RoomDashboardLayout>
    )
}
