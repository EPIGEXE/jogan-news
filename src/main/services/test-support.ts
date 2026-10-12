// ============================================================================
// 서비스 테스트 도우미
//
// [역할]
// - Main 서비스 테스트가 함께 쓰는 준비물 제공 (제품 코드에서는 쓰지 않음)
// - 메모리 DB에 실제 저장소를 모두 붙인 묶음, 기사 한 건 넣기
// - 다른 프로세스(Worker)와 화면 알림만 가짜로 대신함 (저장소는 가짜로 바꾸지 않음)
// ============================================================================
import { vi, type Mock } from 'vitest'
import type { WorkerApi, WorkerMethod } from '@shared/worker-protocol'
import type { AppDatabase } from '@data/client'
import { createChatRepository } from '@data/repositories/chat-repository'
import { createDigestRepository } from '@data/repositories/digest-repository'
import { createHighlightRepository } from '@data/repositories/highlight-repository'
import { createItemRepository, type ItemRepository, type NewItem } from '@data/repositories/item-repository'
import { createLibraryRepository } from '@data/repositories/library-repository'
import { createLlmUsageRepository } from '@data/repositories/llm-usage-repository'
import { createSearchRepository } from '@data/repositories/search-repository'
import { createSettingsRepository } from '@data/repositories/settings-repository'
import { createSourceFetchRepository } from '@data/repositories/source-fetch-repository'
import { createTagRepository } from '@data/repositories/tag-repository'
import { openTestDatabase } from '@data/testing'
import type { RendererEvents, WorkerRpc } from './ports'

/**
 * 빈 메모리 DB와 그 DB에 붙인 실제 저장소 전부
 *
 * @returns DB 연결과 저장소들
 */
export function createTestRepositories() {
    const database: AppDatabase = openTestDatabase()
    return {
        database,
        itemRepository: createItemRepository(database),
        digestRepository: createDigestRepository(database),
        libraryRepository: createLibraryRepository(database),
        tagRepository: createTagRepository(database),
        highlightRepository: createHighlightRepository(database),
        chatRepository: createChatRepository(database),
        searchRepository: createSearchRepository(database),
        settingsRepository: createSettingsRepository(database),
        llmUsageRepository: createLlmUsageRepository(database),
        sourceFetchRepository: createSourceFetchRepository(database)
    }
}

let testItemSequence = 0 // 기사마다 주소가 겹치지 않게 붙이는 순번

/**
 * 테스트용 기사 한 건 넣기
 *
 * @param {ItemRepository} itemRepository - 기사 저장소
 * @param {Partial<NewItem>} itemOverrides - 기본값 대신 쓸 값
 * @returns {number} 기사 번호
 */
export function insertTestItem(itemRepository: ItemRepository, itemOverrides: Partial<NewItem> = {}): number {
    const itemSequence = ++testItemSequence
    return itemRepository.insertItem({
        urlKey: `example.com/${itemSequence}`,
        url: `https://example.com/${itemSequence}`,
        sourceId: 'hn',
        sourceName: 'Hacker News',
        kind: 'community',
        title: 'Mistral Large 4 released',
        titleNorm: `mistral large 4 released ${itemSequence}`,
        snippet: '',
        lang: 'en',
        publishedAt: null,
        engagement: 100,
        engagementLabel: 'HN 100점',
        ...itemOverrides
    })
}

// Worker 기능별 가짜 구현 (넣지 않은 기능을 부르면 오류)
export type FakeWorkerHandlers = {
    [Method in WorkerMethod]?: (
        params: Parameters<WorkerApi[Method]>[0]
    ) => ReturnType<WorkerApi[Method]> | Promise<ReturnType<WorkerApi[Method]>>
}

// 가짜 Worker 호출과 그 호출 기록
export interface FakeWorker {
    call: Mock<(method: WorkerMethod, params?: unknown) => Promise<unknown>> // 기능 호출 기록
    setApiKey: Mock<(apiKey: string | null) => void> // API 키 전달 기록
    worker: WorkerRpc // 서비스에 넣을 Worker 호출
}

// 화면 알림마다 호출 기록을 볼 수 있는 가짜 함수 묶음
export type FakeEvents = { [EventName in keyof RendererEvents]: Mock<RendererEvents[EventName]> }

/**
 * 가짜 Worker 호출
 *
 * @param {FakeWorkerHandlers} handlers - 기능 이름별 가짜 구현
 * @returns 서비스에 넣을 Worker 호출 (call · setApiKey는 호출 기록을 볼 수 있는 가짜 함수)
 */
export function createFakeWorker(handlers: FakeWorkerHandlers = {}): FakeWorker {
    const call = vi.fn(async (method: WorkerMethod, params?: unknown) => {
        const handler = handlers[method] as ((handlerParams: unknown) => unknown) | undefined
        if (!handler) throw new Error(`가짜 Worker에 없는 기능: ${method}`)
        return handler(params)
    })
    const setApiKey = vi.fn<(apiKey: string | null) => void>()
    return { call, setApiKey, worker: { call, setApiKey } as unknown as WorkerRpc }
}

/**
 * 화면 알림 기록용 가짜
 *
 * @returns 알림마다 호출 기록을 볼 수 있는 가짜 함수 묶음
 */
export function createFakeEvents(): FakeEvents {
    return {
        runProgress: vi.fn(),
        digestUpdated: vi.fn(),
        itemUpdated: vi.fn(),
        navigate: vi.fn(),
        chatEvent: vi.fn()
    }
}
