import { z } from 'zod'
import { modelFor, type AppConfig } from '../config'
import type { Db } from '../db/db'
import * as repo from '../db/repo'
import type { ModelSpec } from '../llm/groq'
import type { LlmSession } from '../llm/service'
import { ensureContent } from './content'

// 본문 문단별 한국어 번역 (DESIGN.md 13.5절). 문단 번호를 그대로 유지해서 [¶n] 인용·하이라이트가 원문과 번역 양쪽에 맞는다.

/** 기사 한 건에서 번역할 최대 글자 수. 보통 기사(3~6천 자)의 10배 가까이 되는 넉넉한 값이고, 넘는 문단은 원문으로 둔다 */
export const MAX_TRANSLATE_CHARS = 40_000
/** 한 번의 호출에 보내는 글자 수. 출력 상한 안에 번역이 다 들어가도록 나눈다 */
const CHUNK_CHARS = 5_000

const TranslateZod = z.object({ paragraphs: z.array(z.object({ n: z.number(), ko: z.string() })) })
const TranslateJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['paragraphs'],
  properties: {
    paragraphs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['n', 'ko'],
        properties: { n: { type: 'integer' }, ko: { type: 'string' } }
      }
    }
  }
}

/**
 * 번역할 문단을 호출 단위로 묶는다. 상한을 넘는 뒤쪽 문단은 빠진다.
 * 문단 하나가 묶음 크기보다 길면 그 문단 혼자 한 묶음이 된다.
 */
export function planChunks(paragraphs: string[], maxChars = MAX_TRANSLATE_CHARS, chunkChars = CHUNK_CHARS): number[][] {
  const chunks: number[][] = []
  let total = 0
  let cur: number[] = []
  let curLen = 0
  for (let i = 0; i < paragraphs.length; i++) {
    const len = paragraphs[i]!.length
    if (total + len > maxChars) break
    total += len
    if (cur.length > 0 && curLen + len > chunkChars) {
      chunks.push(cur)
      cur = []
      curLen = 0
    }
    cur.push(i)
    curLen += len
  }
  if (cur.length) chunks.push(cur)
  return chunks
}

/**
 * 문단 배열을 번역해 같은 길이의 배열로 돌려준다. 번역하지 않은(상한 초과·응답 누락) 문단은 null.
 * 묶음 하나라도 실패하면 예외를 던진다 (번역 없음으로 남겨 두었다가 나중에 다시 시도한다).
 */
export async function translateParagraphs(
  llm: LlmSession,
  spec: ModelSpec,
  prompt: string,
  a: { title: string; sourceName: string; paragraphs: string[] }
): Promise<(string | null)[]> {
  const out: (string | null)[] = a.paragraphs.map(() => null)
  const chunks = planChunks(a.paragraphs)
  await Promise.all(
    chunks.map(async (idx) => {
      const user = [
        `출처: ${a.sourceName}`,
        `원제: ${a.title}`,
        '',
        ...idx.map((i) => JSON.stringify({ n: i + 1, text: a.paragraphs[i] }))
      ].join('\n')
      const ask = () => llm.json('translate', spec, { system: prompt, user }, { name: 'translation', jsonSchema: TranslateJsonSchema, zod: TranslateZod })
      // 구조화 출력이 가끔 깨지므로 한 번 더 시도한다
      const r = await ask().catch(() => ask())
      const wanted = new Set(idx)
      for (const p of r.paragraphs) {
        const i = p.n - 1
        if (wanted.has(i) && p.ko.trim()) out[i] = p.ko.trim()
      }
    })
  )
  return out
}

export interface TranslateDeps {
  db: Db
  config: AppConfig
  llm: LlmSession
  saveMode: boolean
  log(level: 'info' | 'warn' | 'error', message: string): void
}

/**
 * 기사 한 건의 본문을 번역해 저장한다. 한국어 기사이거나 이미 번역했으면 아무것도 하지 않는다.
 * 번역을 새로 저장했으면 true.
 */
export async function translateItem(d: TranslateDeps, itemId: number): Promise<boolean> {
  const row = repo.getItemRow(d.db, itemId)
  if (!row || !repo.needsTranslation(row)) return false
  const content = await ensureContent(d.db, row, d.log)
  if (content.paragraphsKo || content.paragraphs.length === 0) return false
  const spec = modelFor(d.config.models, 'translate', d.saveMode)
  const ko = await translateParagraphs(d.llm, spec, d.config.prompts.translate, {
    title: row.title,
    sourceName: row.source_name,
    paragraphs: content.paragraphs
  })
  repo.saveTranslation(d.db, itemId, ko, spec.model)
  return true
}
