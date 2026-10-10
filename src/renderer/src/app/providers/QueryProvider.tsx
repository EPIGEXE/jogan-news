import { useEffect, useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { api } from '@/common/lib/api'
import { qk } from '@/common/lib/queryKeys'
import { patchArticle, setEnriching } from '@/domains/article/cache'

/**
 * 화면 데이터 캐시. 데이터는 로컬 Worker(IPC)에서 오고, 바뀌는 때는 우리 동작(저장·메모 등)과 Main이 보내는 알림뿐이다.
 * 그래서 시간이 지났다고 다시 읽지 않고(staleTime 무한), 창 포커스·재시도로 다시 부르지 않는다. 바뀌면 그때 무효화한다.
 */
function createClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, gcTime: 10 * 60_000, retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false }
    }
  })
}

/** Main이 보내는 알림을 캐시 무효화로 잇는다. 앱에서 한 번만 연결한다 */
function IpcInvalidation() {
  const qc = useQueryClient()
  useEffect(() => {
    // 저장 후 보강·번역이 끝남: 그 기사를 다시 읽고, 새 태그·저장 여부를 목록에도 반영한다
    const offItem = api.onItemUpdated((itemId) => {
      setEnriching(qc, itemId, false)
      void qc.invalidateQueries({ queryKey: qk.tags })
      void qc.fetchQuery({ queryKey: qk.item(itemId), queryFn: () => api.getItem(itemId), staleTime: 0 }).then((d) => {
        if (d) patchArticle(qc, itemId, { tags: d.tags, isSaved: d.isSaved })
      })
    })
    // 새 브리핑이 게시됨: 브리핑·날짜 목록·비용·출처 통계를 새로 읽는다
    const offDigest = api.onDigestUpdated(() => {
      void qc.invalidateQueries({ queryKey: qk.digests })
      void qc.invalidateQueries({ queryKey: qk.digestList })
      void qc.invalidateQueries({ queryKey: qk.usage })
      void qc.invalidateQueries({ queryKey: qk.allSources })
    })
    // 생성이 끝나면 비용이 바뀐다
    const offProgress = api.onProgress((p) => {
      if (p.stage === 'done' || p.stage === 'error') void qc.invalidateQueries({ queryKey: qk.usage })
    })
    return () => {
      offItem()
      offDigest()
      offProgress()
    }
  }, [qc])
  return null
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createClient)
  return (
    <QueryClientProvider client={client}>
      <IpcInvalidation />
      {children}
    </QueryClientProvider>
  )
}
