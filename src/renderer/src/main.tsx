// ============================================================================
// 렌더러 시작점
//
// [역할]
// - 화면(React)을 index.html의 root 자리에 올려 앱 시작
// - 데이터 캐시 · 화면 라우터 연결, 글꼴 · 전역 스타일 불러오기
// ============================================================================
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'
import { QueryProvider } from '@/app/providers/QueryProvider'
import { router } from '@/app/router'
import '@/app/styles/fonts'
import '@/app/styles/app.css'

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <QueryProvider>
            <RouterProvider router={router} />
        </QueryProvider>
    </StrictMode>
)
