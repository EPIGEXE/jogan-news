// ============================================================================
// 콘텐츠 서비스
//
// [역할]
// - 브리핑 · 기사 · 하이라이트 · 태그 · 라이브러리 · 출처 통계 요청을 Worker에 전달
// - 화면 요청이 Worker를 직접 부르지 않고 거쳐 가는 자리 (규칙이 생기면 여기에 둠)
// - 화면에서 쓰는 이름을 Worker가 받는 인자 이름으로 바꿔 전달 (판단 · 저장은 Worker가 담당)
// - 저장 · 메모 · 하이라이트 뒤의 본문 추출 · 태그 추천 · 번역은 Worker가 뒤에서 진행 (끝나면 기사 변경 알림)
// - 낮 동안의 미리 수집과 마지막 브리핑 날짜 조회도 여기를 거침 (triggers/가 사용)
// ============================================================================
import type {
    DigestDTO,
    DigestSummaryDTO,
    HighlightDTO,
    HighlightRange,
    ItemDetailDTO,
    LibraryItemDTO,
    SearchParams,
    SourceStatsDTO,
    StatsPeriod,
    TagCount
} from '@shared/types'
import type { WorkerRpc } from './ports'

/**
 * 브리핑 · 기사 · 라이브러리 데이터
 * - 지금은 대부분 Worker에 그대로 전달
 */
export class ContentService {
    constructor(private readonly worker: WorkerRpc) {}

    // 가장 최근 브리핑 (없으면 null)
    getLatestDigest(): Promise<DigestDTO | null> {
        return this.worker.call('getLatestDigest')
    }

    // 마지막으로 브리핑을 만든 날짜 'YYYY-MM-DD' (없으면 null, 오늘 브리핑이 있는지 판단하는 데 사용)
    getLastDigestDate(): Promise<string | null> {
        return this.worker.call('getLastDigestDate')
    }

    // 그 날짜의 브리핑 (없으면 null)
    getDigest(digestDate: string): Promise<DigestDTO | null> {
        return this.worker.call('getDigest', { date: digestDate })
    }

    // 지난 브리핑 목록 (최근 날짜부터, 날짜 · 오늘의 한 줄 · 실린 건수 · 저장한 건수)
    listDigests(): Promise<DigestSummaryDTO[]> {
        return this.worker.call('listDigests')
    }

    // 기사 한 건의 상세 (없으면 null)
    getItem(itemId: number): Promise<ItemDetailDTO | null> {
        return this.worker.call('getItem', { itemId })
    }

    // 기사 본문 번역 (번역을 새로 만들었으면 true)
    // API 키가 없거나 하루 비용 상한에 닿았으면 번역하지 않고 false
    translateItem(itemId: number): Promise<boolean> {
        return this.worker.call('translateItem', { itemId })
    }

    // 출처별 통계 (기간은 최근 7일 · 30일 또는 전체)
    getSourceStats(statsPeriod: StatsPeriod): Promise<SourceStatsDTO> {
        return this.worker.call('getSourceStats', { period: statsPeriod })
    }

    // 낮 동안 미리 수집 (LLM 없음)
    // 브리핑을 만드는 중이거나 이미 수집 중이면 Worker가 건너뛰고 skipped: true
    collectOnly(): Promise<{ collected: number; skipped: boolean }> {
        return this.worker.call('collectOnly')
    }

    // 하이라이트 긋기 → 그 기사의 하이라이트 목록
    // 겹치거나 맞닿는 것은 하나로 합쳐지고, 하이라이트를 그은 기사는 자동으로 저장됨
    addHighlights(itemId: number, highlightRanges: HighlightRange[]): Promise<HighlightDTO[]> {
        return this.worker.call('addHighlights', { itemId, ranges: highlightRanges })
    }

    // 하이라이트에 붙인 메모 수정 → 그 기사의 하이라이트 목록 (없는 하이라이트면 빈 목록)
    updateHighlightNote(highlightId: number, note: string): Promise<HighlightDTO[]> {
        return this.worker.call('updateHighlightNote', { highlightId, note })
    }

    // 하이라이트 지우기 → 그 기사에 남은 하이라이트 목록 (없는 하이라이트면 빈 목록)
    removeHighlight(highlightId: number): Promise<HighlightDTO[]> {
        return this.worker.call('removeHighlight', { highlightId })
    }

    // 읽음 표시 (이미 읽은 기사면 처음 읽은 시각 유지)
    markRead(itemId: number): Promise<void> {
        return this.worker.call('markRead', { itemId })
    }

    // 저장 · 저장 해제 (저장하면 Worker가 뒤에서 본문 추출 · 태그 추천 진행)
    setSaved(itemId: number, isSaved: boolean): Promise<void> {
        return this.worker.call('setSaved', { itemId, saved: isSaved })
    }

    // 메모 저장 (저장한 시각을 돌려줌)
    // 메모를 쓴 기사는 자동으로 저장되고, 빈 메모를 보내면 메모 삭제
    saveMemo(itemId: number, memoBody: string): Promise<{ savedAt: string }> {
        return this.worker.call('saveMemo', { itemId, body: memoBody })
    }

    // 태그 붙이기 → 그 기사의 태그 목록 (하이픈만 다른 기존 태그가 있으면 그 표기로 붙음)
    addTag(itemId: number, tagName: string): Promise<string[]> {
        return this.worker.call('addTag', { itemId, name: tagName })
    }

    // 태그 떼기 → 그 기사에 남은 태그 목록 (쓰는 기사가 없어진 태그는 삭제됨)
    removeTag(itemId: number, tagName: string): Promise<string[]> {
        return this.worker.call('removeTag', { itemId, name: tagName })
    }

    // 기사 검색 (저장한 기사 또는 브리핑에 실린 기사)
    // 저장한 기사는 저장 순, 실린 기사는 최신 브리핑 순
    search(searchParams: SearchParams): Promise<LibraryItemDTO[]> {
        return this.worker.call('search', searchParams)
    }

    // 저장한 기사에 붙은 태그 목록과 태그별 개수 (많이 쓴 순)
    listTags(): Promise<TagCount[]> {
        return this.worker.call('listTags')
    }
}
