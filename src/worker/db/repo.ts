// ============================================================================
// DB 저장소
//
// [역할]
// - 앱의 모든 SQL을 한곳에 모음 (다른 모듈은 SQL을 직접 쓰지 않고 이 파일의 함수만 호출)
// - 수집한 글 저장: URL이 같거나 최근 3일 안에 제목이 같으면 새로 만들지 않고 출처 · 참여도만 합침
// - 브리핑 후보 · 지난 며칠 동안 실린 기사 조회, 같은 소식 합치기, 선별 · 요약 · 본문 · 번역 결과 저장
// - 브리핑 게시 · 조회 (하루 한 호, 같은 날짜는 내용 교체), 기사 상세 · 검색 결과를 화면용 모양으로 변환
// - 사용자 동작 저장: 읽음 · 저장 · 메모 · 태그 · 하이라이트 (메모 · 하이라이트를 남긴 기사는 자동 저장)
// - 기사 내용이 바뀌는 모든 곳에서 전문 검색 색인 갱신
// - 실행 기록 · LLM 사용량 · 출처별 수집 기록 · 설정 · AI 질문 대화 저장과 집계
// - 시각은 ISO 형식 글자, 브리핑 날짜는 로컬 'YYYY-MM-DD', 목록 · 통계 열은 JSON 글자로 저장하고 읽을 때 풀어 줌
// ============================================================================
import type { SQLInputValue } from 'node:sqlite'
import {
    DEFAULT_SETTINGS,
    type AppSettings,
    type Category,
    type ChatMessageDTO,
    type ChatScope,
    type DigestDTO,
    type DigestEntryDTO,
    type DigestStats,
    type DigestSummaryDTO,
    type FunnelCounts,
    type HighlightDTO,
    type HighlightRange,
    type ItemDetailDTO,
    type LibraryItemDTO,
    type SearchParams,
    type Section,
    type SourceFetchDTO,
    type SourceRef,
    type TagCount
} from '@shared/types'
import type { RawItem } from '../collectors/types'
import type { ItemKind } from '../config'
import type { TokenUsage } from '../llm/pricing'
import { normalizeTitle, urlKey } from '../pipeline/normalize'
import { runInTransaction, type Db } from './db'

// items 테이블의 한 행 (이 파일 밖에서도 쓰는 열만)
export interface ItemRow {
    id: number // 기사 번호
    url: string // 원문 주소
    source_id: string // 수집한 출처의 ID
    source_name: string // 출처 표시 이름
    kind: ItemKind // 글 종류
    title: string // 원래 제목
    snippet: string // 수집할 때 받은 소개 글 (없으면 빈 글자)
    lang: string | null // 소스 언어 ('ko' 등, 없으면 null)
    published_at: string | null // 원문 게시 시각 (없으면 null)
    collected_at: string // 수집한 시각
    engagement: number // 대표 참여도 숫자 (같은 글을 다룬 출처 중 가장 큰 값)
    engagement_label: string | null // 대표 참여도의 표시 문구
    other_sources: string // 같은 소식을 다룬 다른 출처 목록 (SourceRef[]의 JSON)
    triage_category: Category | null // AI 선별이 매긴 분류 (선별 전이면 null)
    triage_relevance: number | null // AI 선별이 매긴 관련도
    triage_importance: number | null // AI 선별이 매긴 중요도
    title_ko: string | null // 한국어 제목 (요약 전이면 null)
    summary_ko: string | null // 한국어 요약
    key_points: string | null // 핵심 포인트 (string[]의 JSON)
    why_ko: string | null // 왜 중요한가
    follow_up_of: number | null // 지난 브리핑 기사의 후속 소식이면 그 지난 기사의 번호
}

const nowIso = () => new Date().toISOString() // 지금 시각 (ISO 형식 글자)

// 여러 행 조회 (없으면 빈 배열)
function selectRows<T>(db: Db, sql: string, ...params: SQLInputValue[]): T[] {
    return db.prepare(sql).all(...params) as T[]
}
// 한 행 조회 (없으면 undefined)
function selectRow<T>(db: Db, sql: string, ...params: SQLInputValue[]): T | undefined {
    return db.prepare(sql).get(...params) as T | undefined
}
// 변경 실행 (INSERT · UPDATE · DELETE, 실행 결과는 돌려주지 않음)
function execute(db: Db, sql: string, ...params: SQLInputValue[]): void {
    db.prepare(sql).run(...params)
}

// =============================== 수집 ===================================

/**
 * 수집한 글 한 건 저장 (DESIGN.md 9절 ③)
 * - 같은 글이 이미 있으면(URL이 같거나 최근 3일 안에 제목이 같음) 새로 만들지 않고 출처 목록 · 참여도만 합침
 * - 처음 보는 글이면 새 행을 만들고 검색 색인에 올림
 *
 * @param {RawItem} rawItem - 수집기가 넘긴 글
 * @returns {{ id: number; isNew: boolean }} 기사 번호와 새로 만들었는지
 */
