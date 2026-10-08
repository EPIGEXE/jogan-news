import { useCallback, useEffect, useRef, useState } from 'react'
import type { Route } from '@shared/ipc'
import type { UsageSummary } from '@shared/types'
import { BudgetMeter } from './components/app/Notice'
import { ShortcutHelp } from './components/app/ShortcutHelp'
import { TitleBar, type TitleStatus } from './components/app/TitleBar'
import { Toaster } from './components/app/Toaster'
import { AppShell } from './components/layout/AppShell'
import { NavRail, type NavItem } from './components/layout/NavRail'
import { api } from './lib/api'
import { useDigest } from './lib/useDigest'
import { ArchivePage } from './pages/ArchivePage'
import { AskPage } from './pages/AskPage'
import { DiagnosticsPage } from './pages/DiagnosticsPage'
import { LibraryPage } from './pages/LibraryPage'
import { SettingsPage } from './pages/SettingsPage'
import { TodayPage } from './pages/TodayPage'

export function App() {
  const [route, setRoute] = useState<Route>('today')
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  // 질문 화면의 인용을 누르면 오늘 화면에서 그 기사를 연다
  const [focusItemId, setFocusItemId] = useState<number | null>(null)
  const digest = useDigest()

  const refreshUsage = useCallback(() => void api.getUsage().then(setUsage), [])

  // 제목 표시줄: 몇 호째인지, 다른 화면을 보는 동안 새 브리핑이 도착했는지
  const [issue, setIssue] = useState<number | null>(null)
  const digestId = digest.digest?.id
  useEffect(() => {
    void api.listDigests().then((list) => setIssue(list.length || null))
  }, [digestId])
  const [newArrived, setNewArrived] = useState(false)
  const wasRunning = useRef(digest.running)
  useEffect(() => {
    if (wasRunning.current && !digest.running && !digest.error && route !== 'today') setNewArrived(true)
    wasRunning.current = digest.running
  }, [digest.running, digest.error, route])
  useEffect(() => {
    if (route === 'today') setNewArrived(false)
  }, [route])
  const waitingNetwork = digest.running && !!digest.progress?.message.includes('네트워크')
  const titleStatus: TitleStatus = digest.running
    ? waitingNetwork
      ? 'offline'
      : 'busy'
    : digest.error
      ? 'error'
      : newArrived
        ? 'new'
        : 'idle'

  useEffect(() => {
    refreshUsage()
    return api.onNavigate(setRoute)
  }, [refreshUsage])

  // 생성이 끝나면 비용 표시를 갱신한다
  useEffect(() => {
    if (digest.progress?.stage === 'done') refreshUsage()
  }, [digest.progress, refreshUsage])

  const items: NavItem[] = [
    { route: 'today', label: '오늘', count: digest.digest?.entries.length },
    { route: 'library', label: '라이브러리' },
    { route: 'archive', label: '아카이브' },
    { route: 'ask', label: '질문' }
  ]
  const footerItems: NavItem[] = [{ route: 'settings', label: '설정' }]

  return (
    <div className="flex h-full flex-col">
      <TitleBar
        date={digest.digest?.date ?? null}
        issue={issue}
        entries={digest.digest?.entries.length ?? null}
        status={titleStatus}
        progress={digest.progress}
        onStatusClick={() => setRoute('today')}
      />
      <div className="min-h-0 flex-1">
        <AppShell
          nav={
            <NavRail
              items={items}
              footerItems={footerItems}
              current={route}
              onNavigate={setRoute}
              footer={
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
          {route === 'today' && (
            <TodayPage state={digest} onNavigate={setRoute} focusItemId={focusItemId} onFocusHandled={() => setFocusItemId(null)} />
          )}
          {route === 'library' && <LibraryPage />}
          {route === 'archive' && <ArchivePage />}
          {route === 'ask' && (
            <AskPage
              digest={digest.digest}
              onOpenItem={(itemId) => {
                setFocusItemId(itemId)
                setRoute('today')
              }}
            />
          )}
          {route === 'settings' && <SettingsPage onNavigate={setRoute} onUsageChanged={refreshUsage} />}
          {route === 'diagnostics' && <DiagnosticsPage />}
        </AppShell>
      </div>
    </div>
  )
}
