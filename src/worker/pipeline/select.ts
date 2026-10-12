// ============================================================================
// 점수 계산과 브리핑 기사 선정
//
// [역할]
// - 규칙 점수: LLM에 보내기 전 1차 점수 (소스 신뢰도 + 관심 키워드 + 참여도 + 다른 출처 수 + 최신성)
// - 최종 점수: LLM 선별 결과 반영 (관련도 × 중요도가 중심, 참여도 · 다른 출처 수 · 규칙 점수를 더함)
// - 선정: 관련도 0.4 미만은 빼되 중요도 5는 "그 외 주요 소식"으로 남김
// - 최소 몫: 도구 3건 · 실전 2건을 먼저 채움 (관련도 0.6 · 중요도 2 이상인 후보만)
// - 상한: 논문 3 · 커뮤니티 4 · 업계 3 · 그 외 3건, 상위 5건은 "오늘의 톱" 섹션
// - 본문이 부족한 기사는 빼고 다음 순위 후보로 채움
// - LLM이 묶은 같은 소식을 대표 하나로 합침
// - DB나 네트워크를 쓰지 않는 순수 함수 (테스트로 동작을 고정)
// ============================================================================
import type { Category, Section } from '@shared/types'
import type { Interest } from '../config'

// 규칙 점수를 매길 기사 하나의 정보
export interface ScoreInput {
    id: number // 기사 번호
    title: string // 원래 제목
    snippet: string // 수집한 첫 부분 (요약 · 초록)
    sourceWeight: number // 소스 신뢰도 가중치 (sources.yaml의 weight)
    engagement: number // 참여도 (HN 점수 · HF 추천수 등)
    otherSourceCount: number // 같은 소식을 다룬 다른 출처 수
    ageHours: number // 발행 또는 수집 후 지난 시간
}

// 0~1 범위로 자르기
const clamp01 = (score: number) => Math.max(0, Math.min(1, score))

/**
 * 관심 키워드 점수
 * - 글에 들어 있는 키워드의 가중치를 더하고, 합은 1에서 자름 (대소문자 무시)
 *
 * @param {string} text - 키워드를 찾을 글 (제목 + 첫 부분)
 * @param {Interest[]} interests - 관심 키워드와 가중치 (interests.yaml)
 * @returns {number} 0~1
 */
export function keywordScore(text: string, interests: Interest[]): number {
    const lowerText = text.toLowerCase()
    const weightSum = interests.reduce(
        (matchedWeight, interest) => (lowerText.includes(interest.term.toLowerCase()) ? matchedWeight + interest.weight : matchedWeight),
        0
    )
    return clamp01(weightSum)
}

/**
 * 참여도(HN 점수 · HF 추천수)를 0~1로 환산
 * - 로그로 눌러서 1000점 근처에서 1 (0점 0, 9점 약 0.33, 99점 약 0.67)
 *
 * @param {number} engagement - 참여도
 * @returns {number} 0~1
 */
export function engagementScore(engagement: number): number {
    return clamp01(Math.log10(1 + engagement) / 3)
}

/**
 * LLM에 보내기 전 1차 점수 (DESIGN.md 9절 ④)
 * - 소스 신뢰도 가중치 그대로
 * - 관심 키워드 0~1, 참여도 0~1
 * - 다른 출처 하나당 0.3 (3곳까지만 인정, 최대 0.9)
 * - 최신성 최대 0.5 (방금 나온 글 0.5, 72시간이 지나면 0)
 *
 * @param {ScoreInput} scoreInput - 기사 정보
 * @param {Interest[]} interests - 관심 키워드와 가중치
 * @returns {number} 규칙 점수 (클수록 선별 단계로 넘어갈 가능성이 큼)
 */
export function ruleScore(scoreInput: ScoreInput, interests: Interest[]): number {
    return (
        scoreInput.sourceWeight +
        keywordScore(`${scoreInput.title} ${scoreInput.snippet}`, interests) +
        engagementScore(scoreInput.engagement) +
        0.3 * Math.min(3, scoreInput.otherSourceCount) +
        0.5 * clamp01(1 - scoreInput.ageHours / 72)
    )
}

// LLM 선별까지 끝난 선정 후보 하나
export interface TriagedItem {
    id: number // 기사 번호
    category: Category // LLM이 매긴 분류
    relevance: number // LLM이 매긴 관련도 (0~1)
    importance: number // LLM이 매긴 중요도 (1~5)
    ruleScore: number // 규칙 점수
    engagement: number // 참여도
    otherSourceCount: number // 같은 소식을 다룬 다른 출처 수
}

