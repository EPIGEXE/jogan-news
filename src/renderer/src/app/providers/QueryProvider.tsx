// ============================================================================
// 화면 데이터 캐시
//
// [역할]
// - 화면이 읽어 온 데이터를 보관하는 캐시를 앱 전체에 제공
// - 시간이 지나도 다시 읽지 않고, 데이터가 바뀔 때만 새로 읽도록 설정 (데이터가 로컬 Worker에서만 옴)
// - Main이 보내는 알림(기사 보강 완료 · 새 브리핑 · 생성 종료)을 받아 해당 데이터 새로 읽기
// ============================================================================
import { useEffect, useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '@/common/lib/api'
import { queryKeys } from '@/common/lib/queryKeys'
import { patchArticle, setEnriching } from '@/domains/article/cache'

// 화면 데이터 캐시 생성
// 데이터는 로컬 Worker(IPC)에서 오고, 바뀌는 때는 우리 동작(저장 · 메모 등)과 Main이 보내는 알림뿐
// 그래서 시간이 지나도 다시 읽지 않고(staleTime 무한) 창 포커스 · 재시도로도 다시 부르지 않음 (바뀌면 그때 무효화)
function createQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: { staleTime: Infinity, gcTime: 10 * 60_000, retry: false, refetchOnWindowFocus: false },
            mutations: { retry: false }
        }
    })
}

// worker가 작업을 통해 DB를 바꾸면 Main에 알리고,
// Main이 보내는 알림을 받아 캐시의 해당 데이터를 새로 읽도록 연결
// 반환한 함수를 부르면 구독 해제
function subscribeMainEvents(queryClient: QueryClient): () => void {
    // 저장 후 보강 · 번역 완료 → 그 기사를 다시 읽고, 새 태그 · 저장 여부를 목록에도 반영
    const unsubscribeItemUpdated = api.onItemUpdated((itemId) => {
        setEnriching(queryClient, itemId, false)
        void queryClient.invalidateQueries({ queryKey: queryKeys.tags })
        void queryClient
            .query({ queryKey: queryKeys.itemDetail(itemId), queryFn: () => api.getItem(itemId), staleTime: 0 })
            .then((itemDetail) => {
                if (itemDetail) patchArticle(queryClient, itemId, { tags: itemDetail.tags, isSaved: itemDetail.isSaved })
            })
    })

    // 새 브리핑이 게시된 경우
    // 브리핑 · 날짜 목록 · 비용 · 출처 통계를 새로 읽기
    const unsubscribeDigestUpdated = api.onDigestUpdated(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.digests })
        void queryClient.invalidateQueries({ queryKey: queryKeys.digestList })
        void queryClient.invalidateQueries({ queryKey: queryKeys.usage })
        void queryClient.invalidateQueries({ queryKey: queryKeys.allSourceStats })
    })

    // 생성 종료 → 비용이 바뀌므로 새로 읽기
    const unsubscribeProgress = api.onRunProgress((runProgress) => {
        if (runProgress.stage === 'done' || runProgress.stage === 'error') void queryClient.invalidateQueries({ queryKey: queryKeys.usage })
    })

    return () => {
        unsubscribeItemUpdated()
        unsubscribeDigestUpdated()
        unsubscribeProgress()
    }
}

/**
 * 화면 데이터 캐시를 앱 전체에 제공
 *
 * @param {{ children: ReactNode }} props - 캐시를 쓸 화면 전체
 * @returns {JSX.Element} 캐시를 감싼 화면
 */
export function QueryProvider({ children }: { children: ReactNode }) {
    // =============================== 상태 ===================================
    const [appQueryClient] = useState(createQueryClient) // 앱이 떠 있는 동안 하나만 쓰는 캐시

    // =============================== useEffect ===================================
    // Main의 알림 구독
    useEffect(() => subscribeMainEvents(appQueryClient), [appQueryClient])

    return <QueryClientProvider client={appQueryClient}>{children}</QueryClientProvider>
}
