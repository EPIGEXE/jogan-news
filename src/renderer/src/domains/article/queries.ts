// ============================================================================
// 기사 조회 · 변경 훅
//
// [역할]
// - 기사 데이터를 읽어 오고 바꾸는 훅 모음 (화면은 api를 직접 부르지 않고 여기 훅만 사용)
// - 변경은 화면에 먼저 반영하고, 실패하면 되돌린 뒤 알림 (낙관적 반영)
// - 기사 한 건에 대한 동작(저장 · 메모 · 태그 · 원문 열기)을 한 묶음으로 제공
// ============================================================================
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { SearchParams } from '@shared/types'
import { api } from '@/common/lib/api'
import { queryKeys } from '@/common/lib/queryKeys'
import { toast } from '@/common/lib/toast'
import { patchArticle, setEnriching } from '@/domains/article/cache'
import type { ArticleActions, ArticleView } from '@/domains/article/types'

// =============================== 조회 ===================================

/**
 * 기사 한 건의 상세(본문 문단 · 번역 · 하이라이트) 조회
 *
 * - 저장 후 보강 · 번역이 끝나면 item-updated로 다시 읽음
 *
 * @param {number | null} itemId - 기사 번호 (null이면 조회하지 않음)
 * @returns {UseQueryResult} 기사 상세 조회 결과
 */
export function useItemDetailQuery(itemId: number | null) {
    return useQuery({
        queryKey: queryKeys.itemDetail(itemId ?? -1),
        queryFn: () => api.getItem(itemId!),
        enabled: itemId !== null
    })
}

/**
 * 저장 후 보강(태그 추천 등)이 도는 중인지 조회
 *
 * - 서버 데이터가 아니라 캐시에 둔 화면 표시용 값
 *
 * @param {number | null} itemId - 기사 번호
 * @returns {boolean} 보강 중이면 true (기사 번호가 null이면 false)
 */
export function useEnrichingQuery(itemId: number | null): boolean {
    const { data: isEnriching } = useQuery({
        queryKey: queryKeys.enriching(itemId ?? -1),
        queryFn: () => false,
        enabled: false,
        initialData: false
    })
    return itemId !== null && isEnriching
}

/**
 * 라이브러리 · 아카이브 검색
 *
 * - 검색어를 칠 때마다 키가 바뀌므로, 새 결과가 올 때까지 이전 결과 표시
 *
 * @param {SearchParams} searchParams - 검색 조건
 * @param {boolean} enabled - false면 조회하지 않음
 * @returns {UseQueryResult} 검색 결과 목록 조회 결과
 */
export function useSearchQuery(searchParams: SearchParams, enabled = true) {
    return useQuery({
        queryKey: queryKeys.search(searchParams),
        queryFn: () => api.search(searchParams),
        enabled,
        placeholderData: keepPreviousData
    })
}

/**
 * 태그 목록 조회
 *
 * @returns {UseQueryResult} 태그 목록 조회 결과
 */
export function useTagsQuery() {
    return useQuery({ queryKey: queryKeys.tags, queryFn: () => api.listTags() })
}

// =============================== 변경 ===================================

// 저장 여부가 바뀌면 저장 목록 · 날짜별 저장 수 · 출처 통계가 달라짐
// 지금 보는 목록은 그대로 두고 다음에 열 때 새로 읽도록 표시
function markListsStale(queryClient: QueryClient): void {
    void queryClient.invalidateQueries({ queryKey: queryKeys.searches, refetchType: 'none' })
    void queryClient.invalidateQueries({ queryKey: queryKeys.digestList, refetchType: 'none' })
    void queryClient.invalidateQueries({ queryKey: queryKeys.allSourceStats, refetchType: 'none' })
}

/**
 * 저장 / 저장 해제
 *
 * - 저장하면 뒤에서 본문 추출 · 태그 추천이 돌기 시작하므로 "추천 중" 표시
 * - 실패하면 화면에 먼저 반영한 저장 여부를 되돌림
 *
 * @returns {UseMutationResult} 저장 여부 변경 요청
 */
