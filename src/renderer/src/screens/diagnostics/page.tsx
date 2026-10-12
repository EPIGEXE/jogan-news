// ============================================================================
// 진단 화면
//
// [역할]
// - 이 PC에서 데스크톱 기능과 네트워크가 동작하는지 확인
// - 생성 트리거 상태 표시, 알림 테스트
// - 네트워크 점검 실행과 결과 표시, 이벤트 기록 표시
// ============================================================================
import {
    useDiagEventsQuery,
    useNetworkChecksMutation,
    useTestNotificationMutation,
    useTriggerStateQuery
} from '@/screens/diagnostics/queries'
import { SinglePane } from '@/common/layout/AppShell'
import { PageBody, PageSection, PageTitle, PageRow } from '@/common/layout/Page'
import { Button } from '@/common/ui/Button'
import { HelpText } from '@/common/ui/Text'

// 이벤트 종류 이름을 화면에 보여줄 이름으로 바꾸는 표 (표에 없으면 종류 이름 그대로 표시)
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

// 날짜(월 · 일)와 시각을 한국어 표기로 변환
function formatDateTime(isoTime: string): string {
    const date = new Date(isoTime)
    return `${date.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })} ${date.toLocaleTimeString('ko-KR')}`
}

// 이름과 값 한 쌍 (트리거 상태 목록의 한 줄)
function Definition({ term, children }: { term: string; children: React.ReactNode }) {
    return (
        <div className="flex gap-4">
            <dt className="w-30 flex-none text-ink-muted">{term}</dt>
            <dd className="m-0 tabular-nums">{children}</dd>
        </div>
    )
}

const tableCellClass = 'border-t border-rule p-2 text-left align-top' // 네트워크 점검 표의 칸에 공통으로 쓰는 class

/**
 * 진단 화면 (이 PC에서 데스크톱 기능과 네트워크가 동작하는지 확인)
 *
 * @returns {JSX.Element} 진단 화면
 */
export function DiagnosticsPage() {
    // =============================== 쿼리 훅 ===================================
    const diagEvents = useDiagEventsQuery()
    const triggerState = useTriggerStateQuery().data ?? null
    const { mutate: runNetworkChecks, data: netCheckResults = null, isPending: isNetworkCheckRunning } = useNetworkChecksMutation() // netCheckResults: 점검 결과 (실행 전이면 null)
    const { mutate: testNotification } = useTestNotificationMutation()

    // =============================== 계산 ===================================
    const checkedTargets = netCheckResults ? [...new Set(netCheckResults.map((netCheckResult) => netCheckResult.target))] : [] // 점검한 주소 목록 (중복 제거, 표의 행)

    return (
        <SinglePane label="진단">
            <PageBody>
                <PageTitle>진단</PageTitle>

                {/* 생성 트리거 상태 · 알림 테스트 */}
                <PageSection title="생성 트리거">
                    {triggerState && (
                        <dl className="m-0 flex flex-col gap-1">
                            <Definition term="오늘">{triggerState.today}</Definition>
                            <Definition term="마지막 생성">{triggerState.lastDigestDate ?? '없음'}</Definition>
                            <Definition term="다음 오전 타이머">
                                {triggerState.nextTimerAt ? formatDateTime(triggerState.nextTimerAt) : '-'}
                            </Definition>
                            <Definition term="규칙">
                                {triggerState.dayStartHour}시 이후 로그인·잠금 해제 시, 또는 켜둔 채 {triggerState.morningHour}시가 되면
                                하루 한 번
                            </Definition>
                        </dl>
                    )}
                    <PageRow>
                        <Button onClick={() => testNotification()}>알림 테스트</Button>
                    </PageRow>
                </PageSection>

                {/* 네트워크 점검 (주소마다 두 가지 호출 방식의 결과) */}
                <PageSection
                    title="네트워크"
                    aside={
                        <Button onClick={() => runNetworkChecks()} disabled={isNetworkCheckRunning}>
                            {isNetworkCheckRunning ? '확인 중…' : '점검 실행'}
                        </Button>
                    }
                >
                    <HelpText>같은 주소를 Node 방식과 Electron 방식(Windows 프록시·인증서 사용)으로 각각 호출합니다.</HelpText>
                    {netCheckResults && (
                        <table className="w-full border-collapse">
                            <thead>
                                <tr>
                                    {['대상', 'Node fetch', 'Electron net.fetch'].map((columnTitle) => (
                                        <th key={columnTitle} className={`${tableCellClass} text-meta font-semibold text-ink-muted`}>
                                            {columnTitle}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {checkedTargets.map((target) => (
                                    <tr key={target}>
                                        <td className={tableCellClass}>{target}</td>
                                        {(['node-fetch', 'electron-net'] as const).map((fetchMethod) => {
                                            const netCheckResult = netCheckResults.find(
                                                (candidateResult) =>
                                                    candidateResult.target === target && candidateResult.method === fetchMethod
                                            )
                                            return (
                                                <td key={fetchMethod} className={tableCellClass}>
                                                    {netCheckResult && (
                                                        <>
                                                            <span
                                                                className={
                                                                    netCheckResult.ok ? 'font-bold text-ink' : 'font-bold text-danger'
                                                                }
                                                            >
                                                                {netCheckResult.ok ? '정상' : '실패'} {netCheckResult.status ?? ''}
                                                            </span>{' '}
                                                            · {netCheckResult.ms}ms
                                                            {netCheckResult.error && (
                                                                <span className="block break-all text-caption text-ink-faint">
                                                                    {netCheckResult.error}
                                                                </span>
                                                            )}
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

                {/* 이벤트 기록 (최근 것이 위) */}
                <PageSection title="이벤트 기록">
                    <ol className="m-0 max-h-90 list-none overflow-auto p-0">
                        {[...diagEvents].reverse().map((diagEvent, eventIndex) => (
                            <li key={`${diagEvent.at}-${eventIndex}`} className="flex gap-3 border-t border-rule-soft py-1 text-meta">
                                <time className="whitespace-nowrap text-ink-faint tabular-nums">{formatDateTime(diagEvent.at)}</time>
                                <span className="whitespace-nowrap font-bold">{KIND_LABEL[diagEvent.kind] ?? diagEvent.kind}</span>
                                {diagEvent.detail && <span className="text-ink-muted">{diagEvent.detail}</span>}
                            </li>
                        ))}
                    </ol>
                </PageSection>
            </PageBody>
        </SinglePane>
    )
}
