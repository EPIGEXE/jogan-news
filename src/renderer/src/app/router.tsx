// ============================================================================
// 화면 라우터
//
// [역할]
// - 주소와 화면을 연결 (어느 주소에서 어느 화면을 보여줄지)
// - 기사 읽기 화면 · 아카이브 날짜 · 검색어를 주소에 담아 뒤로 · 앞으로 이동 가능
// - 주소는 # 뒤에 붙는 방식 사용 (설치판은 file://로 열려서 일반 경로 방식이 동작하지 않음)
// ============================================================================
import { createHashRouter, Navigate } from 'react-router'
import { App } from '@/app/App'
import { ArchivePage } from '@/screens/archive/page'
import { AskPage } from '@/screens/ask/page'
import { DiagnosticsPage } from '@/screens/diagnostics/page'
import { LibraryPage } from '@/screens/library/page'
import { SettingsPage } from '@/screens/settings/page'
import { SourcesPage } from '@/screens/sources/page'
import { TodayPage } from '@/screens/today/page'

export const router = createHashRouter([
    {
        path: '/',
        element: <App />, // 제목 표시줄 · 메뉴가 있는 틀 (아래 화면들이 그 안에 표시됨)
        children: [
            { index: true, element: <Navigate to="/today" replace /> }, // 앱을 열면 오늘 화면
            { path: 'today/:itemId?', element: <TodayPage /> }, // 기사 번호가 붙으면 읽기 화면
            { path: 'library/:itemId?', element: <LibraryPage /> },
            { path: 'archive', element: <ArchivePage /> }, // 날짜 목록 (?q=검색어가 붙으면 검색 결과)
            { path: 'archive/search/:itemId', element: <ArchivePage /> }, // 검색 결과에서 연 읽기 화면
            { path: 'archive/:date/:itemId?', element: <ArchivePage /> }, // 그날 브리핑과 그 안의 읽기 화면
            { path: 'ask', element: <AskPage /> },
            { path: 'sources', element: <SourcesPage /> },
            { path: 'settings', element: <SettingsPage /> },
            { path: 'diagnostics', element: <DiagnosticsPage /> },
            { path: '*', element: <Navigate to="/today" replace /> } // 모르는 주소는 오늘 화면으로
        ]
    }
])
