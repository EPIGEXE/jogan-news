// ============================================================================
// 설정 파일 읽기
//
// [역할]
// - config/ 폴더의 YAML(수집 출처 · 관심 키워드 · 역할별 모델 · 단가 · 빠른 질문)과 프롬프트 파일 읽기
// - YAML은 형식을 검증하고 빠진 값은 기본값으로 채움 (형식이 맞지 않거나 파일이 없으면 오류)
// - 출처는 켜진 것(수집용)과 꺼진 것까지 전부(출처 페이지용)를 따로 제공
// - 역할별 모델 고르기: 절약 모드면 절약 모드 모델로 바꿈 (출력 상한은 역할의 값 유지)
// - 출처 설정을 출처 페이지에 보여 줄 문장으로 풀어 씀 (수집 방식 · 조건 · 사이트 주소)
// - 모델 ID는 코드에 쓰지 않고 models.yaml에서만 정함 (DESIGN.md 7.6절)
// ============================================================================
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'
import { loadPricing, type Pricing } from './llm/pricing'
import type { ModelSpec } from './llm/groq'

// 글의 종류 (브리핑 분류의 참고값. 최종 분류는 LLM이 정함)
const ItemKindSchema = z.enum(['news', 'paper', 'community', 'release'])

// 모든 출처가 함께 갖는 항목 (sources.yaml의 키 그대로)
const commonSourceFields = {
    id: z.string(), // 출처 ID (수집 기록 · 통계를 이 값으로 짝지음)
    name: z.string(), // 화면에 보이는 이름
    kind: ItemKindSchema,
    weight: z.number().default(1), // 신뢰도 가중치 (안 적으면 1)
    enabled: z.boolean().default(true), // false면 수집하지 않음 (안 적으면 켜짐)
    lang: z.string().optional() // 글의 언어 ('ko'면 한국어 글이라 번역하지 않음)
}

// 출처 하나의 설정 (type에 따라 수집 방식과 필요한 항목이 달라짐)
const SourceSchema = z.discriminatedUnion('type', [
    // RSS 피드
    z.object({
        ...commonSourceFields,
        type: z.literal('rss'),
        url: z.string(), // 피드 주소
        keywordFilter: z.boolean().default(false), // true면 관심 키워드에 맞는 글만 받음
        // 피드 앞에서부터 이만큼만 받음 (Reddit 인기글처럼 순서가 곧 순위인 피드)
        maxItems: z.number().optional()
    }),
    // Hugging Face 오늘의 논문
    z.object({ ...commonSourceFields, type: z.literal('hf_papers') }),
    // arXiv 검색 (query: 검색식, maxResults: 최신순으로 받을 건수, 안 적으면 50)
    z.object({ ...commonSourceFields, type: z.literal('arxiv'), query: z.string(), maxResults: z.number().default(50) }),
    // Hacker News 검색
    z.object({
        ...commonSourceFields,
        type: z.literal('hackernews'),
        queries: z.array(z.string()), // 검색어 목록
        minPoints: z.number().default(50), // 이 점수를 넘는 글만 받음 (안 적으면 50)
        // Algolia 태그: story(일반 글) 또는 show_hn(직접 만든 프로젝트 소개)
        tags: z.enum(['story', 'show_hn']).default('story')
    }),
    // GitHub 릴리스 감시
    z.object({
        ...commonSourceFields,
        type: z.literal('github_releases'),
        // 감시할 저장소 목록 (repo: 저장소 경로, name: 화면에 보이는 이름)
        // match: 한 저장소에서 여러 패키지를 내는 경우 태그에 이 글자가 든 릴리스만 받음 (예: langgraph==)
        repos: z.array(z.object({ repo: z.string(), name: z.string(), match: z.string().optional() }))
    })
])

export type SourceConfig = z.infer<typeof SourceSchema> // 출처 하나의 설정
export type ItemKind = z.infer<typeof ItemKindSchema> // 글의 종류

// 질문 탭의 빠른 질문 버튼 (label: 버튼 글자, prompt: 실제로 보내는 질문)
const QuickActionSchema = z.object({ label: z.string(), prompt: z.string() })
// item: 기사 한 건에 묻는 질문, digest: 브리핑 전체에 묻는 질문
const QuickActionsSchema = z.object({ item: z.array(QuickActionSchema), digest: z.array(QuickActionSchema) })
export type QuickActionsConfig = z.infer<typeof QuickActionsSchema> // 빠른 질문 목록

// 관심 키워드 목록 (term: 키워드, weight: 제목 · 요약에 있을 때 규칙 점수에 더하는 값)
const InterestsSchema = z.object({
    keywords: z.array(z.object({ term: z.string(), weight: z.number() }))
})
export type Interest = z.infer<typeof InterestsSchema>['keywords'][number] // 관심 키워드 하나

