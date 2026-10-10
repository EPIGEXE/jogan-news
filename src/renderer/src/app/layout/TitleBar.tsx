import { useEffect, useState } from 'react'
import type { RunProgress } from '@shared/types'
import { api } from '@/common/lib/api'
import { cn } from '@/common/lib/cn'
import { formatKoreanDate } from '@/common/lib/format'
import { progressPercent } from '@/domains/digest/RunProgress'

/** 오른쪽 상태 표시. idle이면 비워 둔다 (색은 트레이 배지와 같다) */
export type TitleStatus = 'idle' | 'busy' | 'new' | 'offline' | 'error'

const STATUS: Record<Exclude<TitleStatus, 'idle'>, { label: string; dot: string }> = {
  busy: { label: '브리핑 만드는 중', dot: 'border-2 border-ink bg-transparent' },
  new: { label: '새 브리핑', dot: 'bg-accent' },
  offline: { label: '연결 대기 중', dot: 'bg-ink-faint' },
  error: { label: '브리핑 생성 실패', dot: 'bg-danger' }
}

interface Props {
  /** 지금 보여주는 브리핑 날짜 (없으면 오늘 날짜) */
  date: string | null
  /** 몇 호째 브리핑인지 */
  issue: number | null
  entries: number | null
  status: TitleStatus
  progress: RunProgress | null
  onStatusClick(): void
}

/**
 * 지면 윗줄(폴리오) 모양의 제목 표시줄 (DESIGN.md 13.10절). Windows 기본 제목 표시줄 대신 쓴다.
 * 왼쪽: 날짜 · 호수 · 기사 수, 오른쪽: 상태와 창 버튼(최소화·최대화·닫기), 아래: 생성 중 진행선.
 * 빈 곳을 끌면 창이 움직이고 더블클릭하면 최대화된다. 창이 비활성이면 글자와 버튼 기호가 흐려진다.
 */
export function TitleBar({ date, issue, entries, status, progress, onStatusClick }: Props) {
  const [focused, setFocused] = useState(() => document.hasFocus())
  useEffect(() => {
    const on = () => setFocused(true)
    const off = () => setFocused(false)
    window.addEventListener('focus', on)
    window.addEventListener('blur', off)
    return () => {
      window.removeEventListener('focus', on)
      window.removeEventListener('blur', off)
    }
  }, [])

  const s = status === 'idle' ? null : STATUS[status]
  const running = status === 'busy' && progress && progress.stage !== 'done' && progress.stage !== 'error'
  const folio = [
    formatKoreanDate(date ?? new Date().toISOString()),
    issue ? `제${issue}호` : null,
    entries !== null ? `기사 ${entries}건` : null
  ].filter(Boolean)

  return (
    <header
      className={cn(
        'app-drag relative flex h-9 flex-none items-center gap-3 overflow-hidden border-b border-rule bg-paper pl-5 select-none',
        'text-caption font-medium tracking-dateline tabular-nums transition-colors duration-200',
        focused ? 'text-ink-muted' : 'text-ink-read'
      )}
    >
      <span className="min-w-0 truncate">{folio.join(' · ')}</span>
      <span className="flex-1" />
      {s && (
        <button
          type="button"
          onClick={onStatusClick}
          title="오늘 화면으로"
          className="app-no-drag flex min-h-6 animate-fade-in cursor-pointer items-center gap-1.5 border-0 bg-transparent px-1 text-caption font-bold text-ink-secondary hover:text-ink"
        >
          <span aria-hidden="true" className={cn('size-2 flex-none rounded-full', s.dot, status === 'busy' && 'animate-ink-breathe')} />
          {s.label}
        </button>
      )}
      <WindowButtons focused={focused} />
      {/* 생성 중 진행선: 아래 괘선 위로 잉크가 번지듯 채워진다 */}
      {running && (
        <span
          aria-hidden="true"
          className="absolute -bottom-px left-0 h-0.5 bg-accent transition-[width] duration-300 ease-ink"
          // 진행률은 실행 중에 바뀌는 값이라 인라인 style로 준다
          style={{ width: `${progressPercent(progress)}%` }}
        />
      )}
    </header>
  )
}

/** 창 버튼 기호: 1px 먹선. 화면 배율과 상관없이 선명하게 crispEdges로 그린다 */
function Glyph({ kind }: { kind: 'minimize' | 'maximize' | 'restore' | 'close' }) {
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

const WINDOW_BUTTON =
  'app-no-drag flex h-9 w-11.5 cursor-default items-center justify-center border-0 bg-transparent text-current transition-colors duration-120'

/** 최소화 · 최대화(복원) · 닫기. 닫기는 앱을 끄지 않고 트레이로 숨긴다 */
function WindowButtons({ focused }: { focused: boolean }) {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    void api.windowIsMaximized().then(setMaximized)
    return api.onWindowMaximizedChanged(setMaximized)
  }, [])
  return (
    <div className={cn('flex self-stretch transition-colors duration-200', focused ? 'text-ink' : 'text-ink-read')}>
      <button
        type="button"
        title="최소화"
        aria-label="최소화"
        onClick={() => void api.windowMinimize()}
        className={cn(WINDOW_BUTTON, 'hover:bg-paper-sunken')}
      >
        <Glyph kind="minimize" />
      </button>
      <button
        type="button"
        title={maximized ? '이전 크기로' : '최대화'}
        aria-label={maximized ? '이전 크기로' : '최대화'}
        onClick={() => void api.windowToggleMaximize()}
        className={cn(WINDOW_BUTTON, 'hover:bg-paper-sunken')}
      >
        <Glyph kind={maximized ? 'restore' : 'maximize'} />
      </button>
      <button
        type="button"
        title="닫기 (트레이에 남아 있음)"
        aria-label="닫기"
        onClick={() => void api.windowClose()}
        className={cn(WINDOW_BUTTON, 'hover:bg-danger hover:text-ink-inverse')}
      >
        <Glyph kind="close" />
      </button>
    </div>
  )
}
