// ============================================================================
// 기사 화면용 타입
//
// [역할]
// - 기사 패널 · 읽기 화면이 함께 쓰는 기사 한 건의 모양 정의
// - 기사 한 건에 대한 사용자 동작(저장 · 메모 · 태그 · 원문 열기)의 모양 정의
// ============================================================================
import type { DigestEntryDTO } from '@shared/types'

// 기사 패널 · 읽기 화면이 보여주는 기사 한 건 (브리핑 항목과 기사 상세의 공통 부분)
export type ArticleView = Omit<DigestEntryDTO, 'rank' | 'section'>

// 기사 한 건에 대한 사용자 동작 (queries.ts의 useArticleActions가 생성)
export interface ArticleActions {
    onToggleSave(): void // 저장 · 저장 해제 전환
    onSaveMemo(body: string): Promise<{ savedAt: string }> // 메모 저장 (저장한 시각 반환)
    onAddTag(name: string): void
    onRemoveTag(name: string): void
    onOpenUrl(url: string): void // 주소를 바깥 브라우저로 열기
}