export function upsertRawItem(db: Db, rawItem: RawItem): { id: number; isNew: boolean } {
    // 중복 판정 기준 준비 (정규화한 URL · 정규화한 제목 · 제목을 비교할 구간의 시작)
    const rawUrlKey = urlKey(rawItem.url)
    const normalizedTitle = normalizeTitle(rawItem.title)
    const threeDaysAgoIso = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString() // 제목 비교 구간의 시작 (3일 전)

    // 같은 글 찾기: 정규화한 URL이 같은 글, 없으면 최근 3일 안에 수집했고 정규화한 제목이 같은 글
    // 제목 비교는 정규화한 제목이 12자 이상일 때만
    const existingItemRow =
        selectRow<ItemRow>(db, 'SELECT * FROM items WHERE url_key = ?', rawUrlKey) ??
        (normalizedTitle.length >= 12
            ? selectRow<ItemRow>(db, 'SELECT * FROM items WHERE title_norm = ? AND collected_at >= ?', normalizedTitle, threeDaysAgoIso)
            : undefined)

    // 처음 보는 글 → 새 행으로 저장하고 검색 색인에 올림
    if (!existingItemRow) {
        const itemInsertResult = db
            .prepare(
                `INSERT INTO items (url_key, url, source_id, source_name, kind, title, title_norm, snippet, lang,
           published_at, collected_at, engagement, engagement_label)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
                rawUrlKey,
                rawItem.url,
                rawItem.sourceId,
                rawItem.sourceName,
                rawItem.kind,
                rawItem.title,
                normalizedTitle,
                rawItem.snippet,
                rawItem.lang,
                rawItem.publishedAt,
                nowIso(),
                rawItem.engagement,
                rawItem.engagementLabel
            )
        const newItemId = Number(itemInsertResult.lastInsertRowid)
        reindexItem(db, newItemId)
        return { id: newItemId, isNew: true }
    }

    // 같은 출처에서 다시 들어온 글 → 참여도가 올랐으면 갱신, 비어 있던 소개 글은 채움
    if (existingItemRow.source_id === rawItem.sourceId) {
        if (rawItem.engagement > existingItemRow.engagement) {
            execute(
                db,
                'UPDATE items SET engagement = ?, engagement_label = ? WHERE id = ?',
                rawItem.engagement,
                rawItem.engagementLabel,
                existingItemRow.id
            )
        }
        if (!existingItemRow.snippet && rawItem.snippet) {
            execute(db, 'UPDATE items SET snippet = ? WHERE id = ?', rawItem.snippet, existingItemRow.id)
        }
        return { id: existingItemRow.id, isNew: false }
    }

    // 다른 출처에서 들어온 같은 글 → 그 출처를 다른 출처 목록에 추가 (이미 있는 출처 이름이면 그대로)
    const otherSources = JSON.parse(existingItemRow.other_sources) as SourceRef[]
    if (!otherSources.some((otherSource) => otherSource.sourceName === rawItem.sourceName)) {
        otherSources.push({ sourceName: rawItem.sourceName, url: rawItem.url, engagementLabel: rawItem.engagementLabel })
    }
    // 대표 참여도 · 소개 글 고르기
    // 참여도가 더 큰 출처(예: HN 점수)를 대표 참여도로 씀
    // 소개 글은 더 긴 쪽을 씀 (논문은 HF 초록이 더 길면 그것)
    const topEngagement = Math.max(existingItemRow.engagement, rawItem.engagement)
    const topEngagementLabel = rawItem.engagement > existingItemRow.engagement ? rawItem.engagementLabel : existingItemRow.engagement_label
    const longerSnippet = rawItem.snippet.length > existingItemRow.snippet.length ? rawItem.snippet : existingItemRow.snippet

    // 합친 출처 목록 · 대표 참여도 · 소개 글 저장
    execute(
        db,
        'UPDATE items SET other_sources = ?, engagement = ?, engagement_label = ?, snippet = ? WHERE id = ?',
        JSON.stringify(otherSources),
        topEngagement,
        topEngagementLabel,
        longerSnippet,
        existingItemRow.id
    )
    return { id: existingItemRow.id, isNew: false }
}

/**
 * 이번 브리핑의 후보 조회
 * - 수집 구간 안에 들어온 글만
 * - 다른 글에 합쳐진 글(merged_into)은 제외
 * - 오늘이 아닌 날의 브리핑에 이미 실린 글은 제외
 *
 * @param {string} sinceIso - 수집 구간의 시작 시각
 * @param {string} today - 오늘 날짜 ('YYYY-MM-DD')
 * @returns {ItemRow[]} 후보 기사 행
 */
export function getBriefingCandidates(db: Db, sinceIso: string, today: string): ItemRow[] {
    return selectRows<ItemRow>(
        db,
        `SELECT i.* FROM items i
     WHERE i.collected_at >= ?
       AND i.merged_into IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM digest_entries de JOIN digests d ON d.id = de.digest_id
         WHERE de.item_id = i.id AND d.date <> ?)`,
        sinceIso,
        today
    )
}

/**
 * 지난 며칠 동안 브리핑에 실린 기사 조회 (7일 중복 확인용)
 * - 오늘 브리핑은 제외
 *
 * @param {string} today - 오늘 날짜 ('YYYY-MM-DD')
 * @param {number} days - 며칠 전 브리핑까지 볼지
 * @returns {{ id: number; date: string; title: string }[]} 기사 번호 · 실린 날짜 · 제목 (한국어 제목이 없으면 원래 제목)
 */
export function listRecentPublished(db: Db, today: string, days: number): { id: number; date: string; title: string }[] {
    // 조회 구간의 시작 날짜 계산 (오늘에서 days일 전, 로컬 날짜)
    const windowStartDate = new Date(`${today}T00:00:00`)
    windowStartDate.setDate(windowStartDate.getDate() - days)
    const windowStartDateKey = `${windowStartDate.getFullYear()}-${String(windowStartDate.getMonth() + 1).padStart(2, '0')}-${String(windowStartDate.getDate()).padStart(2, '0')}`

    // 그 날짜부터 어제까지의 브리핑에 실린 기사 조회 (최근 날짜 · 순위 순)
    return selectRows<{ id: number; date: string; title: string }>(
        db,
        `SELECT i.id, d.date, coalesce(i.title_ko, i.title) AS title
     FROM digest_entries de JOIN digests d ON d.id = de.digest_id JOIN items i ON i.id = de.item_id
     WHERE d.date < ? AND d.date >= ?
     ORDER BY d.date DESC, de.rank`,
        today,
        windowStartDateKey
    )
}

/**
 * 지난 브리핑 기사의 후속 소식으로 표시
 *
 * @param {number} itemId - 후속 소식인 기사
 * @param {number} previousItemId - 지난 브리핑에 실린 기사
 */
export function markFollowUp(db: Db, itemId: number, previousItemId: number): void {
    execute(db, 'UPDATE items SET follow_up_of = ? WHERE id = ?', previousItemId, itemId)
}

/**
 * 같은 소식으로 묶인 글들을 대표 글 하나로 합침
 * - 나머지 글의 출처(그 글에 이미 합쳐져 있던 출처 포함)를 대표의 other_sources로 옮김
 * - 나머지 글에는 merged_into를 표시해 다음 후보에서 빠지게 함
 * - 대표 참여도는 묶인 글 중 가장 큰 값
 *
 * @param {number} representativeItemId - 대표 기사
 * @param {number[]} memberItemIds - 같은 소식으로 묶인 기사들 (대표가 들어 있으면 건너뜀)
 * @returns {{ otherSources: number; engagement: number }} 합친 뒤 대표의 다른 출처 개수와 참여도
 */
export function mergeItemsInto(
    db: Db,
    representativeItemId: number,
    memberItemIds: number[]
): { otherSources: number; engagement: number } {
    return runInTransaction(db, () => {
        // 대표 글의 현재 출처 목록 · 참여도에서 시작
        const representativeRow = selectRow<ItemRow>(db, 'SELECT * FROM items WHERE id = ?', representativeItemId)!
        const mergedOtherSources = JSON.parse(representativeRow.other_sources) as SourceRef[] // 합친 뒤 대표의 다른 출처 목록
        let mergedEngagement = representativeRow.engagement // 묶인 글 중 가장 큰 참여도
        let mergedEngagementLabel = representativeRow.engagement_label // 그 참여도의 표시 문구

        // 다른 출처 목록에 출처 하나 추가
        // 대표 글 자신의 출처이거나 이미 목록에 있는 출처(이름 · 주소가 같음)면 넣지 않음
        const addOtherSource = (sourceRef: SourceRef) => {
            if (sourceRef.sourceName === representativeRow.source_name && sourceRef.url === representativeRow.url) return
            if (!mergedOtherSources.some((knownRef) => knownRef.sourceName === sourceRef.sourceName && knownRef.url === sourceRef.url)) {
                mergedOtherSources.push(sourceRef)
            }
        }

        // 묶인 글마다 출처 · 참여도를 대표로 옮기고 합쳐졌다고 표시
        for (const memberItemId of memberItemIds) {
            const memberRow = selectRow<ItemRow>(db, 'SELECT * FROM items WHERE id = ?', memberItemId)
            // 없는 글이거나 대표 자신이면 건너뜀
            if (!memberRow || memberRow.id === representativeItemId) continue

            // 그 글의 출처와, 그 글에 이미 합쳐져 있던 다른 출처를 옮김
            addOtherSource({ sourceName: memberRow.source_name, url: memberRow.url, engagementLabel: memberRow.engagement_label })
            for (const memberOtherSource of JSON.parse(memberRow.other_sources) as SourceRef[]) addOtherSource(memberOtherSource)

            // 참여도가 더 크면 그 글의 참여도를 대표 참여도로
            if (memberRow.engagement > mergedEngagement) {
                mergedEngagement = memberRow.engagement
                mergedEngagementLabel = memberRow.engagement_label
            }

            // 대표에 합쳐졌다고 표시 (다음 후보에서 빠짐)
            execute(db, 'UPDATE items SET merged_into = ? WHERE id = ?', representativeItemId, memberRow.id)
        }

        // 대표 글에 합친 출처 목록 · 참여도 저장
        execute(
            db,
            'UPDATE items SET other_sources = ?, engagement = ?, engagement_label = ? WHERE id = ?',
            JSON.stringify(mergedOtherSources),
            mergedEngagement,
            mergedEngagementLabel,
            representativeItemId
        )
        return { otherSources: mergedOtherSources.length, engagement: mergedEngagement }
    })
}

/**
 * AI 선별 결과 저장 (분류 · 관련도 · 중요도와 선별한 시각)
 *
 * @param {number} itemId - 기사 번호
 * @param {{ category: Category; relevance: number; importance: number }} triage - 선별 결과
 */
export function saveTriage(db: Db, itemId: number, triage: { category: Category; relevance: number; importance: number }): void {
    execute(
        db,
        'UPDATE items SET triage_category = ?, triage_relevance = ?, triage_importance = ?, triaged_at = ? WHERE id = ?',
        triage.category,
        triage.relevance,
        triage.importance,
        nowIso(),
        itemId
    )
}

/**
 * 한국어 요약 저장 (제목 · 요약 · 핵심 포인트 · 왜 중요한가와 요약 모델 · 요약한 시각)
 * - 저장 뒤 검색 색인 갱신
 *
 * @param {number} itemId - 기사 번호
 * @param summary - 요약 결과
 * @param {string} summaryModel - 요약에 쓴 모델 이름
 */
export function saveSummary(
    db: Db,
    itemId: number,
    summary: { titleKo: string; summaryKo: string; keyPoints: string[]; whyKo: string },
    summaryModel: string
): void {
    execute(
        db,
        'UPDATE items SET title_ko = ?, summary_ko = ?, key_points = ?, why_ko = ?, summary_model = ?, summarized_at = ? WHERE id = ?',
        summary.titleKo,
        summary.summaryKo,
        JSON.stringify(summary.keyPoints),
        summary.whyKo,
        summaryModel,
        nowIso(),
        itemId
    )
    reindexItem(db, itemId)
}

// 보관된 본문
export interface ItemContent {
    paragraphs: string[] // 문단 목록
    fullText: boolean // 원문에서 본문을 추출했는지
    paragraphsKo: (string | null)[] | null // 문단별 번역 (아직 번역하지 않았으면 null)
}

/**
 * 보관된 본문 조회
 *
 * @returns {ItemContent | null} 본문과 번역 (보관된 본문이 없으면 null)
 */
export function getContent(db: Db, itemId: number): ItemContent | null {
    const contentRow = selectRow<{ paragraphs: string; full_text: number; paragraphs_ko: string | null }>(
        db,
        'SELECT paragraphs, full_text, paragraphs_ko FROM contents WHERE item_id = ?',
        itemId
    )
    if (!contentRow) return null
    return {
        paragraphs: JSON.parse(contentRow.paragraphs) as string[],
        fullText: contentRow.full_text === 1,
        paragraphsKo: contentRow.paragraphs_ko ? (JSON.parse(contentRow.paragraphs_ko) as (string | null)[]) : null
    }
}

/**
 * 문단별 번역 저장 (번역 모델 · 번역한 시각 포함)
 * - 본문을 다시 추출하면(saveContent) 번역은 지워짐
 * - 저장 뒤 검색 색인 갱신
 *
 * @param {(string | null)[]} paragraphsKo - 문단별 번역
 * @param {string} translateModel - 번역에 쓴 모델 이름
 */
export function saveTranslation(db: Db, itemId: number, paragraphsKo: (string | null)[], translateModel: string): void {
    execute(
        db,
        'UPDATE contents SET paragraphs_ko = ?, translated_at = ?, translate_model = ? WHERE item_id = ?',
        JSON.stringify(paragraphsKo),
        nowIso(),
        translateModel,
        itemId
    )
    reindexItem(db, itemId)
}

/**
 * 본문 저장
 * - 이미 본문이 있으면 새 본문으로 교체하고 번역 · 번역 시각 · 번역 모델을 지움
 * - 저장 뒤 검색 색인 갱신
 *
 * @param {string[]} paragraphs - 문단 목록
 * @param {boolean} fullText - 원문에서 본문을 추출했는지
 */
export function saveContent(db: Db, itemId: number, paragraphs: string[], fullText: boolean): void {
    execute(
        db,
        `INSERT INTO contents (item_id, paragraphs, full_text, extracted_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET paragraphs = excluded.paragraphs, full_text = excluded.full_text, extracted_at = excluded.extracted_at,
       paragraphs_ko = NULL, translated_at = NULL, translate_model = NULL`,
        itemId,
        JSON.stringify(paragraphs),
        fullText ? 1 : 0,
        nowIso()
    )
    reindexItem(db, itemId)
}

// =============================== 실행 기록 ===================================

/**
 * 브리핑 생성 실행 기록 시작 ('running' 상태로 저장)
 *
 * @param {string} reason - 실행을 시작한 계기
 * @param {string} sinceIso - 이번 수집 구간의 시작 시각
 * @returns {number} 실행 번호
 */
export function createRun(db: Db, reason: string, sinceIso: string): number {
    const runInsertResult = db
        .prepare('INSERT INTO runs (reason, started_at, status, since) VALUES (?, ?, ?, ?)')
        .run(reason, nowIso(), 'running', sinceIso)
    return Number(runInsertResult.lastInsertRowid)
}

/**
 * 실행 기록 마무리 (끝난 시각 · 상태 · 통계 · 실패 이유 저장)
 *
 * @param {unknown} stats - 실행 통계 (JSON으로 저장, 없으면 null)
 * @param {string} [errorMessage] - 실패 이유 (없으면 null로 저장)
 */
export function finishRun(db: Db, runId: number, status: 'ok' | 'error', stats: unknown, errorMessage?: string): void {
    execute(
        db,
        'UPDATE runs SET finished_at = ?, status = ?, stats = ?, error = ? WHERE id = ?',
        nowIso(),
        status,
        JSON.stringify(stats ?? null),
        errorMessage ?? null,
        runId
    )
}

/**
 * 지정한 시각보다 먼저 시작해 성공한 마지막 실행의 시작 시각 조회
 *
 * @param {string} beforeIso - 이 시각보다 먼저 시작한 실행만
 * @returns {string | null} 시작 시각 (그런 실행이 없으면 null)
 */
export function lastSuccessfulRunStartedAt(db: Db, beforeIso: string): string | null {
    return (
        selectRow<{ started_at: string }>(
            db,
            "SELECT started_at FROM runs WHERE status = 'ok' AND started_at < ? ORDER BY started_at DESC LIMIT 1",
            beforeIso
        )?.started_at ?? null
    )
}

/**
 * 앱이 중간에 꺼져 'running'으로 남은 실행을 오류로 정리
 */
export function abandonStaleRuns(db: Db): void {
    execute(db, "UPDATE runs SET status = 'error', error = '앱 종료로 중단됨', finished_at = ? WHERE status = 'running'", nowIso())
}

// =============================== LLM 사용량 ===================================

/**
 * LLM 호출 한 번의 사용량 기록 (토큰 수 · 걸린 시간 · 비용)
 *
 * @param llmCall - 호출 정보 (runId는 그 호출이 속한 실행 번호 또는 null, role은 호출 용도)
 */
export function recordUsage(
    db: Db,
    llmCall: { runId: number | null; role: string; model: string; usage: TokenUsage; latencyMs: number; costUsd: number }
): void {
    execute(
        db,
        `INSERT INTO llm_usage (at, run_id, role, model, input_tokens, cached_tokens, output_tokens, reasoning_tokens, latency_ms, cost_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        nowIso(),
        llmCall.runId,
        llmCall.role,
        llmCall.model,
        llmCall.usage.input,
        llmCall.usage.cachedInput,
        llmCall.usage.output,
        llmCall.usage.reasoning,
        llmCall.latencyMs,
        llmCall.costUsd
    )
}

/**
 * 지정한 시각 이후의 LLM 비용 합계
 *
 * @returns {number} 비용 (달러, 기록이 없으면 0)
 */
export function sumCostSince(db: Db, sinceIso: string): number {
    return selectRow<{ c: number | null }>(db, 'SELECT SUM(cost_usd) c FROM llm_usage WHERE at >= ?', sinceIso)?.c ?? 0
}

/**
 * 실행 한 번에 쓴 LLM 비용 합계
 *
 * @returns {number} 비용 (달러, 기록이 없으면 0)
 */
export function sumCostForRun(db: Db, runId: number): number {
    return selectRow<{ c: number | null }>(db, 'SELECT SUM(cost_usd) c FROM llm_usage WHERE run_id = ?', runId)?.c ?? 0
}

// =============================== 출처 통계 ===================================

/**
 * 출처 하나를 수집한 결과 기록
 *
 * @param sourceFetch - 출처 ID · 수집한 시각 · 수집 결과
 */
export function recordSourceFetch(
    db: Db,
    sourceFetch: {
        sourceId: string
        at: string
        reason: 'briefing' | 'collect' // briefing: 브리핑 생성, collect: 미리 수집
        ok: boolean
        fetched: number // 받은 글 수
        newItems: number // 그중 처음 본 글 수
        error: string | null // 실패 이유 (없으면 null)
    }
): void {
    execute(
        db,
        'INSERT INTO source_fetches (source_id, at, reason, ok, fetched, new_items, error) VALUES (?, ?, ?, ?, ?, ?, ?)',
        sourceFetch.sourceId,
        sourceFetch.at,
        sourceFetch.reason,
        sourceFetch.ok ? 1 : 0,
        sourceFetch.fetched,
        sourceFetch.newItems,
        sourceFetch.error
    )
}

/**
 * 오래된 출처 수집 기록 삭제
 *
 * @param {number} keepDays - 보관할 일수 (이보다 오래된 기록 삭제)
 */
export function pruneSourceFetches(db: Db, keepDays: number): void {
    execute(db, 'DELETE FROM source_fetches WHERE at < ?', new Date(Date.now() - keepDays * 24 * 3600 * 1000).toISOString())
}

// source_fetches 테이블의 한 행
interface SourceFetchRow {
    source_id: string
    at: string // 수집한 시각
    reason: 'briefing' | 'collect' // briefing: 브리핑 생성, collect: 미리 수집
    ok: number // 성공 1, 실패 0
    fetched: number // 받은 글 수
    new_items: number // 그중 처음 본 글 수
    error: string | null // 실패 이유 (없으면 null)
}

// 수집 기록 행을 화면용 모양으로 변환
const toSourceFetchDTO = (fetchRow: SourceFetchRow): SourceFetchDTO => ({
    fetchedAt: fetchRow.at,
    reason: fetchRow.reason,
    ok: fetchRow.ok === 1,
    fetchedCount: fetchRow.fetched,
    newItems: fetchRow.new_items,
    error: fetchRow.error
})

/**
 * 모든 단계가 0인 단계별 개수 생성
 */
const createEmptyFunnel = (): FunnelCounts => ({ collected: 0, merged: 0, triaged: 0, published: 0, saved: 0 })

// 출처별 단계 개수 집계 (수집 시각 기준)
// sinceIso가 null이면 전체 기간
function funnelBySource(db: Db, sinceIso: string | null): Map<string, FunnelCounts> {
    // 출처마다 수집한 글 수와 그중 합쳐진 · 선별한 · 브리핑에 실린 · 저장한 글 수 조회
    const funnelRows = selectRows<FunnelCounts & { source_id: string }>(
        db,
        `SELECT i.source_id,
            count(*) AS collected,
            sum(i.merged_into IS NOT NULL) AS merged,
            sum(i.triaged_at IS NOT NULL) AS triaged,
            sum(EXISTS (SELECT 1 FROM digest_entries de WHERE de.item_id = i.id)) AS published,
            sum(EXISTS (SELECT 1 FROM saves s WHERE s.item_id = i.id)) AS saved
     FROM items i
     WHERE ? IS NULL OR i.collected_at >= ?
     GROUP BY i.source_id`,
        sinceIso,
        sinceIso
    )

    // 출처 ID로 찾을 수 있게 정리
    return new Map(
        funnelRows.map((funnelRow) => [
            funnelRow.source_id,
            {
                collected: funnelRow.collected,
                merged: funnelRow.merged,
                triaged: funnelRow.triaged,
                published: funnelRow.published,
                saved: funnelRow.saved
            }
        ])
    )
}

// 출처 페이지 통계의 원본 (Map의 키는 출처 ID, 출처 이름 · 설명은 붙이기 전)
export interface SourceStatsRaw {
    period: Map<string, FunnelCounts> // 고른 기간의 단계별 개수
    total: Map<string, FunnelCounts> // 전체 기간의 단계별 개수
    lastFetch: Map<string, SourceFetchDTO> // 가장 최근 수집 기록
    failures: Map<string, number> // 고른 기간의 수집 실패 횟수
    recentFetches: Map<string, SourceFetchDTO[]> // 최근 수집 기록 (최신순, 최대 10건)
    recentPublished: Map<string, { itemId: number; titleKo: string; digestDate: string }[]> // 최근 브리핑에 실린 기사 (최대 5건)
    daily: { date: string; collected: number; published: number }[] // 날짜별 수집한 글 수 · 실린 글 수 (모든 출처 합계)
    cost: { period: number; total: number; byRole: { role: string; usd: number }[] } // LLM 비용 (달러, byRole은 고른 기간의 용도별)
}

/**
 * 출처 페이지용 통계 집계
 * - 출처 이름 · 설명은 여기서 붙이지 않음 (WorkerService가 설정에서 붙임)
 *
 * @param {string | null} sinceIso - 고른 기간의 시작 시각 (null이면 전체 기간)
 * @param {number} dailyDays - 날짜별 개수를 볼 일수 (오늘 포함)
 * @returns {SourceStatsRaw} 통계 원본
 */
export function getSourceStats(db: Db, sinceIso: string | null, dailyDays: number): SourceStatsRaw {
    // 출처마다 최근 수집 기록 10건 조회 (최신순)
    const recentFetchRows = selectRows<SourceFetchRow & { rn: number }>(
        db,
        `SELECT * FROM (
       SELECT f.*, row_number() OVER (PARTITION BY source_id ORDER BY at DESC) AS rn FROM source_fetches f
     ) WHERE rn <= 10 ORDER BY source_id, at DESC`
    )

    // 출처별로 묶기
    const recentFetchesBySource = new Map<string, SourceFetchDTO[]>()
    for (const recentFetchRow of recentFetchRows) {
        const fetchesOfSource = recentFetchesBySource.get(recentFetchRow.source_id) ?? []
        fetchesOfSource.push(toSourceFetchDTO(recentFetchRow))
        recentFetchesBySource.set(recentFetchRow.source_id, fetchesOfSource)
    }

    // 출처별 가장 최근 수집 기록 (묶음의 첫 번째)
    const lastFetchBySource = new Map([...recentFetchesBySource].map(([sourceId, fetchesOfSource]) => [sourceId, fetchesOfSource[0]!]))

    // 고른 기간의 출처별 수집 실패 횟수 조회
    const failureCountBySource = new Map(
        selectRows<{ source_id: string; n: number }>(
            db,
            'SELECT source_id, count(*) AS n FROM source_fetches WHERE ok = 0 AND (? IS NULL OR at >= ?) GROUP BY source_id',
            sinceIso,
            sinceIso
        ).map((failureCountRow) => [failureCountRow.source_id, failureCountRow.n])
    )

    // 출처마다 최근 브리핑에 실린 기사 5건 조회 (최근 날짜 · 순위 순, 한국어 제목이 없으면 원래 제목)
    const publishedRows = selectRows<{ source_id: string; id: number; title: string; date: string }>(
        db,
        `SELECT source_id, id, title, date FROM (
       SELECT i.source_id, i.id, coalesce(i.title_ko, i.title) AS title, d.date,
              row_number() OVER (PARTITION BY i.source_id ORDER BY d.date DESC, de.rank) AS rn
       FROM digest_entries de JOIN digests d ON d.id = de.digest_id JOIN items i ON i.id = de.item_id
     ) WHERE rn <= 5`
    )

    // 출처별로 묶기
    const recentPublishedBySource = new Map<string, { itemId: number; titleKo: string; digestDate: string }[]>()
    for (const publishedRow of publishedRows) {
        const publishedOfSource = recentPublishedBySource.get(publishedRow.source_id) ?? []
        publishedOfSource.push({ itemId: publishedRow.id, titleKo: publishedRow.title, digestDate: publishedRow.date })
        recentPublishedBySource.set(publishedRow.source_id, publishedOfSource)
    }

    // 날짜별 개수: 그날 수집한 글 수(로컬 날짜), 그날 브리핑에 실린 글 수
    // 시작 날짜는 오늘에서 (dailyDays - 1)일 전
    const dailyStartDate = new Date()
    dailyStartDate.setDate(dailyStartDate.getDate() - (dailyDays - 1))
    const dailyStartDateKey = localDateKey(dailyStartDate)

    // 시작 날짜 이후 날짜별 수집한 글 수 조회 (수집 시각을 로컬 날짜로 바꿔서 셈)
    const collectedByDay = new Map(
        selectRows<{ day: string; n: number }>(
            db,
            "SELECT date(collected_at, 'localtime') AS day, count(*) AS n FROM items WHERE date(collected_at, 'localtime') >= ? GROUP BY day",
            dailyStartDateKey
        ).map((collectedDayRow) => [collectedDayRow.day, collectedDayRow.n])
    )

    // 시작 날짜 이후 날짜별 브리핑에 실린 글 수 조회
    const publishedByDay = new Map(
        selectRows<{ day: string; n: number }>(
            db,
            'SELECT d.date AS day, count(*) AS n FROM digest_entries de JOIN digests d ON d.id = de.digest_id WHERE d.date >= ? GROUP BY d.date',
            dailyStartDateKey
        ).map((publishedDayRow) => [publishedDayRow.day, publishedDayRow.n])
    )

    // 시작 날짜부터 오늘까지 하루씩 채움 (기록이 없는 날은 0)
    const dailyCounts: SourceStatsRaw['daily'] = []
    for (let dayOffset = 0; dayOffset < dailyDays; dayOffset++) {
        const dayDate = new Date(dailyStartDate)
        dayDate.setDate(dailyStartDate.getDate() + dayOffset)
        const dayKey = localDateKey(dayDate)
        dailyCounts.push({ date: dayKey, collected: collectedByDay.get(dayKey) ?? 0, published: publishedByDay.get(dayKey) ?? 0 })
    }

    // 고른 기간의 용도별 LLM 비용 조회 (큰 순)
    const costByRole = selectRows<{ role: string; usd: number }>(
        db,
        'SELECT role, sum(cost_usd) AS usd FROM llm_usage WHERE ? IS NULL OR at >= ? GROUP BY role ORDER BY usd DESC',
        sinceIso,
        sinceIso
    )

    // 전체 기간의 LLM 비용 조회
    const totalCostUsd = selectRow<{ c: number | null }>(db, 'SELECT sum(cost_usd) AS c FROM llm_usage')?.c ?? 0

    // 단계별 개수는 고른 기간 · 전체 기간을 따로 집계, 고른 기간의 비용은 용도별 비용의 합
    return {
        period: funnelBySource(db, sinceIso),
        total: funnelBySource(db, null),
        lastFetch: lastFetchBySource,
        failures: failureCountBySource,
        recentFetches: recentFetchesBySource,
        recentPublished: recentPublishedBySource,
        daily: dailyCounts,
        cost: {
            period: costByRole.reduce((periodCostUsd, roleCost) => periodCostUsd + roleCost.usd, 0),
            total: totalCostUsd,
            byRole: costByRole
        }
    }
}

/**
 * 여러 단계별 개수를 단계마다 더함
 *
 * @returns {FunnelCounts} 더한 개수 (목록이 비었으면 모두 0)
 */
export function sumFunnels(funnels: FunnelCounts[]): FunnelCounts {
    return funnels.reduce(
        (funnelSum, funnel) => ({
            collected: funnelSum.collected + funnel.collected,
            merged: funnelSum.merged + funnel.merged,
            triaged: funnelSum.triaged + funnel.triaged,
            published: funnelSum.published + funnel.published,
            saved: funnelSum.saved + funnel.saved
        }),
        createEmptyFunnel()
    )
}

export { createEmptyFunnel }

// 로컬 시간 기준 날짜 글자 ('YYYY-MM-DD')
function localDateKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// =============================== 설정 ===================================

/**
 * 사용자 설정 조회
 *
 * @returns {AppSettings} 저장된 값 (저장하지 않은 항목은 기본값)
 */
export function getSettings(db: Db): AppSettings {
    // 저장된 설정 행 조회 (값은 JSON 글자)
    const settingRows = selectRows<{ key: string; value: string }>(db, 'SELECT key, value FROM settings')
    const storedSettings = Object.fromEntries(settingRows.map((settingRow) => [settingRow.key, JSON.parse(settingRow.value) as unknown]))

    // 기본값 위에 저장된 값을 덮어씀
    return { ...DEFAULT_SETTINGS, ...storedSettings } as AppSettings
}

/**
 * 사용자 설정 변경
 * - 넘긴 항목만 저장 (값이 undefined인 항목은 건너뜀)
 *
 * @param {Partial<AppSettings>} settingsPatch - 바꿀 항목
 * @returns {AppSettings} 바꾼 뒤의 전체 설정
 */
export function updateSettings(db: Db, settingsPatch: Partial<AppSettings>): AppSettings {
    runInTransaction(db, () => {
        for (const [settingKey, settingValue] of Object.entries(settingsPatch)) {
            // 값이 없는 항목은 건드리지 않음
            if (settingValue === undefined) continue
            // 항목 저장 (이미 있으면 값 교체)
            execute(
                db,
                'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
                settingKey,
                JSON.stringify(settingValue)
            )
        }
    })
    return getSettings(db)
}

// =============================== 브리핑 ===================================

// 브리핑에 실을 기사 하나
export interface PublishEntry {
    itemId: number // 기사 번호
    rank: number // 브리핑 안에서의 순위
    section: Section // 실을 섹션
    whyItMatters: string | null // 이 브리핑에 적는 "왜 중요한가" (null이면 조회할 때 기사 요약의 것을 씀)
}

/**
 * 브리핑 게시
 * - 같은 날짜의 브리핑이 이미 있으면 내용을 바꿔 끼움 (수동 새로고침)
 * - 없으면 새 호 생성
 *
 * @param digest - 날짜 · 오늘의 한 줄 · 개요 · 통계 · 실을 기사
 * @returns {number} 브리핑 번호
 */
export function publishDigest(
    db: Db,
    digest: { date: string; headline: string; overview: string | null; stats: DigestStats; entries: PublishEntry[] }
): number {
    return runInTransaction(db, () => {
        // 같은 날짜의 브리핑이 있는지 확인
        const existingDigestRow = selectRow<{ id: number }>(db, 'SELECT id FROM digests WHERE date = ?', digest.date)
        let digestId: number
        // 이미 있음 → 실린 기사를 모두 지우고 오늘의 한 줄 · 개요 · 통계 · 만든 시각을 새로 씀
        if (existingDigestRow) {
            digestId = existingDigestRow.id
            execute(db, 'DELETE FROM digest_entries WHERE digest_id = ?', digestId)
            execute(
                db,
                'UPDATE digests SET headline = ?, overview = ?, stats = ?, created_at = ? WHERE id = ?',
                digest.headline,
                digest.overview,
                JSON.stringify(digest.stats),
                nowIso(),
                digestId
            )
        } else {
            // 없음 → 새 호 생성
            const digestInsertResult = db
                .prepare('INSERT INTO digests (date, headline, overview, stats, created_at) VALUES (?, ?, ?, ?, ?)')
                .run(digest.date, digest.headline, digest.overview, JSON.stringify(digest.stats), nowIso())
            digestId = Number(digestInsertResult.lastInsertRowid)
        }

        // 실을 기사를 순위 · 섹션과 함께 저장
        const insertEntryStatement = db.prepare(
            'INSERT INTO digest_entries (digest_id, item_id, rank, section, why_it_matters) VALUES (?, ?, ?, ?, ?)'
        )
        for (const entry of digest.entries) insertEntryStatement.run(digestId, entry.itemId, entry.rank, entry.section, entry.whyItMatters)
        return digestId
    })
}

/**
 * 가장 최근 브리핑의 날짜 조회
 *
 * @returns {string | null} 날짜 ('YYYY-MM-DD', 브리핑이 하나도 없으면 null)
 */
export function lastDigestDate(db: Db): string | null {
    return selectRow<{ date: string }>(db, 'SELECT date FROM digests ORDER BY date DESC LIMIT 1')?.date ?? null
}

// digests 테이블의 한 행
interface DigestRow {
    id: number
    date: string
    headline: string
    overview: string | null
    stats: string // 통계 (DigestStats의 JSON)
    created_at: string
}

// 기사 한 건을 화면용으로 읽을 때 쓰는 공통 열
// 기사 열 전체 · 읽은 시각 · 저장한 시각 · 메모 · 태그 목록 · 가장 최근에 실린 브리핑 날짜
// 후속 소식이면 지난 기사의 제목과 실린 날짜도 함께
const ITEM_VIEW_COLUMNS = `
  i.*, r.read_at, s.saved_at, n.body AS memo,
  (SELECT group_concat(t.name, char(31)) FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = i.id) AS tag_list,
  (SELECT max(d.date) FROM digest_entries de2 JOIN digests d ON d.id = de2.digest_id WHERE de2.item_id = i.id) AS digest_date,
  (SELECT coalesce(p.title_ko, p.title) FROM items p WHERE p.id = i.follow_up_of) AS follow_up_title,
  (SELECT max(d.date) FROM digest_entries de3 JOIN digests d ON d.id = de3.digest_id WHERE de3.item_id = i.follow_up_of) AS follow_up_date`

// 공통 열에 필요한 연결 (읽음 · 저장 · 메모, 없어도 기사는 조회됨)
const ITEM_VIEW_JOINS = `
  LEFT JOIN reads r ON r.item_id = i.id
  LEFT JOIN saves s ON s.item_id = i.id
  LEFT JOIN notes n ON n.item_id = i.id`

// 공통 열로 읽은 기사 한 행
interface ItemViewRow extends ItemRow {
    read_at: string | null // 읽은 시각 (읽지 않았으면 null)
    saved_at: string | null // 저장한 시각 (저장하지 않았으면 null)
    memo: string | null // 메모 (없으면 null)
    tag_list: string | null // 태그 이름을 char(31)로 이어 붙인 글자 (태그가 없으면 null)
    digest_date: string | null // 가장 최근에 실린 브리핑 날짜 (실린 적 없으면 null)
    follow_up_title: string | null // 후속 소식이면 지난 기사의 제목 (한국어 제목이 없으면 원래 제목)
    follow_up_date: string | null // 지난 기사가 가장 최근에 실린 브리핑 날짜
}

// 브리핑에 실린 기사 한 행
interface EntryRow extends ItemViewRow {
    rank: number // 브리핑 안에서의 순위
    section: Section // 실린 섹션
    why_it_matters: string | null // 이 브리핑에 적은 "왜 중요한가"
}

const TAG_SEPARATOR = String.fromCharCode(31) // SQL의 char(31)과 같은 구분자

// 이어 붙인 태그 목록을 이름순 배열로 변환 (없으면 빈 배열)
const splitTags = (tagList: string | null) =>
    tagList ? tagList.split(TAG_SEPARATOR).sort((leftTag, rightTag) => leftTag.localeCompare(rightTag)) : []

// 기사 행을 화면용 공통 모양으로 변환 (브리핑 기사 · 검색 결과 · 기사 상세가 함께 씀)
// 아직 선별 · 요약하지 않은 기사는 분류 'other', 원래 제목, 소개 글 앞 300자로 채움
function toEntryBase(itemViewRow: ItemViewRow): Omit<DigestEntryDTO, 'rank' | 'section' | 'whyItMatters'> {
    return {
        itemId: itemViewRow.id,
        category: itemViewRow.triage_category ?? 'other',
        titleKo: itemViewRow.title_ko ?? itemViewRow.title,
        originalTitle: itemViewRow.title,
        summaryKo: itemViewRow.summary_ko ?? itemViewRow.snippet.slice(0, 300),
        keyPoints: itemViewRow.key_points ? (JSON.parse(itemViewRow.key_points) as string[]) : [],
        url: itemViewRow.url,
        sourceName: itemViewRow.source_name,
        engagementLabel: itemViewRow.engagement_label,
        otherSources: JSON.parse(itemViewRow.other_sources) as SourceRef[],
        publishedAt: itemViewRow.published_at,
        isRead: itemViewRow.read_at !== null,
        isSaved: itemViewRow.saved_at !== null,
        memo: itemViewRow.memo ?? '',
        tags: splitTags(itemViewRow.tag_list),
        // 후속 소식 표시는 지난 기사의 제목을 찾았을 때만
        followUpOf:
            itemViewRow.follow_up_of !== null && itemViewRow.follow_up_title !== null
                ? { itemId: itemViewRow.follow_up_of, titleKo: itemViewRow.follow_up_title, digestDate: itemViewRow.follow_up_date }
                : null
    }
}

// 브리핑 행에 실린 기사를 붙여 화면용 브리핑으로 변환 (행이 없으면 null)
function digestFromRow(db: Db, digestRow: DigestRow | undefined): DigestDTO | null {
    if (!digestRow) return null
    // 그 호에 실린 기사를 순위 순으로 조회 (저장 · 메모 · 읽음 · 태그 포함)
    const entryRows = selectRows<EntryRow>(
        db,
        `SELECT ${ITEM_VIEW_COLUMNS}, de.rank, de.section, de.why_it_matters
     FROM digest_entries de
     JOIN items i ON i.id = de.item_id
     ${ITEM_VIEW_JOINS}
     WHERE de.digest_id = ?
     ORDER BY de.rank`,
        digestRow.id
    )
    return {
        id: digestRow.id,
        date: digestRow.date,
        headline: digestRow.headline,
        overview: digestRow.overview,
        createdAt: digestRow.created_at,
        stats: JSON.parse(digestRow.stats) as DigestStats,
        entries: entryRows.map((entryRow) => ({
            ...toEntryBase(entryRow),
            rank: entryRow.rank,
            section: entryRow.section,
            // 브리핑에 따로 적은 "왜 중요한가"가 없으면 기사 요약 때 만든 것
            whyItMatters: entryRow.why_it_matters ?? entryRow.why_ko
        }))
    }
}

/**
 * 가장 최근 브리핑 조회
 *
 * @returns {DigestDTO | null} 브리핑 (하나도 없으면 null)
 */
export function getLatestDigest(db: Db): DigestDTO | null {
    return digestFromRow(db, selectRow<DigestRow>(db, 'SELECT * FROM digests ORDER BY date DESC LIMIT 1'))
}

/**
 * 날짜로 브리핑 조회
 *
 * @param {string} date - 브리핑 날짜 ('YYYY-MM-DD')
 * @returns {DigestDTO | null} 그날의 브리핑 (없으면 null)
 */
export function getDigestByDate(db: Db, date: string): DigestDTO | null {
    return digestFromRow(db, selectRow<DigestRow>(db, 'SELECT * FROM digests WHERE date = ?', date))
}

/**
 * 브리핑 목록 조회 (최신순)
 *
 * @returns {DigestSummaryDTO[]} 호마다 날짜 · 오늘의 한 줄 · 실린 기사 수 · 그중 저장한 기사 수
 */
export function listDigests(db: Db): DigestSummaryDTO[] {
    return selectRows<DigestSummaryDTO>(
        db,
        `SELECT d.id, d.date, d.headline,
            (SELECT count(*) FROM digest_entries de WHERE de.digest_id = d.id) AS entryCount,
            (SELECT count(*) FROM digest_entries de JOIN saves s ON s.item_id = de.item_id WHERE de.digest_id = d.id) AS savedCount
     FROM digests d
     ORDER BY d.date DESC`
    )
}

/**
 * 기사 상세 조회 (본문 문단 · 문단별 번역 · 번역 상태 · 하이라이트 포함)
 *
 * @returns {ItemDetailDTO | null} 기사 상세 (없는 기사면 null)
 */
export function getItemDetail(db: Db, itemId: number): ItemDetailDTO | null {
    // 기사 한 건을 공통 열로 조회
    const detailRow = selectRow<ItemViewRow>(db, `SELECT ${ITEM_VIEW_COLUMNS} FROM items i ${ITEM_VIEW_JOINS} WHERE i.id = ?`, itemId)
    if (!detailRow) return null

    // 보관된 본문 조회 (없을 수 있음)
    const storedContent = getContent(db, itemId)
    return {
        ...toEntryBase(detailRow),
        whyItMatters: detailRow.why_ko,
        savedAt: detailRow.saved_at,
        digestDate: detailRow.digest_date,
        // 보관된 본문이 없으면 수집할 때 받은 소개 글을 문단 하나로
        paragraphs: storedContent?.paragraphs ?? (detailRow.snippet ? [detailRow.snippet] : []),
        hasFullText: storedContent?.fullText ?? false,
        paragraphsKo: storedContent?.paragraphsKo ?? null,
        // 번역 상태: 번역이 필요 없는 기사(한국어) / 번역 있음 / 아직 없음
        translation: !needsTranslation(detailRow) ? 'not_needed' : storedContent?.paragraphsKo ? 'done' : 'missing',
        highlights: listHighlights(db, itemId)
    }
}

const HANGUL_PATTERN = /[가-힣]/g // 한글 글자

/**
 * 번역이 필요한 기사인지 판단
 * - 한국어 기사는 번역하지 않음
 * - 소스 언어가 ko이거나 제목 · 소개 글 첫 부분의 한글이 30% 이상이면 한국어로 봄
 *
 * @returns {boolean} 번역이 필요하면 true
 */
export function needsTranslation(itemRow: Pick<ItemRow, 'lang' | 'title' | 'snippet'>): boolean {
    // 소스 언어가 한국어면 번역하지 않음
    if (itemRow.lang === 'ko') return false

    // 제목과 소개 글 앞 300자에서 공백을 뺀 글자 중 한글이 몇 자인지 셈
    const sampleText = `${itemRow.title} ${itemRow.snippet.slice(0, 300)}`.replace(/\s/g, '')
    const hangulCount = sampleText.match(HANGUL_PATTERN)?.length ?? 0
    // 글자가 없거나 한글이 30% 미만이면 번역 필요
    return sampleText.length === 0 || hangulCount / sampleText.length < 0.3
}

// =============================== 전문 검색 ===================================

/**
 * 기사 한 건의 검색 색인을 현재 내용으로 다시 씀
 * - 제목 · 요약 · 본문 · 메모가 바뀔 때마다 호출
 * - 색인 행 번호(rowid)는 기사 번호와 같음
 */
export function reindexItem(db: Db, itemId: number): void {
    // 이전 색인 행 삭제
    execute(db, 'DELETE FROM search_fts WHERE rowid = ?', itemId)

    // 현재 내용으로 색인 행 생성
    // title 열: 원래 제목 · 한국어 제목
    // body 열: 요약 · 핵심 포인트 · 소개 글 · 본문 문단 · 번역 문단
    // memo 열: 메모 · 하이라이트 글자와 하이라이트 메모
    execute(
        db,
        `INSERT INTO search_fts (rowid, title, body, memo)
     SELECT i.id,
            i.title || ' ' || coalesce(i.title_ko, ''),
            coalesce(i.summary_ko, '') || ' ' || coalesce(i.key_points, '') || ' ' || coalesce(i.snippet, '') || ' ' ||
              coalesce((SELECT group_concat(value, ' ') FROM json_each(c.paragraphs)), '') || ' ' ||
              coalesce((SELECT group_concat(value, ' ') FROM json_each(c.paragraphs_ko) WHERE value IS NOT NULL), ''),
            coalesce(n.body, '') || ' ' ||
              coalesce((SELECT group_concat(h.text || ' ' || h.note, ' ') FROM highlights h WHERE h.item_id = i.id), '')
     FROM items i
     LEFT JOIN contents c ON c.item_id = i.id
     LEFT JOIN notes n ON n.item_id = i.id
     WHERE i.id = ?`,
        itemId
    )
}

const TRIGRAM_MIN_LENGTH = 3 // trigram 색인으로 찾을 수 있는 가장 짧은 낱말 길이 (글자 수)

// LIKE 패턴에서 특별한 뜻이 있는 글자(% · _)와 이스케이프 글자(!) 앞에 !를 붙임
function escapeLike(word: string): string {
    return word.replace(/[!%_]/g, (specialChar) => `!${specialChar}`)
}

/**
 * 검색어를 SQL 조건으로 변환
 * - 3글자 이상 낱말은 FTS(trigram) MATCH로 찾음
 * - 2글자 이하 낱말(예: "모델")은 trigram으로 찾을 수 없어 LIKE로 찾음
 * - 모든 낱말을 AND로 묶음
 *
 * @param {string} query - 검색어 (공백으로 낱말 구분)
 * @returns {{ sql: string; params: string[] }} 기사(i)에 거는 조건과 그 파라미터 (낱말이 없으면 빈 조건)
 */
export function buildSearchFilter(query: string): { sql: string; params: string[] } {
    // 공백으로 낱말 나누기 (낱말이 없으면 조건 없음)
    const searchWords = query.trim().split(/\s+/).filter(Boolean)
    if (searchWords.length === 0) return { sql: '', params: [] }

    // 낱말을 길이로 나누기 (3글자 이상은 FTS, 그보다 짧으면 LIKE)
    const longWords = searchWords.filter((searchWord) => [...searchWord].length >= TRIGRAM_MIN_LENGTH)
    const shortWords = searchWords.filter((searchWord) => [...searchWord].length < TRIGRAM_MIN_LENGTH)

    const conditions: string[] = [] // AND로 묶을 조건
    const conditionParams: string[] = [] // 조건의 ? 자리에 들어갈 값 (조건 순서대로)

    // 긴 낱말은 MATCH 조건 하나로 묶음 (낱말마다 큰따옴표로 감싸 글자 그대로 찾음)
    if (longWords.length) {
        conditions.push('i.id IN (SELECT rowid FROM search_fts WHERE search_fts MATCH ?)')
        conditionParams.push(longWords.map((longWord) => `"${longWord.replaceAll('"', '""')}"`).join(' AND '))
    }

    // 짧은 낱말은 낱말마다 LIKE 조건 (제목 · 본문 · 메모 중 어디든 포함)
    for (const shortWord of shortWords) {
        const likePattern = `%${escapeLike(shortWord)}%`
        conditions.push(
            "i.id IN (SELECT rowid FROM search_fts WHERE title LIKE ? ESCAPE '!' OR body LIKE ? ESCAPE '!' OR memo LIKE ? ESCAPE '!')"
        )
        conditionParams.push(likePattern, likePattern, likePattern)
    }
    return { sql: conditions.join(' AND '), params: conditionParams }
}

const SEARCH_LIMIT = 200 // 검색 결과 최대 건수

/**
 * 기사 검색
 * - 범위 saved: 저장한 기사 (라이브러리), 저장한 순
 * - 범위 published: 브리핑에 실린 기사 (아카이브), 최신 브리핑 순
 * - 메모가 있는 기사만 · 태그 · 검색어 조건을 모두 만족하는 기사만, 최대 200건
 *
 * @param {SearchParams} searchParams - 검색 범위와 조건
 * @returns {LibraryItemDTO[]} 검색 결과
 */
export function searchItems(db: Db, searchParams: SearchParams): LibraryItemDTO[] {
    const whereConditions: string[] = [] // WHERE에 AND로 묶을 조건
    const queryParams: SQLInputValue[] = [] // 조건의 ? 자리에 들어갈 값

    // 범위 조건: 저장한 기사만 / 브리핑에 실린 적 있는 기사만
    if (searchParams.scope === 'saved') whereConditions.push('s.saved_at IS NOT NULL')
    else whereConditions.push('EXISTS (SELECT 1 FROM digest_entries de WHERE de.item_id = i.id)')

    // 메모가 있는 기사만
    if (searchParams.memoOnly) whereConditions.push('n.body IS NOT NULL')
    // 이 태그가 붙은 기사만
    if (searchParams.tag) {
        whereConditions.push('EXISTS (SELECT 1 FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = i.id AND t.name = ?)')
        queryParams.push(searchParams.tag)
    }
    // 검색어의 낱말을 모두 포함한 기사만 (낱말이 없으면 조건을 붙이지 않음)
    if (searchParams.query) {
        const searchFilter = buildSearchFilter(searchParams.query)
        if (searchFilter.sql) {
            whereConditions.push(searchFilter.sql)
            queryParams.push(...searchFilter.params)
        }
    }

    // 정렬: 저장한 기사는 최근에 저장한 순, 실린 기사는 최근 브리핑 순 (같은 날은 기사 번호가 큰 순)
    const orderBy = searchParams.scope === 'saved' ? 's.saved_at DESC' : 'digest_date DESC, i.id DESC'
    const foundRows = selectRows<ItemViewRow>(
        db,
        `SELECT ${ITEM_VIEW_COLUMNS} FROM items i ${ITEM_VIEW_JOINS}
     WHERE ${whereConditions.join(' AND ')}
     ORDER BY ${orderBy}
     LIMIT ${SEARCH_LIMIT}`,
        ...queryParams
    )

    // 목록에 필요한 항목만 골라 화면용 모양으로 변환
    return foundRows.map((foundRow) => {
        const entryBase = toEntryBase(foundRow)
        return {
            itemId: entryBase.itemId,
            titleKo: entryBase.titleKo,
            originalTitle: entryBase.originalTitle,
            summaryKo: entryBase.summaryKo,
            category: entryBase.category,
            sourceName: entryBase.sourceName,
            url: entryBase.url,
            isSaved: entryBase.isSaved,
            savedAt: foundRow.saved_at,
            digestDate: foundRow.digest_date,
            memo: entryBase.memo,
            tags: entryBase.tags
        }
    })
}

// =============================== 태그 ===================================

/**
 * 태그 이름 정리
 * - 앞뒤 공백 · 앞의 # 제거, 공백은 하이픈, 영문은 소문자, 최대 30자
 *
 * @returns {string} 정리한 이름 (남는 글자가 없으면 빈 글자)
 */
export function normalizeTag(tagName: string): string {
    return tagName.trim().replace(/^#+/, '').replace(/\s+/g, '-').toLowerCase().slice(0, 30)
}

/**
 * 기사에 붙은 태그 조회
 *
 * @returns {string[]} 태그 이름 (이름순)
 */
export function getTags(db: Db, itemId: number): string[] {
    return selectRows<{ name: string }>(
        db,
        'SELECT t.name FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = ? ORDER BY t.name',
        itemId
    ).map((tagRow) => tagRow.name)
}

/**
 * 기사에 태그 붙이기
 * - 하이픈만 다른 기존 태그가 있으면 그 표기를 씀 (openweight → open-weight)
 * - 이미 붙어 있는 태그면 그대로 둠
 *
 * @param {string} tagName - 태그 이름 (정리 전)
 * @param {'auto' | 'user'} tagSource - auto: AI 추천, user: 직접 입력
 * @returns {string[]} 붙인 뒤 그 기사의 태그 목록
 */
export function addTag(db: Db, itemId: number, tagName: string, tagSource: 'auto' | 'user'): string[] {
    // 이름 정리 (정리하고 남는 글자가 없으면 아무것도 하지 않음)
    let normalizedTag = normalizeTag(tagName)
    if (!normalizedTag) return getTags(db, itemId)

    // 하이픈만 다른 기존 태그가 있으면 그 표기를 씀 (openweight → open-weight)
    const tagWithoutHyphens = normalizedTag.replaceAll('-', '')
    const existingTagRow = selectRow<{ name: string }>(
        db,
        "SELECT name FROM tags WHERE replace(name, '-', '') = ? LIMIT 1",
        tagWithoutHyphens
    )
    if (existingTagRow) normalizedTag = existingTagRow.name

    // 태그가 없으면 만들고 기사에 연결 (이미 있거나 이미 연결돼 있으면 그대로)
    runInTransaction(db, () => {
        execute(db, 'INSERT OR IGNORE INTO tags (name) VALUES (?)', normalizedTag)
        const { id: tagId } = selectRow<{ id: number }>(db, 'SELECT id FROM tags WHERE name = ?', normalizedTag)!
        execute(db, 'INSERT OR IGNORE INTO item_tags (item_id, tag_id, source) VALUES (?, ?, ?)', itemId, tagId, tagSource)
    })
    return getTags(db, itemId)
}

/**
 * 기사에서 태그 떼기
 * - 더 이상 쓰는 기사가 없는 태그는 삭제
 *
 * @returns {string[]} 뗀 뒤 그 기사의 태그 목록
 */
export function removeTag(db: Db, itemId: number, tagName: string): string[] {
    runInTransaction(db, () => {
        // 기사와 태그의 연결 삭제
        execute(
            db,
            'DELETE FROM item_tags WHERE item_id = ? AND tag_id = (SELECT id FROM tags WHERE name = ?)',
            itemId,
            normalizeTag(tagName)
        )

        // 어떤 기사에도 붙어 있지 않은 태그 삭제
        execute(db, 'DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM item_tags)')
    })
    return getTags(db, itemId)
}

/**
 * 태그 목록 조회 (저장한 기사에 붙은 태그만)
 *
 * @returns {TagCount[]} 태그 이름과 그 태그가 붙은 저장 기사 수 (많이 쓴 순, 같으면 이름순)
 */
export function listTags(db: Db): TagCount[] {
    return selectRows<TagCount>(
        db,
        `SELECT t.name, count(*) AS count
     FROM item_tags it JOIN tags t ON t.id = it.tag_id JOIN saves s ON s.item_id = it.item_id
     GROUP BY t.id ORDER BY count DESC, t.name`
    )
}

// =============================== 저장 후 처리 ===================================

/**
 * 저장 후 처리(본문 추출 · 태그 추천)가 필요한지 확인
 *
 * @returns {boolean} 저장한 기사이고 아직 처리를 마치지 않았으면 true
 */
export function needsEnrichment(db: Db, itemId: number): boolean {
    return selectRow<{ x: number }>(db, 'SELECT 1 AS x FROM saves WHERE item_id = ? AND enriched_at IS NULL', itemId) !== undefined
}

/**
 * 저장 후 처리를 마쳤다고 표시 (마친 시각 기록)
 */
export function markEnriched(db: Db, itemId: number): void {
    execute(db, 'UPDATE saves SET enriched_at = ? WHERE item_id = ?', nowIso(), itemId)
}

/**
 * 기사 한 행 조회
 *
 * @returns {ItemRow | undefined} 기사 행 (없는 기사면 undefined)
 */
export function getItemRow(db: Db, itemId: number): ItemRow | undefined {
    return selectRow<ItemRow>(db, 'SELECT * FROM items WHERE id = ?', itemId)
}

// =============================== 사용자 동작 ===================================

/**
 * 읽음 표시 (이미 읽은 기사면 처음 읽은 시각을 그대로 둠)
 */
export function markRead(db: Db, itemId: number): void {
    execute(db, 'INSERT OR IGNORE INTO reads (item_id, read_at) VALUES (?, ?)', itemId, nowIso())
}

/**
 * 저장 · 저장 취소
 * - 이미 저장한 기사를 다시 저장하면 처음 저장한 시각을 그대로 둠
 *
 * @param {boolean} isSaved - true면 저장, false면 저장 취소
 */
export function setSaved(db: Db, itemId: number, isSaved: boolean): void {
    if (isSaved) execute(db, 'INSERT OR IGNORE INTO saves (item_id, saved_at) VALUES (?, ?)', itemId, nowIso())
    else execute(db, 'DELETE FROM saves WHERE item_id = ?', itemId)
}

/**
 * 메모 저장 (DESIGN.md 6.3절)
 * - 메모를 쓴 기사는 자동으로 저장 처리
 * - 빈 메모(공백뿐)는 메모를 지움
 * - 저장 뒤 검색 색인 갱신
 *
 * @param {string} memoBody - 메모 내용
 * @returns {string} 메모를 저장한 시각
 */
export function saveMemo(db: Db, itemId: number, memoBody: string): string {
    const memoSavedAt = nowIso()
    runInTransaction(db, () => {
        // 빈 메모 → 메모 삭제
        if (memoBody.trim() === '') {
            execute(db, 'DELETE FROM notes WHERE item_id = ?', itemId)
        } else {
            // 내용 있음 → 메모 저장 (이미 있으면 내용 · 시각 교체), 아직 저장하지 않은 기사면 저장 처리
            execute(
                db,
                'INSERT INTO notes (item_id, body, updated_at) VALUES (?, ?, ?) ON CONFLICT(item_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at',
                itemId,
                memoBody,
                memoSavedAt
            )
            execute(db, 'INSERT OR IGNORE INTO saves (item_id, saved_at) VALUES (?, ?)', itemId, memoSavedAt)
        }

        // 바뀐 메모로 검색 색인 갱신
        reindexItem(db, itemId)
    })
    return memoSavedAt
}

// =============================== 하이라이트 ===================================

// highlights 테이블의 한 행
interface HighlightRow {
    id: number
    item_id: number
    paragraph: number // ¶ 번호 (1부터)
    variant: 'ko' | 'original' // ko: 번역문에 그음, original: 원문에 그음
    start_offset: number // 문단 글자 안의 시작 위치 (포함)
    end_offset: number // 끝 위치 (포함하지 않음)
    text: string // 그은 글자
    note: string // 하이라이트 메모 (없으면 빈 글자)
    created_at: string // 그은 시각
}

// 하이라이트 행을 화면용 모양으로 변환
const toHighlightDTO = (highlightRow: HighlightRow): HighlightDTO => ({
    id: highlightRow.id,
    paragraph: highlightRow.paragraph,
    variant: highlightRow.variant,
    start: highlightRow.start_offset,
    end: highlightRow.end_offset,
    text: highlightRow.text,
    note: highlightRow.note,
    createdAt: highlightRow.created_at
})

/**
 * 기사의 하이라이트 조회
 *
 * @returns {HighlightDTO[]} 하이라이트 (문단 · 시작 위치 순)
 */
export function listHighlights(db: Db, itemId: number): HighlightDTO[] {
    return selectRows<HighlightRow>(db, 'SELECT * FROM highlights WHERE item_id = ? ORDER BY paragraph, start_offset', itemId).map(
        toHighlightDTO
    )
}

/**
 * 하이라이트 긋기
 * - 그은 글자는 보관된 본문(번역문 또는 원문)에서 잘라 저장
 * - 같은 문단 · 같은 판에서 겹치거나 맞닿는 하이라이트는 하나로 합침 (메모도 합침)
 * - 하이라이트를 그은 기사는 메모처럼 자동으로 저장
 *
 * @param {HighlightRange[]} ranges - 그을 범위들
 * @returns {{ highlights: HighlightDTO[]; newlySaved: boolean }} 그 기사의 하이라이트 목록과, 이번에 기사가 새로 저장됐는지
 */
export function addHighlights(db: Db, itemId: number, ranges: HighlightRange[]): { highlights: HighlightDTO[]; newlySaved: boolean } {
    // 그은 글자를 잘라 올 보관된 본문
    const highlightedContent = getContent(db, itemId)
    let newlySaved = false // 이번에 기사가 새로 저장됐는지
    runInTransaction(db, () => {
        for (const range of ranges) {
            // 그은 판의 그 문단 글자 (번역문 또는 원문, ¶ 번호는 1부터)
            const paragraphText =
                range.variant === 'ko'
                    ? highlightedContent?.paragraphsKo?.[range.paragraph - 1]
                    : highlightedContent?.paragraphs[range.paragraph - 1]
            // 보관된 본문이 없거나 없는 문단이면 건너뜀
            if (!paragraphText) continue

            // 범위 정리: 시작 · 끝이 뒤바뀌어 와도 작은 쪽을 시작으로, 문단 길이 안으로 자름
            let startOffset = Math.max(0, Math.min(range.start, range.end))
            let endOffset = Math.min(paragraphText.length, Math.max(range.start, range.end))
            // 글자가 없는(공백뿐인) 범위는 건너뜀
            if (paragraphText.slice(startOffset, endOffset).trim() === '') continue

            // 같은 문단 · 같은 판에서 이 범위와 겹치거나 맞닿는 기존 하이라이트 조회
            const overlappingRows = selectRows<HighlightRow>(
                db,
                'SELECT * FROM highlights WHERE item_id = ? AND paragraph = ? AND variant = ? AND start_offset <= ? AND end_offset >= ?',
                itemId,
                range.paragraph,
                range.variant,
                endOffset,
                startOffset
            )

            // 기존 하이라이트 흡수: 범위를 넓히고, 가장 먼저 그은 시각과 메모를 물려받고, 기존 것은 삭제
            let earliestCreatedAt = nowIso()
            const mergedNotes: string[] = [] // 겹친 하이라이트들의 메모
            for (const overlappingRow of overlappingRows) {
                startOffset = Math.min(startOffset, overlappingRow.start_offset)
                endOffset = Math.max(endOffset, overlappingRow.end_offset)
                if (overlappingRow.created_at < earliestCreatedAt) earliestCreatedAt = overlappingRow.created_at
                if (overlappingRow.note.trim()) mergedNotes.push(overlappingRow.note.trim())
                execute(db, 'DELETE FROM highlights WHERE id = ?', overlappingRow.id)
            }

            // 합친 범위로 하이라이트 저장 (글자는 앞뒤 공백을 뺀 것, 메모는 줄바꿈으로 이음)
            execute(
                db,
                'INSERT INTO highlights (item_id, paragraph, variant, start_offset, end_offset, text, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                itemId,
                range.paragraph,
                range.variant,
                startOffset,
                endOffset,
                paragraphText.slice(startOffset, endOffset).trim(),
                mergedNotes.join('\n'),
                earliestCreatedAt
            )
        }

        // 기사 자동 저장 (이미 저장한 기사면 그대로, 이번에 새로 저장됐는지 기록)
        const saveInsertResult = db.prepare('INSERT OR IGNORE INTO saves (item_id, saved_at) VALUES (?, ?)').run(itemId, nowIso())
        newlySaved = Number(saveInsertResult.changes) > 0
        // 하이라이트 글자와 메모로 검색 색인 갱신
        reindexItem(db, itemId)
    })
    return { highlights: listHighlights(db, itemId), newlySaved }
}

/**
 * 하이라이트 메모 수정
 *
 * @returns {HighlightDTO[]} 그 기사의 하이라이트 목록 (없는 하이라이트면 빈 배열)
 */
export function updateHighlightNote(db: Db, highlightId: number, note: string): HighlightDTO[] {
    // 어느 기사의 하이라이트인지 확인 (없는 하이라이트면 아무것도 하지 않음)
    const notedRow = selectRow<HighlightRow>(db, 'SELECT * FROM highlights WHERE id = ?', highlightId)
    if (!notedRow) return []

    // 메모 수정 후 검색 색인 갱신
    execute(db, 'UPDATE highlights SET note = ? WHERE id = ?', note, highlightId)
    reindexItem(db, notedRow.item_id)
    return listHighlights(db, notedRow.item_id)
}

/**
 * 하이라이트 삭제
 *
 * @returns {HighlightDTO[]} 그 기사의 남은 하이라이트 목록 (없는 하이라이트면 빈 배열)
 */
export function removeHighlight(db: Db, highlightId: number): HighlightDTO[] {
    // 어느 기사의 하이라이트인지 확인 (없는 하이라이트면 아무것도 하지 않음)
    const removedRow = selectRow<HighlightRow>(db, 'SELECT * FROM highlights WHERE id = ?', highlightId)
    if (!removedRow) return []

    // 삭제 후 검색 색인 갱신
    execute(db, 'DELETE FROM highlights WHERE id = ?', highlightId)
    reindexItem(db, removedRow.item_id)
    return listHighlights(db, removedRow.item_id)
}

// =============================== AI 질문 대화 ===================================

/**
 * 질문 범위를 대화를 찾는 키로 변환
 *
 * @returns {string} 'item:<기사 번호>' 또는 'digest:<날짜>'
 */
export function chatScopeKey(scope: ChatScope): string {
    return scope.kind === 'item' ? `item:${scope.itemId}` : `digest:${scope.date}`
}

// chat_messages 테이블에서 읽는 열
interface ChatMessageRow {
    id: number
    role: 'user' | 'assistant' // user: 질문, assistant: 답변
    content: string
    citations: string // 인용 번호 목록 (number[]의 JSON)
    created_at: string
}

/**
 * 그 범위의 대화 메시지 조회
 *
 * @returns {ChatMessageDTO[]} 메시지 (저장한 순서대로, 대화가 없으면 빈 배열)
 */
export function listChatMessages(db: Db, scope: ChatScope): ChatMessageDTO[] {
    return selectRows<ChatMessageRow>(
        db,
        `SELECT m.id, m.role, m.content, m.citations, m.created_at
     FROM chat_messages m JOIN chats c ON c.id = m.chat_id
     WHERE c.scope_key = ? ORDER BY m.id`,
        chatScopeKey(scope)
    ).map((messageRow) => ({
        id: messageRow.id,
        role: messageRow.role,
        content: messageRow.content,
        citations: JSON.parse(messageRow.citations) as number[],
        createdAt: messageRow.created_at
    }))
}

/**
 * 대화에 메시지 추가
 * - 그 범위의 대화가 없으면 만들고, 있으면 마지막 변경 시각만 갱신
 *
 * @param {ChatScope} scope - 질문 범위 (기사 하나 또는 그날 브리핑)
 * @param chatMessage - 질문 또는 답변 (citations는 인용 번호 목록, model은 모델 이름)
 * @returns {ChatMessageDTO} 저장한 메시지
 */
export function addChatMessage(
    db: Db,
    scope: ChatScope,
    chatMessage: { role: 'user' | 'assistant'; content: string; citations?: number[]; model?: string }
): ChatMessageDTO {
    const messageCreatedAt = nowIso()
    const scopeKey = chatScopeKey(scope)
    return runInTransaction(db, () => {
        // 그 범위의 대화 준비 (없으면 생성, 있으면 마지막 변경 시각 갱신)
        execute(
            db,
            'INSERT INTO chats (scope_key, created_at, updated_at) VALUES (?, ?, ?) ON CONFLICT(scope_key) DO UPDATE SET updated_at = excluded.updated_at',
            scopeKey,
            messageCreatedAt,
            messageCreatedAt
        )
        // 대화 번호 확인
        const { id: chatId } = selectRow<{ id: number }>(db, 'SELECT id FROM chats WHERE scope_key = ?', scopeKey)!

        // 메시지 저장 (인용이 없으면 빈 목록, 모델이 없으면 null)
        const messageInsertResult = db
            .prepare('INSERT INTO chat_messages (chat_id, role, content, citations, model, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(
                chatId,
                chatMessage.role,
                chatMessage.content,
                JSON.stringify(chatMessage.citations ?? []),
                chatMessage.model ?? null,
                messageCreatedAt
            )
        return {
            id: Number(messageInsertResult.lastInsertRowid),
            role: chatMessage.role,
            content: chatMessage.content,
            citations: chatMessage.citations ?? [],
            createdAt: messageCreatedAt
        }
    })
}

/**
 * 그 범위의 대화 삭제 (메시지는 외래 키 설정으로 함께 삭제)
 */
export function clearChat(db: Db, scope: ChatScope): void {
    execute(db, 'DELETE FROM chats WHERE scope_key = ?', chatScopeKey(scope))
}
