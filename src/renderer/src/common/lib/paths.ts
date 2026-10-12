// ============================================================================
// 화면 주소
//
// [역할]
// - 화면마다 주소(경로)를 만드는 함수 모음 (주소 문자열을 여러 파일에 흩어 쓰지 않기 위함)
// - 주소에 들어 있는 기사 번호 읽기 · 읽기 화면 열고 닫기
// ============================================================================
import { useNavigate, useParams } from 'react-router'
import type { Route } from '@shared/ipc'

const withItem = (basePath: string, itemId?: number | null) => (itemId == null ? basePath : `${basePath}/${itemId}`)
const withQuery = (basePath: string, query: string) => (query ? `${basePath}?q=${encodeURIComponent(query)}` : basePath)

export const paths = {
    of: (route: Route) => `/${route}`, // 메뉴 · Main이 쓰는 화면 이름을 주소로 변환
    today: (itemId?: number | null) => withItem('/today', itemId), // 기사 번호가 있으면 그 기사의 읽기 화면
    library: (itemId?: number | null) => withItem('/library', itemId),
    archive: (query = '') => withQuery('/archive', query), // 검색어가 있으면 검색 결과 목록
    archiveDate: (date: string, itemId?: number | null) => withItem(`/archive/${date}`, itemId), // 그날 브리핑
    archiveSearch: (query: string, itemId: number) => withQuery(`/archive/search/${itemId}`, query) // 검색 결과에서 연 읽기 화면
}

/**
 * 주소에 들어 있는 기사 번호 읽기
 *
 * @returns {number | null} 읽기 화면에서 보고 있는 기사 번호 (목록 화면이거나 숫자가 아니면 null)
 */
export function useItemIdParam(): number | null {
    const { itemId } = useParams()
    const parsedItemId = Number(itemId)
    return itemId !== undefined && Number.isInteger(parsedItemId) ? parsedItemId : null
}

/**
 * 읽기 화면을 주소로 열고 닫기
 *
 * - 목록에서 열면 방문 기록에 추가 (뒤로 가면 목록)
 * - 읽는 중에 이전 · 다음 기사로 옮기면 기록을 바꿔치기 (뒤로 가면 기사를 되짚지 않고 바로 목록)
 *
 * @param {(itemId: number | null) => string} toPath - 기사 번호로 주소를 만드는 함수 (null이면 목록 주소)
 * @returns {{ readingItemId: number | null, onRead: (itemId: number | null) => void }} 지금 읽는 기사 번호와, 기사를 열거나(번호) 닫는(null) 함수
 */
export function useReadingRoute(toPath: (itemId: number | null) => string) {
    const navigate = useNavigate()
    const readingItemId = useItemIdParam()
    const onRead = (itemId: number | null): void => {
        void navigate(toPath(itemId), { replace: itemId !== null && readingItemId !== null })
    }
    return { readingItemId, onRead }
}
