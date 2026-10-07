import { useCallback, useEffect, useState } from 'react'
import type { Route } from '@shared/ipc'
import type { UsageSummary } from '@shared/types'
import { BudgetMeter } from './components/app/Notice'
import { AppShell } from './components/layout/AppShell'
import { NavRail, type NavItem } from './components/layout/NavRail'
import { api } from './lib/api'
import { useDigest } from './lib/useDigest'
import { ArchivePage } from './pages/ArchivePage'
import { DevComponentsPage } from './pages/DevComponentsPage'
import { DiagnosticsPage } from './pages/DiagnosticsPage'
import { LibraryPage } from './pages/LibraryPage'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { SettingsPage } from './pages/SettingsPage'
import { TodayPage } from './pages/TodayPage'

export function App() {
  const [route, setRoute] = useState<Route>(() => (location.hash === '#dev' ? 'dev-components' : 'today'))
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const digest = useDigest()

  const refreshUsage = useCallback(() => void api.getUsage().then(setUsage), [])

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
  const footerItems: NavItem[] = [
    { route: 'settings', label: '설정' },
    ...(import.meta.env.DEV ? [{ route: 'dev-components' as const, label: '부품 견본' }] : [])
  ]

  return (
    <AppShell
      nav={
        <NavRail
          items={items}
          footerItems={footerItems}
          current={route}
          onNavigate={setRoute}
          footer={<BudgetMeter usage={usage} />}
        />
      }
    >
      {route === 'today' && <TodayPage state={digest} onNavigate={setRoute} />}
      {route === 'library' && <LibraryPage />}
      {route === 'archive' && <ArchivePage />}
      {route === 'ask' && (
        <PlaceholderPage title="질문" stage="4단계">
          오늘 브리핑이나 내 라이브러리 전체를 범위로 AI에게 질문하는 화면입니다.
        </PlaceholderPage>
      )}
      {route === 'settings' && <SettingsPage onNavigate={setRoute} onUsageChanged={refreshUsage} />}
      {route === 'diagnostics' && <DiagnosticsPage />}
      {route === 'dev-components' && <DevComponentsPage />}
    </AppShell>
  )
}
