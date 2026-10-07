import type Groq from 'groq-sdk'
import { z } from 'zod'
import { modelFor, type AppConfig } from '../config'
import type { Db } from '../db/db'
import * as repo from '../db/repo'
import { LlmSession } from '../llm/service'
import { extractArticle } from './extract'

// 기사를 저장하면 뒤에서 하는 일 (DESIGN.md 6.2절):
// 1) 본문이 아직 없으면 원문에서 추출해 문단으로 보관 (원문 링크가 사라져도 남고, 나중에 AI 질문의 근거가 됨)
// 2) 태그가 없으면 LLM(20B)이 2~3개 추천

const MAX_EXISTING_TAGS = 60

const TagsZod = z.object({ tags: z.array(z.string()) })
const TagsJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['tags'],
  properties: { tags: { type: 'array', items: { type: 'string' } } }
}

function isExtractable(url: string, kind: string): boolean {
  if (kind === 'paper') return false
  try {
    return new URL(url).hostname !== 'news.ycombinator.com'
  } catch {
    return false
  }
}

export interface EnrichDeps {
  db: Db
  config: AppConfig
  groq: Groq | null
  log(level: 'info' | 'warn' | 'error', message: string): void
}

/**
 * 저장한 기사 한 건을 보강한다. 실패해도 저장 자체에는 영향이 없다.
 * 처리를 했으면 true(화면이 "추천 중" 표시를 거두도록 결과와 상관없이 알린다), 할 일이 없었으면 false.
 */
export async function enrichSavedItem(deps: EnrichDeps, itemId: number): Promise<boolean> {
  const { db, config, log } = deps
  const row = repo.getItemRow(db, itemId)
  if (!row || !repo.needsEnrichment(db, itemId)) return false

  // 1) 본문
  const content = repo.getContent(db, itemId)
  if (!content?.fullText && isExtractable(row.url, row.kind)) {
    try {
      const ex = await extractArticle(row.url)
      if (ex) {
        repo.saveContent(db, itemId, ex.paragraphs, true)
      }
    } catch (err) {
      log('info', `저장 기사 본문 추출 실패(${row.source_name}): ${(err as Error).message}`)
    }
  }
  if (!repo.getContent(db, itemId) && row.snippet) {
    repo.saveContent(db, itemId, [row.snippet], false)
  }

  // 2) 태그 (이미 사용자가 붙인 태그가 있으면 건너뜀)
  if (deps.groq && repo.getTags(db, itemId).length === 0) {
    try {
      const existing = repo
        .listTags(db)
        .slice(0, MAX_EXISTING_TAGS)
        .map((t) => t.name)
      const llm = new LlmSession(deps.groq, db, config.pricing, null)
      const user = [
        `기존 태그: ${existing.length ? existing.join(', ') : '(없음)'}`,
        '',
        `원제: ${row.title}`,
        `한국어 제목: ${row.title_ko ?? ''}`,
        `요약: ${row.summary_ko ?? row.snippet.slice(0, 600)}`
      ].join('\n')
      const ask = (role: 'triage' | 'summary') =>
        llm.json('tags', modelFor(config.models, role, false), { system: config.prompts.tags, user }, {
          name: 'tags',
          jsonSchema: TagsJsonSchema,
          zod: TagsZod
        })
      // 20B가 가끔 빈 응답을 내므로 실패하면 120B로 한 번 더
      const { tags } = await ask('triage').catch(() => ask('summary'))
      for (const t of tags.slice(0, 3)) repo.addTag(db, itemId, t, 'auto')
    } catch (err) {
      log('warn', `태그 추천 실패: ${(err as Error).message}`)
    }
  }

  repo.markEnriched(db, itemId)
  return true
}
