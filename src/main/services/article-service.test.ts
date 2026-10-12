// ============================================================================
// 기사 서비스 테스트
//
// [역할]
// - 메모 규칙(쓰면 자동 저장, 빈 메모는 삭제, 검색 색인 갱신)과 읽음 · 저장 확인
// - 기사 상세의 번역 상태(필요 없음 · 있음 · 없음) 확인
// - 저장 후 보강: 추천 태그 붙이기, 보강 완료 표시, 화면 알림, 이어지는 번역 요청과 그 조건 확인
// - Worker 호출과 화면 알림만 가짜로 대신하고 저장소는 메모리 DB에 실제로 붙임
// ============================================================================
import { describe, expect, it, vi } from 'vitest'
import { needsTranslation } from '@domain/translation'
import { ArticleService } from './article-service'
import { TagService } from './tag-service'
import { createFakeEvents, createFakeWorker, createTestRepositories, insertTestItem, type FakeWorkerHandlers } from './test-support'

function setup(workerHandlers: FakeWorkerHandlers = {}) {
    const repositories = createTestRepositories()
    const fakeWorker = createFakeWorker({
        enrichItem: () => ({ contentUpdated: false, suggestedTags: [] }),
        translateItem: () => false,
        ...workerHandlers
    })
    const events = createFakeEvents()
    const log = vi.fn()
    const tagService = new TagService({ database: repositories.database, tagRepository: repositories.tagRepository })
    const articleService = new ArticleService({ ...repositories, tags: tagService, worker: fakeWorker.worker, events, log })
    return { ...repositories, articleService, tagService, workerCall: fakeWorker.call, events, log }
}

// LLM 호출 한 번의 사용량을 넣어 이번 달 사용액을 올림
function recordCost(llmUsageRepository: ReturnType<typeof createTestRepositories>['llmUsageRepository'], costUsd: number): void {
    llmUsageRepository.insertUsage({
        runId: null,
        role: 'summary',
        model: 'test-model',
        usage: { input: 0, cachedInput: 0, output: 0, reasoning: 0 },
        latencyMs: 0,
        costUsd
    })
}

