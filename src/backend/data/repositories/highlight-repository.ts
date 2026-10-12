// ============================================================================
// 하이라이트 저장소
//
// [역할]
// - 기사 본문에 그은 하이라이트(highlights)를 읽고 씀 (Main이 쓰는 테이블)
// - 목록은 화면용 모양(HighlightDTO)으로 돌려줌 (문단 · 시작 위치 순)
// - 새 범위와 겹치거나 맞닿는 기존 하이라이트를 찾는 조회 제공 (같은 문단 · 같은 판 안에서만)
// - 규칙은 넣지 않음 (겹친 것 합치기, 그은 글자 잘라 오기, 그으면 기사 자동 저장, 검색 색인 갱신은 서비스)
// ============================================================================
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm'
import type { HighlightDTO, HighlightVariant } from '@shared/types'
import { nowIso, type AppDatabase } from '@data/client'
import { highlights } from '@data/schema'

export type HighlightRow = typeof highlights.$inferSelect // 하이라이트 한 행 (어느 기사의 것인지 포함)

// 새로 넣을 하이라이트
export interface NewHighlight {
    itemId: number // 그은 기사
    paragraph: number // ¶ 번호 (1부터)
    variant: HighlightVariant // ko: 번역문에 그음, original: 원문에 그음
    start: number // 문단 글자 안의 시작 위치 (포함)
    end: number // 끝 위치 (포함하지 않음)
    text: string // 그은 글자
    note?: string // 하이라이트 메모 (안 넘기면 빈 글자)
    createdAt?: string // 그은 시각 (안 넘기면 지금)
}

// 같은 문단 · 같은 판 안의 한 범위
export interface HighlightSpan {
    itemId: number // 기사 번호
    paragraph: number // ¶ 번호 (1부터)
    variant: HighlightVariant // 번역문인지 원문인지
    start: number // 시작 위치 (포함)
    end: number // 끝 위치 (포함하지 않음)
}

export interface HighlightRepository {
    listHighlightsByItemId(itemId: number): HighlightDTO[] // 그 기사의 하이라이트 (문단 · 시작 위치 순)
    findHighlightById(highlightId: number): HighlightRow | null // 하이라이트 한 건 (어느 기사의 것인지 확인용, 없으면 null)
    // 그 범위와 겹치거나 맞닿는 하이라이트 (같은 기사 · 문단 · 판, 끝과 시작이 딱 붙은 것도 포함, 순서는 정해져 있지 않음)
    listHighlightsTouchingSpan(span: HighlightSpan): HighlightDTO[]
    insertHighlight(newHighlight: NewHighlight): number // 하이라이트 저장 → 하이라이트 번호
    updateHighlightNote(highlightId: number, note: string): void // 하이라이트 메모 교체 (없는 번호면 아무 일도 없음)
    deleteHighlightsByIds(highlightIds: number[]): number // 번호로 삭제 (빈 목록이면 아무 일도 없음) → 지운 개수
}

// 하이라이트 행을 화면용 모양으로 변환
const toHighlightDTO = (highlightRow: HighlightRow): HighlightDTO => ({
    id: highlightRow.id,
    paragraph: highlightRow.paragraph,
    variant: highlightRow.variant as HighlightVariant,
    start: highlightRow.startOffset,
    end: highlightRow.endOffset,
    text: highlightRow.text,
    note: highlightRow.note,
    createdAt: highlightRow.createdAt
})

/**
 * 하이라이트 저장소 생성
 *
 * @param {AppDatabase} database - DB 연결
 * @returns {HighlightRepository} 하이라이트 저장소
 */
export function createHighlightRepository(database: AppDatabase): HighlightRepository {
    return {
        listHighlightsByItemId(itemId) {
            return database
                .select()
                .from(highlights)
                .where(eq(highlights.itemId, itemId))
                .orderBy(asc(highlights.paragraph), asc(highlights.startOffset))
                .all()
                .map(toHighlightDTO)
        },

        findHighlightById(highlightId) {
            return database.select().from(highlights).where(eq(highlights.id, highlightId)).get() ?? null
        },

        listHighlightsTouchingSpan(span) {
            // 기존 범위의 시작이 새 범위의 끝 이하이고, 기존 범위의 끝이 새 범위의 시작 이상인 것
            // 등호를 넣어 맞닿기만 한 범위도 함께 찾음
            return database
                .select()
                .from(highlights)
                .where(
                    and(
                        eq(highlights.itemId, span.itemId),
                        eq(highlights.paragraph, span.paragraph),
                        eq(highlights.variant, span.variant),
                        lte(highlights.startOffset, span.end),
                        gte(highlights.endOffset, span.start)
                    )
                )
                .all()
                .map(toHighlightDTO)
        },

        insertHighlight(newHighlight) {
            const highlightInsertResult = database
                .insert(highlights)
                .values({
                    itemId: newHighlight.itemId,
                    paragraph: newHighlight.paragraph,
                    variant: newHighlight.variant,
                    startOffset: newHighlight.start,
                    endOffset: newHighlight.end,
                    text: newHighlight.text,
                    note: newHighlight.note ?? '',
                    createdAt: newHighlight.createdAt ?? nowIso()
                })
                .run()
            return Number(highlightInsertResult.lastInsertRowid)
        },

        updateHighlightNote(highlightId, note) {
            database.update(highlights).set({ note }).where(eq(highlights.id, highlightId)).run()
        },

        deleteHighlightsByIds(highlightIds) {
            // 지울 번호가 없으면 쿼리를 보내지 않음
            if (highlightIds.length === 0) return 0
            return database.delete(highlights).where(inArray(highlights.id, highlightIds)).run().changes
        }
    }
}
