import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { z } from 'zod'
import { loadPricing, type Pricing } from './llm/pricing'
import type { ModelSpec } from './llm/groq'

const Kind = z.enum(['news', 'paper', 'community', 'release'])

const Base = {
  id: z.string(),
  name: z.string(),
  kind: Kind,
  weight: z.number().default(1),
  enabled: z.boolean().default(true),
  lang: z.string().optional()
}

const SourceSchema = z.discriminatedUnion('type', [
  z.object({
    ...Base,
    type: z.literal('rss'),
    url: z.string(),
    keywordFilter: z.boolean().default(false),
    /** 피드 앞에서부터 이만큼만 받는다 (Reddit 인기글처럼 순서가 곧 순위인 피드) */
    maxItems: z.number().optional()
  }),
  z.object({ ...Base, type: z.literal('hf_papers') }),
  z.object({ ...Base, type: z.literal('arxiv'), query: z.string(), maxResults: z.number().default(50) }),
  z.object({
    ...Base,
    type: z.literal('hackernews'),
    queries: z.array(z.string()),
    minPoints: z.number().default(50),
    /** Algolia 태그: story(일반 글) 또는 show_hn(직접 만든 프로젝트 소개) */
    tags: z.enum(['story', 'show_hn']).default('story')
  }),
  z.object({
    ...Base,
    type: z.literal('github_releases'),
    /** match: 한 저장소에서 여러 패키지를 내는 경우 태그에 이 글자가 든 릴리스만 받는다 (예: langgraph==) */
    repos: z.array(z.object({ repo: z.string(), name: z.string(), match: z.string().optional() }))
  })
])

export type SourceConfig = z.infer<typeof SourceSchema>
export type ItemKind = z.infer<typeof Kind>

const QuickActionSchema = z.object({ label: z.string(), prompt: z.string() })
const QuickActionsSchema = z.object({ item: z.array(QuickActionSchema), digest: z.array(QuickActionSchema) })
export type QuickActionsConfig = z.infer<typeof QuickActionsSchema>

const InterestsSchema = z.object({
  keywords: z.array(z.object({ term: z.string(), weight: z.number() }))
})
export type Interest = z.infer<typeof InterestsSchema>['keywords'][number]

const Effort = z.enum(['none', 'default', 'low', 'medium', 'high'])
const ModelSpecSchema = z.object({
  model: z.string(),
  reasoningEffort: Effort.optional(),
  maxCompletionTokens: z.number()
})
const ModelsSchema = z.object({
  triage: ModelSpecSchema,
  summary: ModelSpecSchema,
  digest: ModelSpecSchema,
  chat: ModelSpecSchema,
  translate: ModelSpecSchema,
  saveMode: z.object({ model: z.string(), reasoningEffort: Effort.optional() })
})
export type ModelsConfig = z.infer<typeof ModelsSchema>

export interface AppConfig {
  /** 켜진 출처 (수집에 씀) */
  sources: SourceConfig[]
  /** 꺼진 출처까지 전부 (출처 페이지에 씀) */
  allSources: SourceConfig[]
  interests: Interest[]
  models: ModelsConfig
  pricing: Pricing
  prompts: {
    triage: string
    cluster: string
    summary: string
    digest: string
    tags: string
    chatItem: string
    chatDigest: string
    translate: string
    recent: string
  }
  quickActions: QuickActionsConfig
}

function yaml(path: string): unknown {
  return parse(readFileSync(path, 'utf8'))
}

export function loadConfig(dir: string): AppConfig {
  const sources = z.object({ sources: z.array(SourceSchema) }).parse(yaml(join(dir, 'sources.yaml'))).sources
  return {
    sources: sources.filter((s) => s.enabled),
    allSources: sources,
    interests: InterestsSchema.parse(yaml(join(dir, 'interests.yaml'))).keywords,
    models: ModelsSchema.parse(yaml(join(dir, 'models.yaml'))),
    pricing: loadPricing(join(dir, 'pricing.yaml')),
    prompts: {
      triage: readFileSync(join(dir, 'prompts', 'triage.md'), 'utf8'),
      cluster: readFileSync(join(dir, 'prompts', 'cluster.md'), 'utf8'),
      summary: readFileSync(join(dir, 'prompts', 'summary.md'), 'utf8'),
      digest: readFileSync(join(dir, 'prompts', 'digest.md'), 'utf8'),
      tags: readFileSync(join(dir, 'prompts', 'tags.md'), 'utf8'),
      chatItem: readFileSync(join(dir, 'prompts', 'chat-item.md'), 'utf8'),
      chatDigest: readFileSync(join(dir, 'prompts', 'chat-digest.md'), 'utf8'),
      translate: readFileSync(join(dir, 'prompts', 'translate.md'), 'utf8'),
      recent: readFileSync(join(dir, 'prompts', 'recent.md'), 'utf8')
    },
    quickActions: QuickActionsSchema.parse(yaml(join(dir, 'quick-actions.yaml')))
  }
}

/** 절약 모드일 때 역할 모델을 saveMode 모델로 바꾼다. 출력 상한은 역할 값을 유지한다. */
export function modelFor(models: ModelsConfig, role: 'triage' | 'summary' | 'digest' | 'chat' | 'translate', saveMode: boolean): ModelSpec {
  const spec = models[role]
  if (!saveMode) return spec
  return { ...spec, model: models.saveMode.model, reasoningEffort: models.saveMode.reasoningEffort }
}

const METHOD: Record<SourceConfig['type'], string> = {
  rss: 'RSS',
  hf_papers: 'HF 논문 API',
  arxiv: 'arXiv 검색',
  hackernews: 'HN 검색',
  github_releases: 'GitHub 릴리스'
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** 출처 페이지에 보여줄 수집 방식·조건 (sources.yaml 설정을 사람이 읽을 문장으로) */
export function describeSource(s: SourceConfig): { method: string; rules: string[]; url: string | null } {
  const rules: string[] = []
  let url: string | null = null
  switch (s.type) {
    case 'rss':
      url = s.url
      rules.push(`${hostOf(s.url)}의 RSS 피드`)
      if (s.keywordFilter) rules.push('관심 키워드(interests.yaml)에 맞는 글만')
      if (s.maxItems) rules.push(`피드 앞에서 ${s.maxItems}개만`)
      break
    case 'hf_papers':
      url = 'https://huggingface.co/papers'
      rules.push('Hugging Face 오늘의 논문(추천수를 화제성으로 씀)')
      break
    case 'arxiv':
      url = 'https://arxiv.org'
      rules.push(`검색식: ${s.query}`)
      rules.push(`최신순 ${s.maxResults}건까지`)
      break
    case 'hackernews':
      url = 'https://news.ycombinator.com'
      rules.push(`${s.tags === 'show_hn' ? 'Show HN' : '일반 글'} 검색: ${s.queries.join(', ')}`)
      rules.push(`${s.minPoints}점 넘는 글만`)
      break
    case 'github_releases':
      url = 'https://github.com'
      rules.push(`감시 저장소 ${s.repos.length}개: ${s.repos.map((r) => r.name).join(', ')}`)
      rules.push('메이저·마이너 버전만 (패치·rc·beta 제외)')
      break
  }
  if (s.lang === 'ko') rules.push('한국어 글 (번역하지 않음)')
  rules.push(`신뢰도 가중치 ${s.weight}`)
  return { method: METHOD[s.type], rules, url }
}
