// 한국어 품질 비교 테스트 실행 (DESIGN.md 7.7절).
// eval/output/samples.json의 기사를 여러 모델로 요약하고 결과 비교 리포트를 만든다.
//
//   npm run eval:llm                       # 기본 3개 모델
//   npm run eval:llm -- --models openai/gpt-oss-120b --limit 5
//   npm run eval:llm -- --yes              # 예상 비용이 상한을 넘어도 실행
//   npm run eval:llm -- --report-only      # 이미 있는 results.json으로 리포트만 다시 생성

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { config } from 'dotenv'
import pLimit from 'p-limit'
import { completeJson, createGroq, type ModelSpec } from '../../src/worker/llm/groq'
import { costUsd, loadPricing } from '../../src/worker/llm/pricing'
import { summaryUserMessage } from '../../src/worker/pipeline/schemas'
import { renderReport } from './report'
import {
  REPORT_PATH,
  RESULTS_PATH,
  SAMPLES_PATH,
  SummaryJsonSchema,
  SummaryZod,
  type EvalResult,
  type EvalRun,
  type Sample
} from './types'

const DEFAULT_MODELS: ModelSpec[] = [
  { model: 'openai/gpt-oss-20b', reasoningEffort: 'low', maxCompletionTokens: 1500 },
  { model: 'openai/gpt-oss-120b', reasoningEffort: 'low', maxCompletionTokens: 1500 },
  { model: 'qwen/qwen3.8-27b', reasoningEffort: 'none', maxCompletionTokens: 1500 }
]

/** 한 번 실행에 허용하는 예상 비용 상한 (USD). 넘으면 --yes 없이는 실행하지 않는다. */
const COST_GUARD_USD = 0.5
const CONCURRENCY_PER_MODEL = 3

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const flag = (name: string) => process.argv.includes(`--${name}`)

function userMessage(s: Sample): string {
  return summaryUserMessage({ sourceName: s.source, kind: s.kind, title: s.title, paragraphs: s.paragraphs, fullText: s.fullText })
}

function writeReport(run: EvalRun): void {
  writeFileSync(REPORT_PATH, renderReport(run))
  console.log(`리포트 → ${REPORT_PATH}`)
}

async function main(): Promise<void> {
  if (flag('report-only')) {
    writeReport(JSON.parse(readFileSync(RESULTS_PATH, 'utf8')) as EvalRun)
    return
  }

  config({ path: '.env', quiet: true })
  const apiKey = process.env['GROQ_API_KEY']
  if (!apiKey) {
    console.error('GROQ_API_KEY가 없습니다. .env.example을 .env로 복사하고 키를 채운 뒤 다시 실행하세요.')
    process.exit(1)
  }
  if (!existsSync(SAMPLES_PATH)) {
    console.error(`${SAMPLES_PATH}가 없습니다. 먼저 npm run eval:collect를 실행하세요.`)
    process.exit(1)
  }

  const allSamples = JSON.parse(readFileSync(SAMPLES_PATH, 'utf8')) as Sample[]
  const limit = Number(arg('limit') ?? allSamples.length)
  const samples = allSamples.slice(0, limit)
  const wanted = arg('models')?.split(',')
  const pricing = loadPricing('config/pricing.yaml')
  const system = readFileSync('config/prompts/summary.md', 'utf8')
  const groq = createGroq(apiKey)

  // 설정한 모델이 Groq에 아직 있는지 확인 (DESIGN.md 7.6절)
  const available = new Set((await groq.models.list()).data.map((m) => m.id))
  const models = DEFAULT_MODELS.filter((m) => !wanted || wanted.includes(m.model)).filter((m) => {
    if (available.has(m.model)) return true
    console.warn(`  ! ${m.model}: 현재 Groq에서 사용할 수 없어 건너뜀`)
    return false
  })
  if (models.length === 0) {
    console.error('실행할 모델이 없습니다.')
    process.exit(1)
  }

  // 예상 비용: 입력은 글자 수 / 3.5로 토큰을 어림잡고, 출력은 상한의 절반을 쓴다고 가정한다.
  const estimate = models.reduce((sum, m) => {
    const inputTokens = samples.reduce((t, s) => t + (system.length + userMessage(s).length) / 3.5, 0)
    const outputTokens = samples.length * (m.maxCompletionTokens / 2)
    return sum + (costUsd(pricing, m.model, { input: inputTokens, cachedInput: 0, output: outputTokens, reasoning: 0 }) ?? 0)
  }, 0)
  console.log(`샘플 ${samples.length}건 × 모델 ${models.length}개, 예상 비용 약 $${estimate.toFixed(3)}`)
  if (estimate > COST_GUARD_USD && !flag('yes')) {
    console.error(`예상 비용이 상한 $${COST_GUARD_USD}를 넘습니다. 그래도 실행하려면 --yes를 붙이세요.`)
    process.exit(1)
  }

  const results: EvalResult[] = []
  await Promise.all(
    models.map(async (spec) => {
      const limiter = pLimit(CONCURRENCY_PER_MODEL)
      await Promise.all(
        samples.map((s) =>
          limiter(async () => {
            try {
              const r = await completeJson(
                groq,
                spec,
                { system, user: userMessage(s) },
                { name: 'article_summary', jsonSchema: SummaryJsonSchema, zod: SummaryZod }
              )
              results.push({
                sampleId: s.id,
                model: spec.model,
                ok: true,
                data: r.data,
                usage: r.usage,
                costUsd: costUsd(pricing, spec.model, r.usage),
                latencyMs: r.latencyMs
              })
              process.stdout.write('.')
            } catch (err) {
              results.push({ sampleId: s.id, model: spec.model, ok: false, error: (err as Error).message })
              process.stdout.write('x')
            }
          })
        )
      )
    })
  )
  console.log()

  const run: EvalRun = { generatedAt: new Date().toISOString(), models, samples, results }
  writeFileSync(RESULTS_PATH, JSON.stringify(run, null, 2))
  console.log(`결과 → ${RESULTS_PATH}`)

  for (const m of models) {
    const rs = results.filter((r) => r.model === m.model)
    const ok = rs.filter((r) => r.ok)
    const cost = ok.reduce((t, r) => t + (r.costUsd ?? 0), 0)
    const avgMs = ok.length ? ok.reduce((t, r) => t + (r.latencyMs ?? 0), 0) / ok.length : 0
    console.log(`  ${m.model}: 성공 ${ok.length}/${rs.length}, 평균 ${(avgMs / 1000).toFixed(1)}초, 비용 $${cost.toFixed(4)}`)
  }
  writeReport(run)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
