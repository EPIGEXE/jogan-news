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
  z.object({ ...Base, type: z.literal('rss'), url: z.string(), keywordFilter: z.boolean().default(false) }),
  z.object({ ...Base, type: z.literal('hf_papers') }),
  z.object({ ...Base, type: z.literal('arxiv'), query: z.string(), maxResults: z.number().default(50) }),
  z.object({
    ...Base,
    type: z.literal('hackernews'),
    queries: z.array(z.string()),
    minPoints: z.number().default(50)
  })
])

export type SourceConfig = z.infer<typeof SourceSchema>
export type ItemKind = z.infer<typeof Kind>

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
  saveMode: z.object({ model: z.string(), reasoningEffort: Effort.optional() })
})
export type ModelsConfig = z.infer<typeof ModelsSchema>

export interface AppConfig {
  sources: SourceConfig[]
  interests: Interest[]
  models: ModelsConfig
  pricing: Pricing
  prompts: { triage: string; cluster: string; summary: string; digest: string; tags: string }
}

function yaml(path: string): unknown {
  return parse(readFileSync(path, 'utf8'))
}

export function loadConfig(dir: string): AppConfig {
  const sources = z.object({ sources: z.array(SourceSchema) }).parse(yaml(join(dir, 'sources.yaml'))).sources
  return {
    sources: sources.filter((s) => s.enabled),
    interests: InterestsSchema.parse(yaml(join(dir, 'interests.yaml'))).keywords,
    models: ModelsSchema.parse(yaml(join(dir, 'models.yaml'))),
    pricing: loadPricing(join(dir, 'pricing.yaml')),
    prompts: {
      triage: readFileSync(join(dir, 'prompts', 'triage.md'), 'utf8'),
      cluster: readFileSync(join(dir, 'prompts', 'cluster.md'), 'utf8'),
      summary: readFileSync(join(dir, 'prompts', 'summary.md'), 'utf8'),
      digest: readFileSync(join(dir, 'prompts', 'digest.md'), 'utf8'),
      tags: readFileSync(join(dir, 'prompts', 'tags.md'), 'utf8')
    }
  }
}

/** 절약 모드일 때 역할 모델을 saveMode 모델로 바꾼다. 출력 상한은 역할 값을 유지한다. */
export function modelFor(models: ModelsConfig, role: 'triage' | 'summary' | 'digest', saveMode: boolean): ModelSpec {
  const spec = models[role]
  if (!saveMode) return spec
  return { ...spec, model: models.saveMode.model, reasoningEffort: models.saveMode.reasoningEffort }
}