describe('ArticleService', () => {
    it('메모를 쓰면 자동으로 저장되고, 저장한 시각을 돌려주며, 메모 내용으로 검색된다', () => {
        const { articleService, itemRepository, searchRepository } = setup()
        const itemId = insertTestItem(itemRepository)

        const { savedAt } = articleService.saveMemo(itemId, '사내 분류기 비용 비교')
        const itemDetail = articleService.getItemDetail(itemId)!
        expect(itemDetail).toMatchObject({ memo: '사내 분류기 비용 비교', isSaved: true, savedAt })
        expect(searchRepository.searchItems({ scope: 'saved', query: '분류기' }).map((libraryItem) => libraryItem.itemId)).toEqual([itemId])
    })

    it('이미 저장한 기사에 메모를 써도 처음 저장한 시각은 그대로다', () => {
        const { articleService, itemRepository, libraryRepository } = setup()
        const itemId = insertTestItem(itemRepository)
        libraryRepository.insertSaveIfAbsent(itemId, '2026-10-01T00:00:00.000Z')

        articleService.saveMemo(itemId, '메모')
        expect(articleService.getItemDetail(itemId)!.savedAt).toBe('2026-10-01T00:00:00.000Z')
    })

    it('빈 메모(공백뿐)는 메모를 지우고, 저장은 그대로 두며, 검색에서도 빠진다', () => {
        const { articleService, itemRepository, libraryRepository, searchRepository } = setup()
        const itemId = insertTestItem(itemRepository)
        articleService.saveMemo(itemId, '비용 계산해 볼 것')

        articleService.saveMemo(itemId, '  ')
        expect(libraryRepository.findNoteByItemId(itemId)).toBeNull()
        expect(articleService.getItemDetail(itemId)).toMatchObject({ memo: '', isSaved: true })
        expect(searchRepository.searchItems({ scope: 'saved', query: '계산해' })).toEqual([])
    })

    it('저장하지 않은 기사에 빈 메모를 보내도 저장되지 않는다', () => {
        const { articleService, itemRepository, workerCall } = setup()
        const itemId = insertTestItem(itemRepository)

        articleService.saveMemo(itemId, '')
        expect(articleService.getItemDetail(itemId)).toMatchObject({ isSaved: false })
        expect(workerCall).not.toHaveBeenCalled()
    })

    it('읽음 · 저장 · 저장 해제가 기사 상세에 반영된다', () => {
        const { articleService, itemRepository } = setup()
        const itemId = insertTestItem(itemRepository)
        expect(articleService.getItemDetail(itemId)).toMatchObject({ isRead: false, isSaved: false })

        articleService.markRead(itemId)
        articleService.setSaved(itemId, true)
        expect(articleService.getItemDetail(itemId)).toMatchObject({ isRead: true, isSaved: true })

        articleService.setSaved(itemId, false)
        expect(articleService.getItemDetail(itemId)).toMatchObject({ isSaved: false, savedAt: null })
    })

    it('기사 상세: 없는 기사는 null, 보관된 본문이 없으면 소개 글을 문단 하나로 돌려준다', () => {
        const { articleService, itemRepository } = setup()
        expect(articleService.getItemDetail(999)).toBeNull()

        const itemId = insertTestItem(itemRepository, { snippet: '요약만 있음' })
        expect(articleService.getItemDetail(itemId)).toMatchObject({ paragraphs: ['요약만 있음'], hasFullText: false })
        itemRepository.upsertContent(itemId, ['첫 문단', '둘째 문단'], true)
        expect(articleService.getItemDetail(itemId)).toMatchObject({ paragraphs: ['첫 문단', '둘째 문단'], hasFullText: true })
    })

    it('번역 상태: 번역이 없으면 missing, 있으면 done, 한국어 기사는 not_needed', () => {
        const { articleService, itemRepository } = setup()
        const englishItemId = insertTestItem(itemRepository)
        itemRepository.upsertContent(englishItemId, ['First paragraph.', 'Second paragraph.'], true)
        expect(articleService.getItemDetail(englishItemId)).toMatchObject({ translation: 'missing', paragraphsKo: null })

        itemRepository.updateContentTranslation(englishItemId, ['첫째 문단 번역', null], 'test-model')
        expect(articleService.getItemDetail(englishItemId)).toMatchObject({ translation: 'done', paragraphsKo: ['첫째 문단 번역', null] })

        const koreanItemId = insertTestItem(itemRepository, { lang: 'ko', title: 'Claude 4 출시' })
        expect(articleService.getItemDetail(koreanItemId)).toMatchObject({ translation: 'not_needed' })
    })

    it('번역이 필요한지: 소스 언어가 ko이거나 한글이 30% 이상이면 필요 없다', () => {
        expect(needsTranslation({ lang: 'ko', title: 'Claude 4 출시', snippet: '' })).toBe(false)
        expect(needsTranslation({ lang: null, title: '앤트로픽이 새 모델을 공개했다', snippet: '오늘 발표된 Claude는…' })).toBe(false)
        expect(needsTranslation({ lang: 'en', title: 'Claude 4 released', snippet: 'Anthropic today…' })).toBe(true)
    })

    it('번역 요청: Worker의 결과를 돌려주고 끝나면 화면에 기사 변경을 알린다', async () => {
        const { articleService, itemRepository, workerCall, events } = setup({ translateItem: () => true })
        const itemId = insertTestItem(itemRepository)

        await expect(articleService.translateItem(itemId)).resolves.toBe(true)
        expect(workerCall).toHaveBeenCalledWith('translateItem', { itemId })
        expect(events.itemUpdated).toHaveBeenCalledWith(itemId)
    })

    it('저장 후 보강: 추천 태그를 정리해 자동 태그로 붙이고, 보강 완료로 표시하고, 화면에 알린 뒤 번역을 요청한다', async () => {
        const { articleService, itemRepository, libraryRepository, tagService, workerCall, events } = setup({
            enrichItem: () => ({ contentUpdated: true, suggestedTags: ['Coding Agent', 'MCP', 'open weight', '넷째'] })
        })
        const otherItemId = insertTestItem(itemRepository)
        tagService.addTag(otherItemId, 'open-weight') // 하이픈만 다른 기존 태그
        const itemId = insertTestItem(itemRepository)

        articleService.setSaved(itemId, true)
        await vi.waitFor(() => expect(workerCall).toHaveBeenCalledWith('translateItem', { itemId }))

        // 추천 태그는 앞에서 3개까지, 이름 정리와 하이픈 규칙을 거쳐 붙음
        expect(workerCall).toHaveBeenCalledWith('enrichItem', { itemId })
        expect(articleService.getItemDetail(itemId)!.tags).toEqual(['coding-agent', 'mcp', 'open-weight'])
        expect(libraryRepository.findSaveByItemId(itemId)!.enrichedAt).not.toBeNull()
        expect(events.itemUpdated).toHaveBeenCalledWith(itemId)
    })

    it('저장 후 보강: 이미 보강한 기사는 다시 하지 않는다', async () => {
        const { articleService, itemRepository, libraryRepository, workerCall } = setup()
        const itemId = insertTestItem(itemRepository)

        articleService.setSaved(itemId, true)
        await vi.waitFor(() => expect(libraryRepository.findSaveByItemId(itemId)!.enrichedAt).not.toBeNull())
        await vi.waitFor(() => expect(workerCall).toHaveBeenCalledWith('translateItem', { itemId }))
        workerCall.mockClear()

        // 다시 저장하거나 메모를 써도 보강을 시작하지 않음
        articleService.setSaved(itemId, true)
        articleService.saveMemo(itemId, '메모')
        expect(workerCall).not.toHaveBeenCalled()
    })

    it('저장 후 보강: 메모로 저장된 기사도 보강한다', async () => {
        const { articleService, itemRepository, libraryRepository, workerCall } = setup({
            enrichItem: () => ({ contentUpdated: false, suggestedTags: ['mcp'] })
        })
        const itemId = insertTestItem(itemRepository)

        articleService.saveMemo(itemId, '나중에 읽기')
        await vi.waitFor(() => expect(libraryRepository.findSaveByItemId(itemId)!.enrichedAt).not.toBeNull())
        expect(workerCall).toHaveBeenCalledWith('enrichItem', { itemId })
        expect(articleService.getItemDetail(itemId)!.tags).toEqual(['mcp'])
    })

    it('저장 후 보강: 절약 모드(이번 달 사용액이 월 예산 이상)면 번역을 미리 요청하지 않는다', async () => {
        const { articleService, itemRepository, llmUsageRepository, workerCall, events } = setup()
        recordCost(llmUsageRepository, 5) // 기본 월 예산 5달러에 도달
        const itemId = insertTestItem(itemRepository)

        articleService.setSaved(itemId, true)
        await vi.waitFor(() => expect(events.itemUpdated).toHaveBeenCalledWith(itemId))
        expect(workerCall).toHaveBeenCalledTimes(1)
        expect(workerCall).toHaveBeenCalledWith('enrichItem', { itemId })
    })

    it('저장 후 보강: Worker가 실패하면 기록만 남기고 보강 완료로 표시하지 않는다 (저장은 유지)', async () => {
        const { articleService, itemRepository, libraryRepository, events, log } = setup({
            enrichItem: () => {
                throw new Error('Worker가 종료됐습니다.')
            }
        })
        const itemId = insertTestItem(itemRepository)

        articleService.setSaved(itemId, true)
        await vi.waitFor(() => expect(log).toHaveBeenCalledWith('enrich-failed', expect.stringContaining('Worker가 종료됐습니다.')))
        expect(libraryRepository.findSaveByItemId(itemId)).toMatchObject({ enrichedAt: null })
        expect(events.itemUpdated).not.toHaveBeenCalled()
    })
})
