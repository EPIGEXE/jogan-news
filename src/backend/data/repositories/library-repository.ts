// ============================================================================
// 라이브러리 저장소
//
// [역할]
// - 기사에 남긴 사용자 표시 세 가지를 읽고 씀: 저장(saves) · 메모(notes) · 읽음(reads)
// - 세 테이블 모두 Main이 쓰는 테이블 (기사 하나에 행 하나, 기본 키가 기사 번호)
// - 저장 · 읽음은 처음 한 시각을 지킴 (이미 있으면 다시 넣지 않음)
// - 저장 후 처리(본문 추출 · 태그 추천)를 마쳤는지는 saves의 마친 시각으로 기록
// - 규칙은 넣지 않음 ("메모를 쓰면 자동 저장", "빈 메모는 삭제", 검색 색인 갱신은 서비스가 조합)
// ============================================================================
import { and, eq, isNull } from 'drizzle-orm'
import { nowIso, type AppDatabase } from '@data/client'
import { notes, reads, saves } from '@data/schema'

export type SaveRow = typeof saves.$inferSelect // 저장한 기사 한 행 (저장한 시각 · 저장 후 처리를 마친 시각)
export type NoteRow = typeof notes.$inferSelect // 메모 한 행 (내용 · 고친 시각)
export type ReadRow = typeof reads.$inferSelect // 읽음 표시 한 행 (처음 읽은 시각)

export interface LibraryRepository {
    findSaveByItemId(itemId: number): SaveRow | null // 그 기사의 저장 행 (저장하지 않았으면 null)
    // 저장 처리 (이미 저장한 기사면 처음 저장한 시각 · 처리 시각을 그대로 둠) → 이번에 새로 저장됐으면 true
    insertSaveIfAbsent(itemId: number, savedAt?: string): boolean
    deleteSave(itemId: number): void // 저장 취소 (저장하지 않은 기사면 아무 일도 없음)
    existsSaveAwaitingEnrichment(itemId: number): boolean // 저장한 기사이고 저장 후 처리를 아직 마치지 않았는지
    updateSaveEnrichedAt(itemId: number, enrichedAt?: string): void // 저장 후 처리를 마친 시각 기록 (저장하지 않은 기사면 아무 일도 없음)

    findNoteByItemId(itemId: number): NoteRow | null // 그 기사의 메모 (없으면 null)
    upsertNote(itemId: number, noteBody: string, updatedAt?: string): void // 메모 저장 (이미 있으면 내용 · 고친 시각 교체)
    deleteNote(itemId: number): void // 메모 삭제 (메모가 없으면 아무 일도 없음)

    findReadByItemId(itemId: number): ReadRow | null // 그 기사의 읽음 표시 (읽지 않았으면 null)
    insertReadIfAbsent(itemId: number, readAt?: string): void // 읽음 표시 (이미 읽은 기사면 처음 읽은 시각을 그대로 둠)
}

/**
 * 라이브러리 저장소 생성
 *
 * @param {AppDatabase} database - DB 연결
 * @returns {LibraryRepository} 라이브러리 저장소
 */
export function createLibraryRepository(database: AppDatabase): LibraryRepository {
    return {
        findSaveByItemId(itemId) {
            return database.select().from(saves).where(eq(saves.itemId, itemId)).get() ?? null
        },

        insertSaveIfAbsent(itemId, savedAt = nowIso()) {
            // 이미 저장한 기사면 넣지 않음 (바뀐 행이 있을 때만 새로 저장된 것)
            const saveInsertResult = database.insert(saves).values({ itemId, savedAt }).onConflictDoNothing().run()
            return saveInsertResult.changes > 0
        },

        deleteSave(itemId) {
            database.delete(saves).where(eq(saves.itemId, itemId)).run()
        },

        existsSaveAwaitingEnrichment(itemId) {
            // 저장 행이 있고 마친 시각이 비어 있는 경우만
            const awaitingSaveRow = database
                .select({ itemId: saves.itemId })
                .from(saves)
                .where(and(eq(saves.itemId, itemId), isNull(saves.enrichedAt)))
                .get()
            return awaitingSaveRow !== undefined
        },

        updateSaveEnrichedAt(itemId, enrichedAt = nowIso()) {
            database.update(saves).set({ enrichedAt }).where(eq(saves.itemId, itemId)).run()
        },

        findNoteByItemId(itemId) {
            return database.select().from(notes).where(eq(notes.itemId, itemId)).get() ?? null
        },

        upsertNote(itemId, noteBody, updatedAt = nowIso()) {
            database
                .insert(notes)
                .values({ itemId, body: noteBody, updatedAt })
                .onConflictDoUpdate({ target: notes.itemId, set: { body: noteBody, updatedAt } })
                .run()
        },

        deleteNote(itemId) {
            database.delete(notes).where(eq(notes.itemId, itemId)).run()
        },

        findReadByItemId(itemId) {
            return database.select().from(reads).where(eq(reads.itemId, itemId)).get() ?? null
        },

        insertReadIfAbsent(itemId, readAt = nowIso()) {
            database.insert(reads).values({ itemId, readAt }).onConflictDoNothing().run()
        }
    }
}