const ReasoningEffortSchema = z.enum(['none', 'default', 'low', 'medium', 'high']) // 추론 강도

// 역할 하나의 모델 설정 (모델 ID · 추론 강도 · 출력 토큰 상한)
const ModelSpecSchema = z.object({
    model: z.string(),
    reasoningEffort: ReasoningEffortSchema.optional(),
    maxCompletionTokens: z.number()
})

// 역할별 모델 (models.yaml의 키 그대로)
const ModelsSchema = z.object({
    triage: ModelSpecSchema, // 1차 선별
    summary: ModelSpecSchema, // 한국어 제목 · 요약
    digest: ModelSpecSchema, // 브리핑 머리글
    chat: ModelSpecSchema, // AI 질문 답변
    translate: ModelSpecSchema, // 본문 번역
    saveMode: z.object({ model: z.string(), reasoningEffort: ReasoningEffortSchema.optional() }) // 월 예산을 다 쓰면 대신 쓰는 모델
})
export type ModelsConfig = z.infer<typeof ModelsSchema> // 역할별 모델 설정

// 읽어 들인 설정 전체
export interface AppConfig {
    sources: SourceConfig[] // 켜진 출처 (수집에 씀)
    allSources: SourceConfig[] // 꺼진 출처까지 전부 (출처 페이지에 씀)
    interests: Interest[] // 관심 키워드
    models: ModelsConfig // 역할별 모델
    pricing: Pricing // 모델별 단가
    // LLM에 보내는 시스템 프롬프트 (config/prompts/ 의 파일 내용 그대로)
    prompts: {
        triage: string // 1차 선별
        cluster: string // 같은 소식을 다룬 기사 묶기
        summary: string // 기사 한 건의 한국어 요약
        digest: string // 브리핑 머리글
        tags: string // 저장한 기사의 태그 추천
        chatItem: string // 기사 한 건에 대한 질문 답변
        chatDigest: string // 브리핑 전체에 대한 질문 답변
        translate: string // 본문 번역
        recent: string // 지난 7일 브리핑에 이미 실린 소식 가려내기
    }
    quickActions: QuickActionsConfig // 빠른 질문 버튼
}

// YAML 파일을 읽어 값으로 변환 (형식 검증은 부르는 쪽에서)
function readYamlFile(yamlFilePath: string): unknown {
    return parse(readFileSync(yamlFilePath, 'utf8'))
}

/**
 * 설정 폴더의 파일을 모두 읽기
 *
 * - Worker 서비스가 만들어질 때 한 번 읽음 (그 뒤에 파일을 고쳐도 다시 읽지 않음)
 *
 * @param {string} configDir - 설정 파일이 있는 폴더 (config/)
 * @returns {AppConfig} 읽어 들인 설정 (파일이 없거나 형식이 맞지 않으면 오류)
 */
export function loadConfig(configDir: string): AppConfig {
    // 출처는 꺼진 것까지 전부 읽어 두고, 수집용으로 켜진 것만 따로 추림
    const allSources = z.object({ sources: z.array(SourceSchema) }).parse(readYamlFile(join(configDir, 'sources.yaml'))).sources

    // 나머지 YAML은 형식을 검증해서, 프롬프트는 파일 내용 그대로 담음
    return {
        sources: allSources.filter((sourceConfig) => sourceConfig.enabled),
        allSources,
        interests: InterestsSchema.parse(readYamlFile(join(configDir, 'interests.yaml'))).keywords,
        models: ModelsSchema.parse(readYamlFile(join(configDir, 'models.yaml'))),
        pricing: loadPricing(join(configDir, 'pricing.yaml')),
        prompts: {
            triage: readFileSync(join(configDir, 'prompts', 'triage.md'), 'utf8'),
            cluster: readFileSync(join(configDir, 'prompts', 'cluster.md'), 'utf8'),
            summary: readFileSync(join(configDir, 'prompts', 'summary.md'), 'utf8'),
            digest: readFileSync(join(configDir, 'prompts', 'digest.md'), 'utf8'),
            tags: readFileSync(join(configDir, 'prompts', 'tags.md'), 'utf8'),
            chatItem: readFileSync(join(configDir, 'prompts', 'chat-item.md'), 'utf8'),
            chatDigest: readFileSync(join(configDir, 'prompts', 'chat-digest.md'), 'utf8'),
            translate: readFileSync(join(configDir, 'prompts', 'translate.md'), 'utf8'),
            recent: readFileSync(join(configDir, 'prompts', 'recent.md'), 'utf8')
        },
        quickActions: QuickActionsSchema.parse(readYamlFile(join(configDir, 'quick-actions.yaml')))
    }
}