/**
 * LLM 선별 결과를 반영한 최종 점수
 * - 관련도(0~1) × 중요도(1~5)가 중심 (최대 5)
 * - 참여도 최대 0.5, 다른 출처 하나당 0.3 (3곳까지, 최대 0.9), 규칙 점수의 10%를 더함
 *
 * @param {TriagedItem} triagedItem - 선정 후보
 * @returns {number} 최종 점수 (클수록 순위가 높음)
 */
export function finalScore(triagedItem: TriagedItem): number {
    return (
        clamp01(triagedItem.relevance) * triagedItem.importance +
        0.5 * engagementScore(triagedItem.engagement) +
        0.3 * Math.min(3, triagedItem.otherSourceCount) +
        0.1 * triagedItem.ruleScore
    )
}

// 분류별 상한 (건): 논문 3 · 커뮤니티 4 · 업계 3 · 그 외 3 (그 외는 분야 밖 대형 뉴스만이라 최대 3건, DESIGN.md 9절)
// 모델 출시 · 도구 · 실전은 상한 없음
const CATEGORY_CAP: Partial<Record<Category, number>> = { research: 3, community: 4, industry: 3, other: 3 }
// 분류별 최소 몫 (건): 도구 3 · 실전 2
// 충분히 관련 있는 후보가 있으면 이만큼은 꼭 실음 (개발 도구 · 실전 소식이 큰 뉴스에 밀려 빠지지 않게)
const CATEGORY_QUOTA: Partial<Record<Category, number>> = { tools: 3, applied: 2 }
// 최소 몫으로 넣을 수 있는 기준 (관련도 0.6 · 중요도 2 이상)
// 일반 기준보다 높여서 자리 채우기용 약한 글이 들어오지 않게 함
const QUOTA_MIN_RELEVANCE = 0.6
const QUOTA_MIN_IMPORTANCE = 2
const MIN_RELEVANCE = 0.4 // 브리핑에 실을 수 있는 최소 관련도 (0~1)
const TOP_COUNT = 5 // "오늘의 톱" 섹션에 넣는 상위 기사 수 (건)

// 브리핑에 싣기로 고른 기사 하나
export interface SelectedEntry {
    id: number // 기사 번호
    rank: number // 브리핑 안에서의 순위 (1부터)
    section: Section // 실릴 섹션 (상위 5개는 'top', 나머지는 자기 분류)
}

/**
 * 최종 점수 순으로 브리핑 기사 선정
 * - 관련도가 낮은 기사는 빼되, 중요도 5짜리는 '그 외 주요 소식'으로 남김
 * - 도구 · 실전 분류는 최소 몫을 먼저 채우고, 나머지 자리는 점수 순으로 채움
 * - 분류별 상한을 지킴. 상위 5개는 'top' 섹션, 나머지는 자기 분류 섹션
 *
 * @param {TriagedItem[]} items - 선정 후보
 * @param {number} size - 브리핑에 실을 기사 수
 * @returns {SelectedEntry[]} 순위대로 정렬한 선정 결과 (후보가 모자라면 size보다 적음)
 */
