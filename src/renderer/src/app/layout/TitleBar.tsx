// ============================================================================
// 제목 표시줄
//
// [역할]
// - Windows 기본 제목 표시줄 대신 쓰는 지면 윗줄(폴리오) 모양의 표시줄
// - 왼쪽에 날짜 · 호수 · 기사 수, 오른쪽에 브리핑 상태와 창 버튼 표시
// - 브리핑 생성 중에는 아래 괘선 위에 진행선 표시
// - 창 끌기 · 최소화 · 최대화 · 닫기 처리 (닫기는 앱을 끄지 않고 트레이로 숨김)
// ============================================================================
import { useEffect, useState } from 'react'
import type { RunProgress } from '@shared/types'
import { useWindowMaximizedQuery } from '@/app/layout/useWindowMaximizedQuery'
import { api } from '@/common/lib/api'
import { cn } from '@/common/lib/cn'
import { formatKoreanDate, todayKey } from '@/common/lib/format'
import { progressPercent } from '@/domains/digest/RunProgress'

// 오른쪽 상태 표시 종류 (idle이면 비워 둠, 색은 트레이 배지와 같음)
export type TitleStatus = 'idle' | 'busy' | 'new' | 'offline' | 'error'

// 상태별 문구와 점 모양
const STATUS_DISPLAY: Record<Exclude<TitleStatus, 'idle'>, { label: string; dot: string }> = {
    busy: { label: '브리핑 만드는 중', dot: 'border-2 border-ink bg-transparent' },
    new: { label: '새 브리핑', dot: 'bg-accent' },
    offline: { label: '연결 대기 중', dot: 'bg-ink-faint' },
    error: { label: '브리핑 생성 실패', dot: 'bg-danger' }
}

interface Props {
    date: string | null // 지금 보여주는 브리핑 날짜 (없으면 오늘 날짜)
    issueNumber: number | null // 몇 호째 브리핑인지
    entryCount: number | null // 브리핑의 기사 수
    status: TitleStatus
    runProgress: RunProgress | null // 브리핑 생성 진행 상황
    onStatusClick(): void
}

/**
 * 지면 윗줄(폴리오) 모양의 제목 표시줄 (DESIGN.md 13.10절)
 *
 * - 왼쪽: 날짜 · 호수 · 기사 수
 * - 오른쪽: 상태와 창 버튼 (최소화 · 최대화 · 닫기)
 * - 아래: 생성 중 진행선
 * - 빈 곳을 끌면 창 이동, 더블클릭하면 최대화
 * - 창이 비활성이면 글자와 버튼 기호를 흐리게 표시
 *
 * @returns {JSX.Element} 창 맨 위의 표시줄
 */
