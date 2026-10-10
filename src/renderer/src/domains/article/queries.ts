import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SearchParams } from '@shared/types'
import { api } from '@/common/lib/api'
import { qk } from '@/common/lib/queryKeys'
import { toast } from '@/common/lib/toast'
import type { ArticleHandlers, ArticleView } from '@/domains/article/article'
import { patchArticle, setEnriching } from '@/domains/article/cache'

/** 기사 한 건의 상세(본문 문단·번역·하이라이트). 저장 후 보강·번역이 끝나면 item-updated로 다시 불러온다 */
export function useItemDetail(itemId: number | null) {
  return useQuery({
    queryKey: qk.item(itemId ?? -1),
    queryFn: () => api.getItem(itemId!),
    enabled: itemId !== null
  })
}

/** 저장 후 보강(태그 추천 등)이 도는 중인지 */
export function useEnriching(itemId: number | null): boolean {
  const { data } = useQuery({
    queryKey: qk.enriching(itemId ?? -1),
    queryFn: () => false,
    enabled: false,
    initialData: false
  })
  return itemId !== null && data
}

export function useSearch(params: SearchParams, enabled = true) {
  // 검색어를 칠 때마다 키가 바뀌므로, 새 결과가 올 때까지 이전 결과를 보여준다
  return useQuery({ queryKey: qk.search(params), queryFn: () => api.search(params), enabled, placeholderData: keepPreviousData })
}

export function useTags() {
  return useQuery({ queryKey: qk.tags, queryFn: () => api.listTags() })
}

/**
 * 기사 한 건에 대한 동작(저장·메모·태그·원문). 화면은 먼저 고치고(낙관적 반영) DB에 저장한다.
 * 저장하면 뒤에서 본문 추출·태그 추천이 돌기 시작하므로 "추천 중"을 켠다.
 */
export function useArticleActions(entry: ArticleView | null): ArticleHandlers | null {
  const qc = useQueryClient()
  if (!entry) return null
  const id = entry.itemId
  // 저장 여부가 바뀌면 저장 목록·날짜별 저장 수·출처 통계가 달라진다. 지금 보는 목록은 그대로 두고 다음에 열 때 새로 읽는다
  const markListsStale = () => {
    void qc.invalidateQueries({ queryKey: qk.searches, refetchType: 'none' })
    void qc.invalidateQueries({ queryKey: qk.digestList, refetchType: 'none' })
    void qc.invalidateQueries({ queryKey: qk.allSources, refetchType: 'none' })
  }
  return {
    onToggleSave: () => {
      const saved = !entry.isSaved
      patchArticle(qc, id, { isSaved: saved })
      if (saved) setEnriching(qc, id, true)
      void api.setSaved(id, saved).then(() => {
        toast(saved ? '저장했습니다' : '저장을 해제했습니다')
        markListsStale()
      })
    },
    onSaveMemo: async (body) => {
      const r = await api.saveMemo(id, body)
      // 메모를 쓴 기사는 자동으로 저장된다 (DESIGN.md 6.3절)
      if (body.trim()) {
        if (!entry.isSaved) {
          setEnriching(qc, id, true)
          markListsStale()
        }
        patchArticle(qc, id, { memo: body, isSaved: true })
      } else {
        patchArticle(qc, id, { memo: '' })
      }
      return r
    },
    onAddTag: (name) =>
      void api.addTag(id, name).then((tags) => {
        patchArticle(qc, id, { tags })
        void qc.invalidateQueries({ queryKey: qk.tags })
      }),
    onRemoveTag: (name) =>
      void api.removeTag(id, name).then((tags) => {
        patchArticle(qc, id, { tags })
        void qc.invalidateQueries({ queryKey: qk.tags })
      }),
    onOpenUrl: (url) => void api.openExternal(url)
  }
}

/** 기사를 읽음으로 표시한다 (목록에서 처음 골랐을 때) */
export function useMarkRead() {
  const qc = useQueryClient()
  return (itemId: number) => {
    patchArticle(qc, itemId, { isRead: true })
    void api.markRead(itemId)
  }
}