export function selectEntries(items: TriagedItem[], size: number): SelectedEntry[] {
    // 실을 수 있는 후보만 최종 점수 순으로
    const eligibleItems = items
        .map((triagedItem) => {
            // 관련도 0.4 이상 → 그대로 후보
            if (triagedItem.relevance >= MIN_RELEVANCE) return triagedItem
            // 관련도는 낮지만 중요도 5 → 분류를 '그 외 주요 소식'으로 바꿔 남김
            if (triagedItem.importance >= 5) return { ...triagedItem, category: 'other' as const }
            // 그 밖은 제외
            return null
        })
        .filter((triagedItem): triagedItem is TriagedItem => triagedItem !== null)
        .sort((leftItem, rightItem) => finalScore(rightItem) - finalScore(leftItem))

    // 최소 몫 먼저 채우기 (도구 3건 · 실전 2건, 기준을 넘는 후보 중 점수 순)
    const pickedItems = new Set<TriagedItem>()
    for (const [category, quota] of Object.entries(CATEGORY_QUOTA) as [Category, number][]) {
        const quotaCandidates = eligibleItems.filter(
            (eligibleItem) =>
                eligibleItem.category === category &&
                eligibleItem.relevance >= QUOTA_MIN_RELEVANCE &&
                eligibleItem.importance >= QUOTA_MIN_IMPORTANCE
        )
        for (const quotaItem of quotaCandidates.slice(0, quota)) {
            // 브리핑 크기가 몫의 합보다 작으면 크기까지만
            if (pickedItems.size < size) pickedItems.add(quotaItem)
        }
    }

    // 몫으로 들어간 기사도 분류별 개수에 포함
    const pickedCountByCategory = new Map<Category, number>() // 분류별로 지금까지 고른 수 (상한 확인용)
    for (const quotaItem of pickedItems)
        pickedCountByCategory.set(quotaItem.category, (pickedCountByCategory.get(quotaItem.category) ?? 0) + 1)

    // 나머지 자리를 점수 순으로 채우기
    for (const eligibleItem of eligibleItems) {
        // 브리핑 크기를 다 채웠으면 끝
        if (pickedItems.size >= size) break
        // 몫으로 이미 들어간 기사는 건너뜀
        if (pickedItems.has(eligibleItem)) continue

        // 그 분류의 상한에 닿았으면 건너뜀 (상한이 없는 분류는 그대로 넣음)
        const categoryCap = CATEGORY_CAP[eligibleItem.category]
        const pickedInCategory = pickedCountByCategory.get(eligibleItem.category) ?? 0
        if (categoryCap !== undefined && pickedInCategory >= categoryCap) continue
        pickedCountByCategory.set(eligibleItem.category, pickedInCategory + 1)
        pickedItems.add(eligibleItem)
    }

    // 순위는 몫으로 들어온 기사도 점수대로 매김. 상위 5개는 'top', 나머지는 자기 분류 섹션
    return [...pickedItems]
        .sort((leftItem, rightItem) => finalScore(rightItem) - finalScore(leftItem))
        .map((pickedItem, rankIndex) => ({
            id: pickedItem.id,
            rank: rankIndex + 1,
            section: rankIndex < TOP_COUNT ? 'top' : pickedItem.category
        }))
}

/**
 * 순위대로 고른 기사의 본문을 확인하며, 본문이 부족한 기사는 빼고 다음 순위 후보로 채움
 * - hasBody는 기사마다 한 번만 부름 (결과를 기억)
 * - 전체 확인 횟수는 maxChecks까지만. 상한에 걸려 확인하지 못한 자리는 비워 둠
 * - 분류별 최소 몫 · 상한은 selectEntries가 다시 지킴
 *
 * @param {TriagedItem[]} items - 선정 후보
 * @param {number} size - 브리핑에 실을 기사 수
 * @param {number} maxChecks - 본문을 확인하는 기사 수 상한
 * @param hasBody - 기사 번호를 받아 본문이 충분한지 알려 주는 함수 (본문 추출을 겸함)
 * @returns 본문이 확인된 선정 결과(selected)와 본문이 부족해 뺀 기사 번호(excluded)
 */
export async function fillWithContent(
    items: TriagedItem[],
    size: number,
    maxChecks: number,
    hasBody: (id: number) => Promise<boolean>
): Promise<{ selected: SelectedEntry[]; excluded: number[] }> {
    const hasBodyById = new Map<number, boolean>() // 기사별 본문 확인 결과 (확인한 기사만 들어 있음)
    let selectedEntries = selectEntries(items, size)
    for (;;) {
        // 지금 고른 기사 중 아직 확인하지 않은 것 (남은 확인 횟수만큼만)
        const entriesToCheck = selectedEntries
            .filter((selectedEntry) => !hasBodyById.has(selectedEntry.id))
            .slice(0, Math.max(0, maxChecks - hasBodyById.size))

        // 모두 확인했거나 확인 횟수를 다 씀 → 끝
        if (entriesToCheck.length === 0) break

        // 동시에 본문 확인
        const checkResults = await Promise.all(
            entriesToCheck.map(async (entryToCheck) => [entryToCheck.id, await hasBody(entryToCheck.id)] as const)
        )
        for (const [itemId, hasEnoughBody] of checkResults) hasBodyById.set(itemId, hasEnoughBody)

        // 빠진 기사가 있으면 그 자리를 다음 순위 후보로 채워 다시 고름 (본문이 부족하다고 확인된 기사만 제외)
        if (checkResults.some(([, hasEnoughBody]) => !hasEnoughBody))
            selectedEntries = selectEntries(
                items.filter((triagedItem) => hasBodyById.get(triagedItem.id) !== false),
                size
            )
    }

    // 본문이 확인된 기사만 남겨 순위 · 섹션을 다시 매김 (확인하지 못한 기사는 싣지 않음)
    const confirmedIds = new Set(
        selectedEntries.filter((selectedEntry) => hasBodyById.get(selectedEntry.id) === true).map((selectedEntry) => selectedEntry.id)
    )
    return {
        selected: selectEntries(
            items.filter((triagedItem) => confirmedIds.has(triagedItem.id)),
            size
        ),
        excluded: [...hasBodyById].filter(([, hasEnoughBody]) => !hasEnoughBody).map(([itemId]) => itemId)
    }
}

