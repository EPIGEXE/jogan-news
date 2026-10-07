import type { Route } from '@shared/ipc'
import { ErrorNotice, EmptyState } from '../components/app/Notice'
import { RunProgress } from '../components/app/RunProgress'
import { SinglePane } from '../components/layout/AppShell'
import { Button } from '../components/ui/Button'
import { todayKey } from '../lib/format'
import type { DigestState } from '../lib/useDigest'
import { DigestView } from '../views/DigestView'

/** 오늘: 최신 브리핑. 아직 없으면 만들기 안내와 진행 상황 */
export function TodayPage({ state, onNavigate }: { state: DigestState; onNavigate(route: Route): void }) {
  const { digest, loading, running, progress, error, runNow, patchEntry } = state

  if (loading) return <SinglePane label="오늘">{null}</SinglePane>

  if (!digest) {
    return (
      <SinglePane label="오늘">
        <div className="max-w-180 px-7 py-6">
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
          <div className="flex flex-col gap-4">
            {running && progress && <RunProgress progress={progress} />}
            {error && (
              <ErrorNotice>
                {error}{' '}
                {error.includes('API 키') && (
                  <Button variant="text" onClick={() => onNavigate('settings')}>
                    설정으로 이동
                  </Button>
                )}
              </ErrorNotice>
            )}
          </div>
        </div>
      </SinglePane>
    )
  }

  const isToday = digest.date === todayKey()

  return (
    <DigestView
      digest={digest}
      onPatch={patchEntry}
      notice={isToday ? undefined : '오늘 브리핑이 아직 없어 지난 브리핑을 보여줍니다'}
      headerActions={
        <div className="mt-1 flex flex-wrap items-center gap-3">
          {running && progress ? (
            <div className="min-w-0 flex-1">
              <RunProgress progress={progress} />
            </div>
          ) : (
            <Button variant="text" onClick={runNow}>
              {isToday ? '다시 만들기' : '오늘 브리핑 만들기'}
            </Button>
          )}
        </div>
      }
      belowHeader={error && !running ? <ErrorNotice>{error}</ErrorNotice> : undefined}
    />
  )
}
