import { useEffect, useRef, useState } from 'react'
import type { Route } from '@shared/ipc'
import { BudgetMeter } from '@/common/ui/Notice'
import { ShortcutHelp } from '@/app/global/ShortcutHelp'
import { TitleBar, type TitleStatus } from '@/app/layout/TitleBar'
import { Toaster } from '@/app/global/Toaster'
import { AppShell } from '@/common/layout/AppShell'
import { NavRail, type NavItem } from '@/app/layout/NavRail'
import { api } from '@/common/lib/api'
import { useUsage } from '@/common/lib/useUsage'
import { useDigest, useDigestList } from '@/domains/digest/useDigest'
import { ArchivePage } from '@/screens/archive/page'
import { AskPage } from '@/screens/ask/page'
import { DiagnosticsPage } from '@/screens/diagnostics/page'
import { LibraryPage } from '@/screens/library/page'
import { SettingsPage } from '@/screens/settings/page'
import { SourcesPage } from '@/screens/sources/page'
import { TodayPage } from '@/screens/today/page'

export function App() {
  const [route, setRoute] = useState<Route>('today')
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  // 질문 화면의 인용을 누르면 오늘 화면에서 그 기사를 연다
  const [focusItemId, setFocusItemId] = useState<number | null>(null)
  const digest = useDigest()

  const usage = useUsage().data ?? null

  // 제목 표시줄: 몇 호째인지, 다른 화면을 보는 동안 새 브리핑이 도착했는지
  const issue = useDigestList().data?.length || null
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

  useEffect(() => api.onNavigate(setRoute), [])

  const items: NavItem[] = [
    { route: 'today', label: '오늘', count: digest.digest?.entries.length },
    { route: 'library', label: '라이브러리' },
    { route: 'archive', label: '아카이브' },
    { route: 'ask', label: '질문' }
  ]
  const footerItems: NavItem[] = [
    { route: 'sources', label: '출처' },
    { route: 'settings', label: '설정' }
  ]

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
          {route === 'sources' && <SourcesPage />}
          {route === 'settings' && <SettingsPage onNavigate={setRoute} />}
          {route === 'diagnostics' && <DiagnosticsPage />}
        </AppShell>
      </div>
    </div>
  )
}