// 같은 소식을 합친 결과
export interface ClusterResult {
    items: TriagedItem[] // 합친 뒤 남은 후보 (대표는 합쳐진 값으로 바뀜)
    merges: Map<number, number[]> // 대표 기사 번호별로 합쳐진 나머지 기사 번호
}

// LLM이 같은 소식이라고 묶은 그룹 하나
export interface ClusterGroup {
    ids: number[] // 묶인 기사 번호
    primary?: number // LLM이 고른 원본에 가장 가까운 기사 (공식 발표 > 보도 > 커뮤니티)
}

/**
 * LLM이 묶은 같은 소식 그룹을 대표 하나로 합침
 * - 대표: LLM이 고른 primary. 없거나 그룹에 없으면 중요도가 가장 높은 기사
 * - 대표는 다른 출처 수와 참여도 · 중요도(최댓값)를 물려받음
 * - 한 기사가 여러 그룹에 나오면 처음 그룹만 인정
 *
 * @param {TriagedItem[]} items - 묶기 전 후보
 * @param {ClusterGroup[]} groups - LLM이 답한 그룹
 * @returns {ClusterResult} 합친 뒤의 후보와, 대표별로 합쳐진 기사 번호
 */
export function applyClusters(items: TriagedItem[], groups: ClusterGroup[]): ClusterResult {
    const itemById = new Map(items.map((triagedItem) => [triagedItem.id, triagedItem]))
    const groupedIds = new Set<number>() // 이미 어느 그룹에 들어간 기사 번호
    const merges = new Map<number, number[]>()
    const mergedRepresentativeById = new Map<number, TriagedItem>() // 합쳐진 값을 물려받은 대표 (대표 기사 번호별)
    for (const group of groups) {
        // 그룹의 기사 중 후보에 있고 아직 다른 그룹에 들지 않은 것만 (같은 번호가 두 번 나오면 한 번만)
        const members = [...new Set(group.ids)]
            .filter((memberId) => itemById.has(memberId) && !groupedIds.has(memberId))
            .map((memberId) => itemById.get(memberId)!)

        // 남은 기사가 하나 이하면 합칠 것 없음
        if (members.length < 2) continue
        members.forEach((member) => groupedIds.add(member.id))

        // 대표 고르기: LLM이 고른 primary가 그룹에 있으면 그 기사
        // 없으면 중요도가 가장 높은 기사(보통 공식 발표), 같으면 최종 점수가 높은 기사
        const representativePriority = (member: TriagedItem) => member.importance * 100 + finalScore(member)
        const representative =
            members.find((member) => member.id === group.primary) ??
            members.reduce((bestMember, nextMember) =>
                representativePriority(nextMember) > representativePriority(bestMember) ? nextMember : bestMember
            )

        // 나머지는 대표에 합쳐진 것으로 기록
        const mergedMembers = members.filter((member) => member.id !== representative.id)
        merges.set(
            representative.id,
            mergedMembers.map((mergedMember) => mergedMember.id)
        )

        // 대표가 물려받는 값: 다른 출처 수(합쳐진 기사 자신 + 그 기사의 다른 출처), 참여도 · 중요도는 그룹의 최댓값
        mergedRepresentativeById.set(representative.id, {
            ...representative,
            otherSourceCount:
                representative.otherSourceCount +
                mergedMembers.reduce((sourceCount, mergedMember) => sourceCount + 1 + mergedMember.otherSourceCount, 0),
            engagement: Math.max(representative.engagement, ...mergedMembers.map((mergedMember) => mergedMember.engagement)),
            importance: Math.max(representative.importance, ...mergedMembers.map((mergedMember) => mergedMember.importance))
        })
    }

    // 합쳐진 기사는 빼고, 대표는 물려받은 값으로 바꿔 반환
    const mergedAwayIds = new Set([...merges.values()].flat())
    return {
        items: items
            .filter((triagedItem) => !mergedAwayIds.has(triagedItem.id))
            .map((triagedItem) => mergedRepresentativeById.get(triagedItem.id) ?? triagedItem),
        merges
    }
}