export function useToggleSaveMutation() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ itemId, isSaved }: { itemId: number; isSaved: boolean }) => api.setSaved(itemId, isSaved),
        onMutate: ({ itemId, isSaved }) => {
            patchArticle(queryClient, itemId, { isSaved })
            if (isSaved) setEnriching(queryClient, itemId, true)
        },
        onError: (_error, { itemId, isSaved }) => {
            patchArticle(queryClient, itemId, { isSaved: !isSaved })
            setEnriching(queryClient, itemId, false)
            toast(isSaved ? '저장하지 못했습니다' : '저장을 해제하지 못했습니다')
        },
        onSuccess: (_setSavedResult, { isSaved }) => {
            toast(isSaved ? '저장했습니다' : '저장을 해제했습니다')
            markListsStale(queryClient)
        }
    })
}

/**
 * 메모 저장
 *
 * - 메모를 쓴 기사는 자동으로 저장됨 (DESIGN.md 6.3절)
 * - 요청 값의 wasSaved: 쓰기 전에 저장돼 있었는지
 *
 * @returns {UseMutationResult} 메모 저장 요청
 */
export function useSaveMemoMutation() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ itemId, memoBody }: { itemId: number; memoBody: string; wasSaved: boolean }) => api.saveMemo(itemId, memoBody),
        onSuccess: (_savedMemo, { itemId, memoBody, wasSaved }) => {
            if (memoBody.trim()) {
                if (!wasSaved) {
                    setEnriching(queryClient, itemId, true)
                    markListsStale(queryClient)
                }
                patchArticle(queryClient, itemId, { memo: memoBody, isSaved: true })
            } else {
                patchArticle(queryClient, itemId, { memo: '' })
            }
        }
    })
}

// 태그 붙이기 · 떼기 공통 (결과로 그 기사의 태그 목록이 돌아옴)
function useTagMutation(requestTagChange: (itemId: number, tagName: string) => Promise<string[]>, failureMessage: string) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ itemId, tagName }: { itemId: number; tagName: string }) => requestTagChange(itemId, tagName),
        onSuccess: (tags, { itemId }) => {
            patchArticle(queryClient, itemId, { tags })
            void queryClient.invalidateQueries({ queryKey: queryKeys.tags })
        },
        onError: () => toast(failureMessage)
    })
}

/**
 * 기사에 태그 붙이기
 *
 * @returns {UseMutationResult} 태그 추가 요청
 */
export function useAddTagMutation() {
    return useTagMutation((itemId, tagName) => api.addTag(itemId, tagName), '태그를 붙이지 못했습니다')
}

/**
 * 기사에서 태그 떼기
 *
 * @returns {UseMutationResult} 태그 제거 요청
 */
export function useRemoveTagMutation() {
    return useTagMutation((itemId, tagName) => api.removeTag(itemId, tagName), '태그를 떼지 못했습니다')
}

/**
 * 읽음 표시 (목록에서 처음 골랐을 때)
 *
 * @returns {UseMutationResult} 읽음 표시 요청
 */
export function useMarkReadMutation() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (itemId: number) => api.markRead(itemId),
        onMutate: (itemId) => patchArticle(queryClient, itemId, { isRead: true })
    })
}

/**
 * 본문 번역 요청
 *
 * - 새로 번역했으면 결과가 true
 * - 번역이 끝나면 item-updated로 기사 상세를 다시 읽음
 *
 * @returns {UseMutationResult} 본문 번역 요청
 */
export function useTranslateItemMutation() {
    return useMutation({ mutationFn: (itemId: number) => api.translateItem(itemId) })
}

/**
 * 기사 한 건에 대한 동작 묶음(저장 · 메모 · 태그 · 원문 열기)
 *
 * - 목록 · 개요 · 읽기 화면이 같은 모양으로 사용
 *
 * @param {ArticleView | null} entry - 동작 대상 기사
 * @returns {ArticleActions | null} 동작 함수 묶음 (기사가 null이면 null)
 */
export function useArticleActions(entry: ArticleView | null): ArticleActions | null {
    const { mutate: toggleSave } = useToggleSaveMutation()
    const { mutateAsync: saveMemo } = useSaveMemoMutation()
    const { mutate: addTag } = useAddTagMutation()
    const { mutate: removeTag } = useRemoveTagMutation()
    if (!entry) return null
    const itemId = entry.itemId
    return {
        onToggleSave: () => toggleSave({ itemId, isSaved: !entry.isSaved }),
        onSaveMemo: (memoBody) => saveMemo({ itemId, memoBody, wasSaved: entry.isSaved }),
        onAddTag: (tagName) => addTag({ itemId, tagName }),
        onRemoveTag: (tagName) => removeTag({ itemId, tagName }),
        onOpenUrl: (url) => void api.openExternal(url)
    }
}
