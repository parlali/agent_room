import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { LoadingPage } from '#/components/agent-room'
import { RoomDashboardLayout } from '#/components/room-dashboard'
import { roomQueryKey, roomQueryPolicy } from '#/lib/room-query-keys'
import type { RoomRunHistoryEntry } from '#/domain/room-execution-types'

import {
    getRoomExecutionServer,
    getRoomSetupReadinessServer,
    listCronJobsServer,
    listRoomRunHistoryServer,
} from './-room-runtime-server'
import { getRoomConfigServer } from './-operator-config-server'
import {
    LastWorkSummary,
    OperatorDetails,
    OverallBanner,
    RecentRunsSection,
    RunDetailSheet,
} from './-room-status/components'
import { buildOverall, buildStatusChecks, isFailed, isSucceeded } from './-room-status/model'

export const Route = createFileRoute('/rooms/$roomId/status')({
    component: RoomStatusPage,
})

function RoomStatusPage() {
    const { roomId } = Route.useParams()
    const executionQuery = useQuery({
        queryKey: roomQueryKey.roomExecution(roomId),
        queryFn: () => getRoomExecutionServer({ data: { roomId, messageLimit: 0 } }),
        staleTime: roomQueryPolicy.hotStaleMs,
    })
    const configQuery = useQuery({
        queryKey: roomQueryKey.roomConfig(roomId),
        queryFn: () => getRoomConfigServer({ data: { roomId } }),
        staleTime: roomQueryPolicy.warmStaleMs,
    })
    const readinessQuery = useQuery({
        queryKey: roomQueryKey.setupReadiness,
        queryFn: () => getRoomSetupReadinessServer(),
        staleTime: roomQueryPolicy.warmStaleMs,
    })
    const historyQuery = useQuery({
        queryKey: roomQueryKey.roomRunHistory(roomId),
        queryFn: () => listRoomRunHistoryServer({ data: { roomId, limit: 20 } }),
        staleTime: roomQueryPolicy.hotStaleMs,
    })
    const jobsQuery = useQuery({
        queryKey: roomQueryKey.roomCronJobs(roomId),
        queryFn: () => listCronJobsServer({ data: { roomId } }),
        staleTime: roomQueryPolicy.hotStaleMs,
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

    if (initialLoading) {
        return (
            <RoomDashboardLayout roomId={roomId} activeTab="status">
                <LoadingPage />
            </RoomDashboardLayout>
        )
    }

    return (
        <RoomDashboardLayout roomId={roomId} activeTab="status">
            <div className="flex w-full flex-col gap-6">
                <OverallBanner status={overall} roomId={roomId} />
                <RecentRunsSection history={history} onSelect={setSelectedRun} />
                <LastWorkSummary
                    roomId={roomId}
                    lastSuccess={lastSuccess}
                    lastFailure={lastFailure}
                />
                <OperatorDetails checks={checks} roomId={roomId} />
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
