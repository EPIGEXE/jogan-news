import { useEffect, useRef, useState } from 'react'
import type { Route } from '@shared/ipc'
import { ErrorNotice, EmptyState } from '@/common/ui/Notice'
import { RunProgress } from '@/domains/digest/RunProgress'
import { SinglePane } from '@/common/layout/AppShell'
import { Button } from '@/common/ui/Button'
import { SkeletonLine, SkeletonList } from '@/common/ui/Skeleton'
import { todayKey } from '@/common/lib/format'
import type { DigestState } from '@/domains/digest/useDigest'
import { DigestView } from '@/domains/digest/DigestView'

interface Props {
  state: DigestState
  onNavigate(route: Route): void
  focusItemId?: number | null
  onFocusHandled?(): void
}

/** 오늘: 최신 브리핑. 아직 없으면 만들기 안내와 진행 상황 */
export function TodayPage({ state, onNavigate, focusItemId, onFocusHandled }: Props) {
  const { digest, loading, running, progress, error, runNow } = state
  // 이 화면을 보는 중에 생성이 끝나 새 브리핑이 도착했는지 (지면 머리 이중선이 한 번 그어진다)
  const wasRunning = useRef(running)
  const [fresh, setFresh] = useState(false)
  useEffect(() => {
    if (wasRunning.current && !running && !error) setFresh(true)
    wasRunning.current = running
  }, [running, error])

  if (loading) {
    return (
      <SinglePane label="오늘">
        <div className="flex max-w-190 flex-col gap-3 px-7 py-6">
          <SkeletonLine className="w-1/3" />
          <SkeletonLine className="h-8 w-5/6" />
          <SkeletonList />
        </div>
      </SinglePane>
    )
  }

  const errorNotice = error && !running && (
    <ErrorNotice>
      {error}{' '}
      {error.includes('API 키') && (
        <Button variant="text" onClick={() => onNavigate('settings')}>
          설정으로 이동
        </Button>
      )}
    </ErrorNotice>
  )

  if (!digest) {
    return (
      <SinglePane label="오늘">
        <div className="flex max-w-190 flex-col gap-4 px-7 py-6">
          <EmptyState
            title="아직 브리핑이 없습니다"
            action={
              running ? undefined : (
                <Button variant="solid" icon="refresh" onClick={runNow}>
                  지금 브리핑 만들기
                </Button>
              )
            }
          >
            로그인하거나 잠금을 해제하면 하루 한 번 자동으로 만들어집니다. 지금 바로 만들 수도 있습니다.
          </EmptyState>
          {running && progress && <RunProgress progress={progress} />}
          {errorNotice}
        </div>
      </SinglePane>
    )
  }

  const isToday = digest.date === todayKey()

  // 오늘 브리핑이 있으면 다시 만들지 않는다: 같은 날 후보는 거의 같아서 결과도 비슷하고,
  // 낮 동안 쌓인 새 글은 다음 날 브리핑에 들어간다. 오늘 것이 없을 때만 만들기 버튼을 보여준다.
  return (
    <DigestView
      digest={digest}
      focusItemId={focusItemId}
      onFocusHandled={onFocusHandled}
      notice={isToday ? undefined : '오늘 브리핑이 아직 없어 지난 브리핑을 보여줍니다'}
      fresh={fresh}
      headerActions={
        !isToday && !running ? (
          <div className="mt-1">
            <Button variant="solid" icon="refresh" onClick={runNow}>
              오늘 브리핑 만들기
            </Button>
          </div>
        ) : undefined
      }
      belowHeader={
        running && progress ? (
          <div className="pt-4">
            <RunProgress progress={progress} />
          </div>
        ) : errorNotice ? (
          <div className="pt-4">{errorNotice}</div>
        ) : undefined
      }
    />
  )
}
