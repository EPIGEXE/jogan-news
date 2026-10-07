import { useEffect, useState } from 'react'
import type { DiagEvent, NetCheckResult, TriggerState } from '@shared/ipc'
import { SinglePane } from '../components/layout/AppShell'
import { PageBody, PageSection, PageTitle, Row } from '../components/layout/Page'
import { Button } from '../components/ui/Button'
import { Help } from '../components/ui/Text'
import { api } from '../lib/api'

// 이 PC에서 데스크톱 기능과 네트워크가 동작하는지 확인하는 화면 (0단계에서 만든 진단 도구)

const KIND_LABEL: Record<string, string> = {
  ready: '앱 준비',
  'app-start': '앱 시작',
  'lock-screen': '화면 잠금',
  suspend: '절전 진입',
  'trigger:startup': '트리거: 앱 시작',
  'trigger:unlock': '트리거: 잠금 해제',
  'trigger:resume': '트리거: 절전 복귀',
  'trigger:timer': '트리거: 오전 타이머',
  'trigger:manual': '트리거: 수동',
  'generate-start': '생성 시작',
  'generate-done': '생성 완료',
  'generate-failed': '생성 실패',
  'generate-offline': '오프라인으로 중단',
  'notification-shown': '알림 표시',
  'notification-click': '알림 클릭',
  'notification-failed': '알림 실패',
  autostart: '자동 시작',
  'worker-warn': 'Worker 경고',
  'worker-error': 'Worker 오류',
  'worker-exit': 'Worker 종료'
}

function fmt(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })} ${d.toLocaleTimeString('ko-KR')}`
}

function Definition({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <dt className="w-30 flex-none text-ink-muted">{term}</dt>
      <dd className="m-0 tabular-nums">{children}</dd>
    </div>
  )
}

const cell = 'border-t border-rule p-2 text-left align-top'

export function DiagnosticsPage() {
  const [events, setEvents] = useState<DiagEvent[]>([])
  const [trigger, setTrigger] = useState<TriggerState | null>(null)
  const [net, setNet] = useState<NetCheckResult[] | null>(null)
  const [netRunning, setNetRunning] = useState(false)

  useEffect(() => {
    void api.getEvents().then(setEvents)
    void api.getTriggerState().then(setTrigger)
    return api.onEvent((e) => setEvents((prev) => [...prev, e]))
  }, [])

  const runNet = async () => {
    setNetRunning(true)
    try {
      setNet(await api.runNetworkChecks())
    } finally {
      setNetRunning(false)
    }
  }

  const targets = net ? [...new Set(net.map((r) => r.target))] : []

  return (
    <SinglePane label="진단">
      <PageBody>
        <PageTitle>진단</PageTitle>

        <PageSection title="생성 트리거">
          {trigger && (
            <dl className="m-0 flex flex-col gap-1">
              <Definition term="오늘">{trigger.today}</Definition>
              <Definition term="마지막 생성">{trigger.lastDigestDate ?? '없음'}</Definition>
              <Definition term="다음 오전 타이머">{trigger.nextTimerAt ? fmt(trigger.nextTimerAt) : '-'}</Definition>
              <Definition term="규칙">
                {trigger.dayStartHour}시 이후 로그인·잠금 해제 시, 또는 켜둔 채 {trigger.morningHour}시가 되면 하루 한 번
              </Definition>
            </dl>
          )}
          <Row>
            <Button onClick={() => void api.testNotification()}>알림 테스트</Button>
          </Row>
        </PageSection>

        <PageSection
          title="네트워크"
          aside={
            <Button onClick={() => void runNet()} disabled={netRunning}>
              {netRunning ? '확인 중…' : '점검 실행'}
            </Button>
          }
        >
          <Help>같은 주소를 Node 방식과 Electron 방식(Windows 프록시·인증서 사용)으로 각각 호출합니다.</Help>
          {net && (
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['대상', 'Node fetch', 'Electron net.fetch'].map((h) => (
                    <th key={h} className={`${cell} text-meta font-semibold text-ink-muted`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {targets.map((t) => (
                  <tr key={t}>
                    <td className={cell}>{t}</td>
                    {(['node-fetch', 'electron-net'] as const).map((m) => {
                      const r = net.find((x) => x.target === t && x.method === m)
                      return (
                        <td key={m} className={cell}>
                          {r && (
                            <>
                              <span className={r.ok ? 'font-bold text-ink' : 'font-bold text-danger'}>
                                {r.ok ? '정상' : '실패'} {r.status ?? ''}
                              </span>{' '}
                              · {r.ms}ms
                              {r.error && <span className="block break-all text-caption text-ink-faint">{r.error}</span>}
                            </>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </PageSection>

        <PageSection title="이벤트 기록">
          <ol className="m-0 max-h-90 list-none overflow-auto p-0">
            {[...events].reverse().map((e, i) => (
              <li key={`${e.at}-${i}`} className="flex gap-3 border-t border-rule-soft py-1 text-meta">
                <time className="whitespace-nowrap text-ink-faint tabular-nums">{fmt(e.at)}</time>
                <span className="whitespace-nowrap font-bold">{KIND_LABEL[e.kind] ?? e.kind}</span>
                {e.detail && <span className="text-ink-muted">{e.detail}</span>}
              </li>
            ))}
          </ol>
        </PageSection>
      </PageBody>
    </SinglePane>
  )
}
