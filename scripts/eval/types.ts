import type { ModelSpec } from '../../src/worker/llm/groq'
import type { TokenUsage } from '../../src/worker/llm/pricing'
import type { Summary } from '../../src/worker/pipeline/schemas'

export const OUTPUT_DIR = 'eval/output'
export const SAMPLES_PATH = `${OUTPUT_DIR}/samples.json`
export const RESULTS_PATH = `${OUTPUT_DIR}/results.json`
export const REPORT_PATH = `${OUTPUT_DIR}/report.html`

export type SampleKind = 'news' | 'paper' | 'community'

export interface Sample {
  id: string
  kind: SampleKind
  source: string
  title: string
  url: string
  publishedAt: string | null
  /** 본문 추출 성공 여부. false면 RSS 요약이나 초록만 있음 */
  fullText: boolean
  paragraphs: string[]
}

export { SummaryJsonSchema, SummaryZod, type Summary } from '../../src/worker/pipeline/schemas'

export interface EvalResult {
  sampleId: string
  model: string
  ok: boolean
  data?: Summary
  error?: string
  usage?: TokenUsage
  costUsd?: number | null
  latencyMs?: number
}

export interface EvalRun {
  generatedAt: string
  models: ModelSpec[]
  samples: Sample[]
  results: EvalResult[]
}