export function TitleBar({ date, issueNumber, entryCount, status, runProgress, onStatusClick }: Props) {
    // =============================== 상태 ===================================
    const [focused, setFocused] = useState(() => document.hasFocus()) // 창이 활성 상태인지

    // =============================== 계산 ===================================
    const statusDisplay = status === 'idle' ? null : STATUS_DISPLAY[status] // 지금 상태의 문구와 점 모양 (idle이면 null)
    const showProgressLine = status === 'busy' && runProgress && runProgress.stage !== 'done' && runProgress.stage !== 'error' // 진행선을 보여줄지

    // 왼쪽에 이어 붙여 보여줄 글 (값이 없는 항목은 제외)
    const folioParts = [
        formatKoreanDate(date ?? todayKey()), // 브리핑이 아직 없으면 오늘 날짜
        issueNumber ? `제${issueNumber}호` : null,
        entryCount !== null ? `기사 ${entryCount}건` : null
    ].filter(Boolean)

    // =============================== useEffect ===================================
    // 창 활성 · 비활성 전환 구독
    useEffect(() => {
        const onWindowFocus = () => setFocused(true)
        const onWindowBlur = () => setFocused(false)
        window.addEventListener('focus', onWindowFocus)
        window.addEventListener('blur', onWindowBlur)
        return () => {
            window.removeEventListener('focus', onWindowFocus)
            window.removeEventListener('blur', onWindowBlur)
        }
    }, [])

    return (
        <header
            className={cn(
                'app-drag relative flex h-9 flex-none items-center gap-3 overflow-hidden border-b border-rule bg-paper pl-5 select-none',
                'text-caption font-medium tracking-dateline tabular-nums transition-colors duration-200',
                focused ? 'text-ink-muted' : 'text-ink-read'
            )}
        >
            {/* 날짜 · 호수 · 기사 수 */}
            <span className="min-w-0 truncate">{folioParts.join(' · ')}</span>
            <span className="flex-1" />

            {/* 브리핑 상태 */}
            {statusDisplay && (
                <button
                    type="button"
                    onClick={onStatusClick}
                    title="오늘 화면으로"
                    className="app-no-drag flex min-h-6 animate-fade-in cursor-pointer items-center gap-1.5 border-0 bg-transparent px-1 text-caption font-bold text-ink-secondary hover:text-ink"
                >
                    <span
                        aria-hidden="true"
                        className={cn('size-2 flex-none rounded-full', statusDisplay.dot, status === 'busy' && 'animate-ink-breathe')}
                    />
                    {statusDisplay.label}
                </button>
            )}

            {/* 창 버튼 */}
            <WindowButtons isWindowFocused={focused} />

            {/* 생성 중 진행선 (아래 괘선 위로 잉크가 번지듯 채워짐) */}
            {showProgressLine && (
                <span
                    aria-hidden="true"
                    className="absolute -bottom-px left-0 h-0.5 bg-accent transition-[width] duration-300 ease-ink"
                    // 진행률은 실행 중에 바뀌는 값이라 인라인 style 사용
                    style={{ width: `${progressPercent(runProgress)}%` }}
                />
            )}
        </header>
    )
}

// 창 버튼 기호 (1px 먹선, 화면 배율과 상관없이 선명하도록 crispEdges로 그림)
function WindowButtonGlyph({ kind }: { kind: 'minimize' | 'maximize' | 'restore' | 'close' }) {
    return (
        <svg
            aria-hidden="true"
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            shapeRendering="crispEdges"
        >
            {kind === 'minimize' && <path d="M0 5.5h10" />}
            {kind === 'maximize' && <rect x="0.5" y="0.5" width="9" height="9" />}
            {kind === 'restore' && (
                <>
                    <rect x="0.5" y="2.5" width="7" height="7" />
                    <path d="M2.5 2.5V0.5h7v7h-2" />
                </>
            )}
            {kind === 'close' && <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" shapeRendering="geometricPrecision" />}
        </svg>
    )
}

// 창 버튼 세 개가 함께 쓰는 모양
const WINDOW_BUTTON_CLASS =
    'app-no-drag flex h-9 w-11.5 cursor-default items-center justify-center border-0 bg-transparent text-current transition-colors duration-120'

// 최소화 · 최대화(복원) · 닫기 버튼 (닫기는 앱을 끄지 않고 트레이로 숨김)
function WindowButtons({ isWindowFocused }: { isWindowFocused: boolean }) {
    const maximized = useWindowMaximizedQuery() // 창이 최대화돼 있는지

    return (
        <div className={cn('flex self-stretch transition-colors duration-200', isWindowFocused ? 'text-ink' : 'text-ink-read')}>
            <button
                type="button"
                title="최소화"
                aria-label="최소화"
                onClick={() => void api.windowMinimize()}
                className={cn(WINDOW_BUTTON_CLASS, 'hover:bg-paper-sunken')}
            >
                <WindowButtonGlyph kind="minimize" />
            </button>
            <button
                type="button"
                title={maximized ? '이전 크기로' : '최대화'}
                aria-label={maximized ? '이전 크기로' : '최대화'}
                onClick={() => void api.windowToggleMaximize()}
                className={cn(WINDOW_BUTTON_CLASS, 'hover:bg-paper-sunken')}
            >
                <WindowButtonGlyph kind={maximized ? 'restore' : 'maximize'} />
            </button>
            <button
                type="button"
                title="닫기 (트레이에 남아 있음)"
                aria-label="닫기"
                onClick={() => void api.windowClose()}
                className={cn(WINDOW_BUTTON_CLASS, 'hover:bg-danger hover:text-ink-inverse')}
            >
                <WindowButtonGlyph kind="close" />
            </button>
        </div>
    )
}
