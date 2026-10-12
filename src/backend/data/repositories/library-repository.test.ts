// ============================================================================
// 라이브러리 저장소 테스트
//
// [역할]
// - 메모리 DB에 실제 쿼리를 돌려 저장 · 메모 · 읽음의 읽고 쓰기 확인
// - 처음 한 시각을 지키는지, 없을 때 null인지, 저장 후 처리 표시가 바뀌는지
// ============================================================================
import { describe, expect, it } from 'vitest'
import type { AppDatabase } from '@data/client'
import { items } from '@data/schema'
import { openTestDatabase } from '@data/testing'
import { createLibraryRepository } from './library-repository'

// 외래 키를 채울 기사 한 건 넣기 → 기사 번호
function insertItem(database: AppDatabase, urlKey: string): number {
    const itemInsertResult = database
        .insert(items)
        .values({
            urlKey,
            url: `https://${urlKey}`,
            sourceId: 'hn',
            sourceName: 'Hacker News',
            kind: 'community',
            title: 'Mistral Large 4 released',
            titleNorm: 'mistral large 4 released',
            collectedAt: '2026-10-07T00:00:00.000Z'
        })
        .run()
    return Number(itemInsertResult.lastInsertRowid)
}

describe('library-repository', () => {
    it('저장: 처음 저장하면 true, 다시 저장하면 false이고 처음 저장한 시각을 그대로 둔다', () => {
        const database = openTestDatabase()
        const libraryRepository = createLibraryRepository(database)
        const itemId = insertItem(database, 'a.com/1')

        expect(libraryRepository.findSaveByItemId(itemId)).toBeNull()
        expect(libraryRepository.insertSaveIfAbsent(itemId, '2026-10-07T01:00:00.000Z')).toBe(true)
        expect(libraryRepository.insertSaveIfAbsent(itemId, '2026-10-08T01:00:00.000Z')).toBe(false)
        expect(libraryRepository.findSaveByItemId(itemId)).toEqual({ itemId, savedAt: '2026-10-07T01:00:00.000Z', enrichedAt: null })
    })

    it('저장: 시각을 넘기지 않으면 지금 시각으로 채운다', () => {
        const database = openTestDatabase()
        const libraryRepository = createLibraryRepository(database)
        const itemId = insertItem(database, 'a.com/1')

        const beforeIso = new Date().toISOString()
        libraryRepository.insertSaveIfAbsent(itemId)
        const savedAt = libraryRepository.findSaveByItemId(itemId)!.savedAt
        expect(savedAt >= beforeIso && savedAt <= new Date().toISOString()).toBe(true)
    })

    it('저장 취소: 그 기사의 저장만 지우고, 저장하지 않은 기사에는 아무 일도 없다', () => {
        const database = openTestDatabase()
        const libraryRepository = createLibraryRepository(database)
        const firstItemId = insertItem(database, 'a.com/1')
        const secondItemId = insertItem(database, 'a.com/2')
        libraryRepository.insertSaveIfAbsent(firstItemId)
        libraryRepository.insertSaveIfAbsent(secondItemId)

        libraryRepository.deleteSave(firstItemId)
        libraryRepository.deleteSave(firstItemId)
        expect(libraryRepository.findSaveByItemId(firstItemId)).toBeNull()
        expect(libraryRepository.findSaveByItemId(secondItemId)).not.toBeNull()
    })

    it('저장 후 처리: 저장한 기사이고 아직 마치지 않았을 때만 필요하다고 본다', () => {
        const database = openTestDatabase()
        const libraryRepository = createLibraryRepository(database)
        const itemId = insertItem(database, 'a.com/1')

        // 저장하지 않은 기사 → 필요 없음, 마친 시각을 적어도 행이 생기지 않음
        expect(libraryRepository.existsSaveAwaitingEnrichment(itemId)).toBe(false)
        libraryRepository.updateSaveEnrichedAt(itemId)
        expect(libraryRepository.findSaveByItemId(itemId)).toBeNull()

        // 저장한 기사 → 필요, 마쳤다고 표시하면 필요 없음
        libraryRepository.insertSaveIfAbsent(itemId)
        expect(libraryRepository.existsSaveAwaitingEnrichment(itemId)).toBe(true)
        libraryRepository.updateSaveEnrichedAt(itemId, '2026-10-07T02:00:00.000Z')
        expect(libraryRepository.existsSaveAwaitingEnrichment(itemId)).toBe(false)
        expect(libraryRepository.findSaveByItemId(itemId)!.enrichedAt).toBe('2026-10-07T02:00:00.000Z')

        // 다시 저장해도(이미 저장됨) 마친 시각은 그대로
        libraryRepository.insertSaveIfAbsent(itemId)
        expect(libraryRepository.existsSaveAwaitingEnrichment(itemId)).toBe(false)
    })

    it('메모: 없으면 null, 저장하면 내용과 시각이 들어가고, 다시 저장하면 둘 다 바뀐다', () => {
        const database = openTestDatabase()
        const libraryRepository = createLibraryRepository(database)
        const itemId = insertItem(database, 'a.com/1')

        expect(libraryRepository.findNoteByItemId(itemId)).toBeNull()
        libraryRepository.upsertNote(itemId, '비용 계산해 볼 것', '2026-10-07T01:00:00.000Z')
        expect(libraryRepository.findNoteByItemId(itemId)).toEqual({
            itemId,
            body: '비용 계산해 볼 것',
            updatedAt: '2026-10-07T01:00:00.000Z'
        })
        libraryRepository.upsertNote(itemId, '고친 메모', '2026-10-08T01:00:00.000Z')
        expect(libraryRepository.findNoteByItemId(itemId)).toEqual({ itemId, body: '고친 메모', updatedAt: '2026-10-08T01:00:00.000Z' })
    })

    it('메모: 저장해도 기사가 저장되지는 않고(서비스의 일), 지우면 그 기사의 메모만 사라진다', () => {
        const database = openTestDatabase()
        const libraryRepository = createLibraryRepository(database)
        const firstItemId = insertItem(database, 'a.com/1')
        const secondItemId = insertItem(database, 'a.com/2')
        libraryRepository.upsertNote(firstItemId, '첫째 메모')
        libraryRepository.upsertNote(secondItemId, '둘째 메모')
        expect(libraryRepository.findSaveByItemId(firstItemId)).toBeNull()

        libraryRepository.deleteNote(firstItemId)
        libraryRepository.deleteNote(firstItemId)
        expect(libraryRepository.findNoteByItemId(firstItemId)).toBeNull()
        expect(libraryRepository.findNoteByItemId(secondItemId)!.body).toBe('둘째 메모')
    })

    it('읽음: 없으면 null, 다시 읽어도 처음 읽은 시각을 그대로 둔다', () => {
        const database = openTestDatabase()
        const libraryRepository = createLibraryRepository(database)
        const itemId = insertItem(database, 'a.com/1')

        expect(libraryRepository.findReadByItemId(itemId)).toBeNull()
        libraryRepository.insertReadIfAbsent(itemId, '2026-10-07T01:00:00.000Z')
        libraryRepository.insertReadIfAbsent(itemId, '2026-10-08T01:00:00.000Z')
        expect(libraryRepository.findReadByItemId(itemId)).toEqual({ itemId, readAt: '2026-10-07T01:00:00.000Z' })
    })

    it('없는 기사에는 저장 · 메모 · 읽음을 남길 수 없다 (외래 키)', () => {
        const database = openTestDatabase()
        const libraryRepository = createLibraryRepository(database)

        expect(() => libraryRepository.insertSaveIfAbsent(999)).toThrow()
        expect(() => libraryRepository.upsertNote(999, '메모')).toThrow()
        expect(() => libraryRepository.insertReadIfAbsent(999)).toThrow()
    })
})
