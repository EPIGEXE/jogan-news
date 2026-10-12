// ============================================================================
// 앱 최상위 컴포넌트
//
// [역할]
// - 제목 표시줄 · 왼쪽 메뉴 · 현재 화면을 한 창에 배치 (현재 화면은 라우터가 주소에 맞춰 표시)
// - 화면 이동 처리 (메뉴 클릭 · Main의 화면 이동 요청 · 뒤로 / 앞으로)
// - 브리핑 생성 상황을 제목 표시줄에 표시할 상태로 정리
// ============================================================================
import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import type { Route } from '@shared/ipc'
import { BudgetMeter } from '@/common/ui/Notice'
import { ShortcutHelp } from '@/app/global/ShortcutHelp'
import { TitleBar, type TitleStatus } from '@/app/layout/TitleBar'
import { Toaster } from '@/app/global/Toaster'
import { AppShell } from '@/common/layout/AppShell'
import { NavRail, type NavItem } from '@/app/layout/NavRail'
import { api } from '@/common/lib/api'
import { paths } from '@/common/lib/paths'
import { useUsageQuery } from '@/common/lib/useUsageQuery'
import { useDigestListQuery } from '@/domains/digest/queries'
import { useDigest } from '@/domains/digest/useDigest'

/**
 * 앱 화면 전체 (제목 표시줄 + 메뉴 + 현재 화면)
 *
 * @returns {JSX.Element} 창 전체를 채우는 화면
 */
export function App() {
    // =============================== 훅 ===================================
    const navigate = useNavigate()
    const route = (useLocation().pathname.split('/')[1] || 'today') as Route // 지금 보여주는 화면 (주소의 첫 마디)
    const digestState = useDigest() // 최신 브리핑과 생성 진행 상황
    const usage = useUsageQuery().data ?? null // 이번 달 · 오늘 LLM 사용액 (메뉴 아래 비용 표시용)

    // =============================== 쿼리 훅 ===================================
    const issue = useDigestListQuery().data?.length || null // 지금까지 발행한 브리핑 수

    // =============================== 상태 ===================================
    const [shortcutsOpen, setShortcutsOpen] = useState(false) // 단축키 안내 대화상자 열림 여부
    const [newArrived, setNewArrived] = useState(false) // 다른 화면을 보는 동안 새 브리핑이 도착했는지

    // =============================== Ref ===================================
    const wasRunning = useRef(digestState.isRunning) // 직전 렌더에서 생성 중이었는지, 생성이 끝난 순간을 알아내는 용도

    // =============================== 계산 ===================================
    const waitingNetwork = digestState.isRunning && !!digestState.runProgress?.message.includes('네트워크') // 생성 중 네트워크 연결을 기다리는 상태인지 (진행 메시지로 판단)

    // 우선순위: 생성 중(네트워크 대기 · 진행) → 오류 → 새 브리핑 도착 → 평소
    const titleStatus: TitleStatus = digestState.isRunning
        ? waitingNetwork
            ? 'offline'
            : 'busy'
        : digestState.errorMessage
          ? 'error'
          : newArrived
            ? 'new'
            : 'idle'

    // 메뉴 위쪽 항목 (오늘에는 기사 수 표시)
    const items: NavItem[] = [
        { route: 'today', label: '오늘', count: digestState.digest?.entries.length },
        { route: 'library', label: '라이브러리' },
        { route: 'archive', label: '아카이브' },
        { route: 'ask', label: '질문' }
    ]

    // 메뉴 아래쪽 항목 (진단 화면은 메뉴에 없고 설정 화면에서 진입)
    const footerItems: NavItem[] = [
        { route: 'sources', label: '출처' },
        { route: 'settings', label: '설정' }
    ]

    const goTo = (targetRoute: Route) => void navigate(paths.of(targetRoute))

    // =============================== useEffect ===================================
    // 오늘 화면이 아닌 곳에서 생성이 오류 없이 끝나면 "새 브리핑 도착" 표시
    useEffect(() => {
        if (wasRunning.current && !digestState.isRunning && !digestState.errorMessage && route !== 'today') setNewArrived(true)
        wasRunning.current = digestState.isRunning
    }, [digestState.isRunning, digestState.errorMessage, route])

    // 오늘 화면으로 돌아오면 도착 표시 해제
    useEffect(() => {
        if (route === 'today') setNewArrived(false)
    }, [route])

    // Main의 화면 이동 요청 구독 (알림 클릭 · 트레이 메뉴)
    useEffect(() => api.onNavigate((requestedRoute) => void navigate(paths.of(requestedRoute))), [navigate])

    // 뒤로 · 앞으로: Alt+← / Alt+→, 마우스 옆 버튼
    useEffect(() => {
        const onKey = (keyboardEvent: KeyboardEvent) => {
            if (!keyboardEvent.altKey || keyboardEvent.ctrlKey || keyboardEvent.shiftKey || keyboardEvent.metaKey) return
            if (keyboardEvent.key === 'ArrowLeft') navigate(-1)
            else if (keyboardEvent.key === 'ArrowRight') navigate(1)
            else return
            keyboardEvent.preventDefault()
        }
        const onMouse = (mouseEvent: MouseEvent) => {
            if (mouseEvent.button === 3)
                navigate(-1) // 마우스 뒤로 버튼
            else if (mouseEvent.button === 4) navigate(1) // 마우스 앞으로 버튼
        }
        window.addEventListener('keydown', onKey)
        window.addEventListener('mouseup', onMouse)
        return () => {
            window.removeEventListener('keydown', onKey)
            window.removeEventListener('mouseup', onMouse)
        }
    }, [navigate])

    return (
        <div className="flex h-full flex-col">
			{/* 제목 표시줄 */}
            <TitleBar
                date={digestState.digest?.date ?? null}
                issueNumber={issue}
                entryCount={digestState.digest?.entries.length ?? null}
                status={titleStatus}
                runProgress={digestState.runProgress}
                onStatusClick={() => goTo('today')} // 상태 표시를 누르면 오늘 화면으로 이동
            />
			
			{/* 메인 컨테이너 */}
            <div className="min-h-0 flex-1">
                <AppShell
                    nav={
                        <NavRail
                            mainItems={items}
                            footerItems={footerItems}
                            currentRoute={route}
                            onNavigate={goTo}
                            footerContent={
                                <>
                                    <BudgetMeter usage={usage} />
                                    <button
                                        type="button"
                                        onClick={() => setShortcutsOpen(true)}
                                        title="단축키 안내 열기 (?)"
                                        className="flex min-h-6 cursor-pointer items-center gap-1.5 self-start border-0 bg-transparent p-0 text-caption text-ink-muted hover:text-ink hover:underline hover:underline-offset-3"
                                    >
                                        <kbd className="rounded-control border border-control-border px-1 font-body text-caption">?</kbd>
                                        단축키
                                    </button>
                                </>
                            }
                        />
                    }
                >
                    <Toaster />
                    <ShortcutHelp open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
                    {/* 주소에 맞는 화면. 오늘 · 질문 화면이 브리핑과 생성 진행 상황을 함께 쓰도록 넘겨줌 */}
                    <Outlet context={digestState} />
                </AppShell>
            </div>
        </div>
    )
}
