// ============================================================================
// DB 스키마
//
// [역할]
// - 앱의 모든 테이블을 Drizzle 테이블 정의로 선언 (컬럼 이름 · 타입 · 기본값 · 인덱스의 한 곳)
// - 저장소(repositories/)는 이 정의로만 쿼리를 작성 (쿼리 결과 타입이 여기서 나옴)
// - 스키마 변경: 이 파일을 고친 뒤 `npm run db:generate`로 migrations/에 변경 SQL 생성
// - 전문 검색 테이블(search_fts)은 FTS5 가상 테이블이라 여기 없음 (migrations/의 직접 쓴 SQL로 생성, search 저장소가 다룸)
// - 시각은 모두 ISO 문자열, JSON 컬럼은 타입을 붙여 읽고 씀
// - 테이블마다 쓰는 프로세스는 하나 (Worker: 기사 · 브리핑 · 실행 기록 / Main: 사용자 데이터 · 설정)
// ============================================================================
import { sql } from 'drizzle-orm'
import { customType, index, integer, primaryKey, real, sqliteTable, text, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import type { Category, DigestStats, Section, SourceRef } from '@shared/types'

// 대소문자를 가리지 않고 비교하는 글자 컬럼 (태그 이름: 'MCP'와 'mcp'를 같은 태그로)
const textNoCase = customType<{ data: string }>({ dataType: () => 'text COLLATE NOCASE' })

// =============================== Worker가 쓰는 테이블 ===================================

// 수집한 글 (같은 소식은 한 행으로 합침)
export const items = sqliteTable(
    'items',
    {
        id: integer('id').primaryKey(),
        urlKey: text('url_key').notNull().unique(), // 정규화한 주소 (중복 판정 기준)
        url: text('url').notNull(),
        sourceId: text('source_id').notNull(), // 처음 수집한 출처 (config/sources.yaml의 id)
        sourceName: text('source_name').notNull(),
        kind: text('kind').notNull(), // 글 종류 (news · paper · release 등)
        title: text('title').notNull(),
        titleNorm: text('title_norm').notNull(), // 정규화한 제목 (중복 판정 기준)
        snippet: text('snippet').notNull().default(''), // 출처가 준 짧은 소개 글
        lang: text('lang'),
        publishedAt: text('published_at'),
        collectedAt: text('collected_at').notNull(),
        engagement: integer('engagement').notNull().default(0), // 참여도 숫자 (HN 점수 등)
        engagementLabel: text('engagement_label'),
        otherSources: text('other_sources', { mode: 'json' })
            .$type<SourceRef[]>()
            .notNull()
            .default(sql`'[]'`), // 같은 소식을 다룬 다른 출처
        triageCategory: text('triage_category').$type<Category>(), // 선별 결과 (선별 전이면 null)
        triageRelevance: real('triage_relevance'),
        triageImportance: integer('triage_importance'),
        triagedAt: text('triaged_at'),
        titleKo: text('title_ko'), // 요약 결과 (요약 전이면 null)
        summaryKo: text('summary_ko'),
        keyPoints: text('key_points', { mode: 'json' }).$type<string[]>(),
        summaryModel: text('summary_model'),
        summarizedAt: text('summarized_at'),
        mergedInto: integer('merged_into').references((): AnySQLiteColumn => items.id), // 다른 글에 합쳐졌으면 그 대표 글
        whyKo: text('why_ko'), // "왜 중요한가"
        followUpOf: integer('follow_up_of').references((): AnySQLiteColumn => items.id) // 지난 7일 브리핑 기사의 후속 소식이면 그 기사
    },
    (table) => [index('items_collected').on(table.collectedAt), index('items_title_norm').on(table.titleNorm)]
)

// 기사 본문 (추출한 문단과 번역)
export const contents = sqliteTable('contents', {
    itemId: integer('item_id')
        .primaryKey()
        .references(() => items.id, { onDelete: 'cascade' }),
    paragraphs: text('paragraphs', { mode: 'json' }).$type<string[]>().notNull(),
    fullText: integer('full_text', { mode: 'boolean' }).notNull(), // 원문에서 본문을 추출했는지 (false면 소개 글만)
    extractedAt: text('extracted_at').notNull(),
    paragraphsKo: text('paragraphs_ko', { mode: 'json' }).$type<(string | null)[]>(), // paragraphs와 같은 길이, 번역하지 않은 문단은 null
    translatedAt: text('translated_at'),
    translateModel: text('translate_model')
})

// 브리핑 한 호 (날짜마다 하나)
export const digests = sqliteTable('digests', {
    id: integer('id').primaryKey(),
    date: text('date').notNull().unique(), // 'YYYY-MM-DD'
    headline: text('headline').notNull(),
    overview: text('overview'),
    stats: text('stats', { mode: 'json' }).$type<DigestStats>().notNull(),
    createdAt: text('created_at').notNull()
})

// 브리핑에 실린 기사
export const digestEntries = sqliteTable(
    'digest_entries',
    {
        digestId: integer('digest_id')
            .notNull()
            .references(() => digests.id, { onDelete: 'cascade' }),
        itemId: integer('item_id')
            .notNull()
            .references(() => items.id),
        rank: integer('rank').notNull(), // 지면 순서 (1부터)
        section: text('section').$type<Section>().notNull(),
        whyItMatters: text('why_it_matters')
    },
    (table) => [primaryKey({ columns: [table.digestId, table.itemId] }), index('digest_entries_item').on(table.itemId)]
)

// 브리핑 생성 실행 기록
export const runs = sqliteTable('runs', {
    id: integer('id').primaryKey(),
    reason: text('reason').notNull(),
    startedAt: text('started_at').notNull(),
    finishedAt: text('finished_at'),
    status: text('status', { enum: ['running', 'ok', 'error'] }).notNull(),
    since: text('since').notNull(), // 이 실행의 수집 구간 시작
    error: text('error'),
    stats: text('stats', { mode: 'json' }).$type<unknown>() // 성공: 브리핑 통계 + 쓴 토큰 수, 실패: 쓴 토큰 수만
})

// LLM 호출 한 번의 사용량
export const llmUsage = sqliteTable(
    'llm_usage',
    {
        id: integer('id').primaryKey(),
        at: text('at').notNull(),
        runId: integer('run_id'), // 브리핑 실행 밖의 호출(번역 · 태그 · 질문)이면 null
        role: text('role').notNull(),
        model: text('model').notNull(),
        inputTokens: integer('input_tokens').notNull(),
        cachedTokens: integer('cached_tokens').notNull(),
        outputTokens: integer('output_tokens').notNull(),
        reasoningTokens: integer('reasoning_tokens').notNull(),
        latencyMs: integer('latency_ms').notNull(),
        costUsd: real('cost_usd').notNull()
    },
    (table) => [index('llm_usage_at').on(table.at)]
)

// 출처 하나를 한 번 수집한 기록
export const sourceFetches = sqliteTable(
    'source_fetches',
    {
        id: integer('id').primaryKey(),
        sourceId: text('source_id').notNull(),
        at: text('at').notNull(),
        reason: text('reason').notNull(), // briefing: 브리핑 생성, collect: 낮 동안 미리 수집
        ok: integer('ok', { mode: 'boolean' }).notNull(),
        fetched: integer('fetched').notNull(), // 피드에서 받은 글 수
        newItems: integer('new_items').notNull(), // 그중 처음 본 글 수
        error: text('error')
    },
    (table) => [index('source_fetches_source').on(table.sourceId, table.at)]
)

// =============================== Main이 쓰는 테이블 ===================================

// 저장한 기사
export const saves = sqliteTable('saves', {
    itemId: integer('item_id')
        .primaryKey()
        .references(() => items.id),
    savedAt: text('saved_at').notNull(),
    enrichedAt: text('enriched_at') // 저장 후 본문 추출 · 태그 추천을 마친 시각 (아직이면 null)
})

// 기사 메모
export const notes = sqliteTable('notes', {
    itemId: integer('item_id')
        .primaryKey()
        .references(() => items.id),
    body: text('body').notNull(),
    updatedAt: text('updated_at').notNull()
})

// 읽음 표시
export const reads = sqliteTable('reads', {
    itemId: integer('item_id')
        .primaryKey()
        .references(() => items.id),
    readAt: text('read_at').notNull()
})

// 태그
export const tags = sqliteTable('tags', {
    id: integer('id').primaryKey(),
    name: textNoCase('name').notNull().unique()
})

// 기사에 붙은 태그
export const itemTags = sqliteTable(
    'item_tags',
    {
        itemId: integer('item_id')
            .notNull()
            .references(() => items.id),
        tagId: integer('tag_id')
            .notNull()
            .references(() => tags.id, { onDelete: 'cascade' }),
        source: text('source', { enum: ['auto', 'user'] }).notNull() // auto: AI 추천, user: 직접 입력
    },
    (table) => [primaryKey({ columns: [table.itemId, table.tagId] }), index('item_tags_tag').on(table.tagId)]
)

// 하이라이트
export const highlights = sqliteTable(
    'highlights',
    {
        id: integer('id').primaryKey(),
        itemId: integer('item_id')
            .notNull()
            .references(() => items.id),
        paragraph: integer('paragraph').notNull(), // ¶ 번호 (1부터)
        variant: text('variant', { enum: ['ko', 'original'] }).notNull(), // ko: 번역문에 그음, original: 원문에 그음
        startOffset: integer('start_offset').notNull(), // 문단 글자 안의 위치 [start, end)
        endOffset: integer('end_offset').notNull(),
        text: text('text').notNull(), // 그은 글자 (본문이 바뀌어도 다시 찾을 수 있게 보관)
        note: text('note').notNull().default(''),
        createdAt: text('created_at').notNull()
    },
    (table) => [index('highlights_item').on(table.itemId, table.paragraph)]
)

// 설정 (키 · 값)
export const settings = sqliteTable('settings', {
    key: text('key').primaryKey(),
    value: text('value').notNull()
})

// 질문 대화 (범위마다 하나: 기사 하나 또는 그날 브리핑)
export const chats = sqliteTable('chats', {
    id: integer('id').primaryKey(),
    scopeKey: text('scope_key').notNull().unique(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
})

// 대화의 메시지
export const chatMessages = sqliteTable(
    'chat_messages',
    {
        id: integer('id').primaryKey(),
        chatId: integer('chat_id')
            .notNull()
            .references(() => chats.id, { onDelete: 'cascade' }),
        role: text('role', { enum: ['user', 'assistant'] }).notNull(),
        content: text('content').notNull(),
        citations: text('citations', { mode: 'json' })
            .$type<number[]>()
            .notNull()
            .default(sql`'[]'`), // 답변이 인용한 번호
        model: text('model'),
        createdAt: text('created_at').notNull()
    },
    (table) => [index('chat_messages_chat').on(table.chatId, table.id)]
)