/**
 * 역할에 쓸 모델 설정 고르기
 *
 * - 절약 모드일 때 역할 모델을 saveMode 모델 · 추론 강도로 바꿈
 * - 출력 상한은 역할 값을 유지
 *
 * @param {ModelsConfig} modelsConfig - 역할별 모델 설정
 * @param role - 모델을 쓸 역할
 * @param {boolean} isSaveMode - 절약 모드인지 (이번 달 사용액이 월 예산에 도달)
 * @returns {ModelSpec} 그 역할에 쓸 모델 설정
 */
export function modelSpecForRole(
    modelsConfig: ModelsConfig,
    role: 'triage' | 'summary' | 'digest' | 'chat' | 'translate',
    isSaveMode: boolean
): ModelSpec {
    const roleModelSpec = modelsConfig[role]

    // 절약 모드가 아니면 역할의 설정 그대로
    if (!isSaveMode) return roleModelSpec

    // 절약 모드 → 모델과 추론 강도만 절약 모드 값으로 바꿈
    return { ...roleModelSpec, model: modelsConfig.saveMode.model, reasoningEffort: modelsConfig.saveMode.reasoningEffort }
}

// 출처 페이지에 보여 줄 수집 방식 이름 (출처의 type별)
const COLLECT_METHOD_LABELS: Record<SourceConfig['type'], string> = {
    rss: 'RSS',
    hf_papers: 'HF 논문 API',
    arxiv: 'arXiv 검색',
    hackernews: 'HN 검색',
    github_releases: 'GitHub 릴리스'
}

// 주소에서 사이트 이름만 꺼냄 (앞의 www.는 뗌, 주소로 읽을 수 없으면 받은 글자 그대로)
function hostnameOf(feedUrl: string): string {
    try {
        return new URL(feedUrl).hostname.replace(/^www\./, '')
    } catch {
        return feedUrl
    }
}

/**
 * 출처 페이지에 보여 줄 수집 방식 · 조건 만들기 (sources.yaml 설정을 사람이 읽을 문장으로)
 *
 * @param {SourceConfig} sourceConfig - 출처 하나의 설정
 * @returns 수집 방식 이름(method) · 수집 조건 문장 목록(rules) · 출처 주소(url, RSS는 피드 주소, 그 밖은 사이트 주소)
 */
export function describeSource(sourceConfig: SourceConfig): { method: string; rules: string[]; url: string | null } {
    const collectRules: string[] = [] // 수집 조건을 풀어 쓴 문장 (출처 종류에 맞게 채움)
    let siteUrl: string | null = null // 출처 페이지에 보여 줄 주소

    // 출처 종류별 주소와 조건
    switch (sourceConfig.type) {
        case 'rss':
            // RSS → 피드 주소를 그대로 쓰고, 켜 둔 조건(키워드 거르기 · 개수 제한)만 적음
            siteUrl = sourceConfig.url
            collectRules.push(`${hostnameOf(sourceConfig.url)}의 RSS 피드`)
            if (sourceConfig.keywordFilter) collectRules.push('관심 키워드(interests.yaml)에 맞는 글만')
            if (sourceConfig.maxItems) collectRules.push(`피드 앞에서 ${sourceConfig.maxItems}개만`)
            break
        case 'hf_papers':
            // Hugging Face 오늘의 논문
            siteUrl = 'https://huggingface.co/papers'
            collectRules.push('Hugging Face 오늘의 논문(추천수를 화제성으로 씀)')
            break
        case 'arxiv':
            // arXiv → 검색식과 받는 건수
            siteUrl = 'https://arxiv.org'
            collectRules.push(`검색식: ${sourceConfig.query}`)
            collectRules.push(`최신순 ${sourceConfig.maxResults}건까지`)
            break
        case 'hackernews':
            // Hacker News → 글 종류 · 검색어와 최소 점수
            siteUrl = 'https://news.ycombinator.com'
            collectRules.push(`${sourceConfig.tags === 'show_hn' ? 'Show HN' : '일반 글'} 검색: ${sourceConfig.queries.join(', ')}`)
            collectRules.push(`${sourceConfig.minPoints}점 넘는 글만`)
            break
        case 'github_releases':
            // GitHub 릴리스 → 감시하는 저장소 이름과 받는 버전 범위
            siteUrl = 'https://github.com'
            collectRules.push(
                `감시 저장소 ${sourceConfig.repos.length}개: ${sourceConfig.repos.map((watchedRepo) => watchedRepo.name).join(', ')}`
            )
            collectRules.push('메이저·마이너 버전만 (패치·rc·beta 제외)')
            break
    }

    // 모든 출처에 붙는 조건 (한국어 글 여부 · 신뢰도 가중치)
    if (sourceConfig.lang === 'ko') collectRules.push('한국어 글 (번역하지 않음)')
    collectRules.push(`신뢰도 가중치 ${sourceConfig.weight}`)
    return { method: COLLECT_METHOD_LABELS[sourceConfig.type], rules: collectRules, url: siteUrl }
}
