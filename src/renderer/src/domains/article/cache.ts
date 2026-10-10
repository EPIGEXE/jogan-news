import type { QueryClient } from '@tanstack/react-query'
import type { DigestDTO, HighlightDTO, ItemDetailDTO, LibraryItemDTO } from '@shared/types'
import { qk } from '@/common/lib/queryKeys'
import type { ArticleView } from '@/domains/article/article'

// 같은 기사가 브리핑·검색 결과·기사 상세 캐시에 따로 들어 있다. 기사를 바꾸면 여기서 한꺼번에 고친다.

/** 검색 결과 한 줄(LibraryItemDTO)에도 있는 필드만 골라 고친다 */
function pickLibrary(patch: Partial<ArticleView>): Partial<LibraryItemDTO> {
  const out: Partial<LibraryItemDTO> = {}
  if (patch.isSaved !== undefined) out.isSaved = patch.isSaved
  if (patch.memo !== undefined) out.memo = patch.memo
  if (patch.tags !== undefined) out.tags = patch.tags
  return out
}

/** 기사 한 건을 모든 캐시(브리핑, 검색 결과, 상세)에서 고친다 */
export function patchArticle(qc: QueryClient, itemId: number, patch: Partial<ArticleView>): void {
  qc.setQueriesData<DigestDTO | null>({ queryKey: qk.digests }, (d) =>
    d && d.entries.some((e) => e.itemId === itemId)
      ? { ...d, entries: d.entries.map((e) => (e.itemId === itemId ? { ...e, ...patch } : e)) }
      : d
  )
  const lib = pickLibrary(patch)
  if (Object.keys(lib).length) {
    qc.setQueriesData<LibraryItemDTO[]>({ queryKey: qk.searches }, (list) =>
      list?.some((it) => it.itemId === itemId) ? list.map((it) => (it.itemId === itemId ? { ...it, ...lib } : it)) : list
    )
  }
  qc.setQueryData<ItemDetailDTO | null>(qk.item(itemId), (d) => (d ? { ...d, ...patch } : d))
}

/** 하이라이트가 바뀌면 기사 상세 캐시에 반영한다 */
export function setHighlights(qc: QueryClient, itemId: number, highlights: HighlightDTO[]): void {
  qc.setQueryData<ItemDetailDTO | null>(qk.item(itemId), (d) => (d ? { ...d, highlights } : d))
}

/** 저장 후 보강(본문 추출·태그 추천)이 도는 중인지 표시한다. 끝나면 item-updated에서 거둔다 */
export function setEnriching(qc: QueryClient, itemId: number, on: boolean): void {
  qc.setQueryData(qk.enriching(itemId), on)
}
