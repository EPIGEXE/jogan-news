import type Groq from 'groq-sdk'
import { CATEGORY_LABEL, type ChatEvent, type ChatMessageDTO, type ChatScope } from '@shared/types'
import { modelFor, type AppConfig } from '../config'
import type { Db } from '../db/db'
import * as repo from '../db/repo'
import type { ChatTurn } from '../llm/groq'
import { LlmSession } from '../llm/service'
import { cleanCitations, selectParagraphs, type CitationKind } from './citations'

// AI 질문 (DESIGN.md 6.4절): 기사 한 건 또는 그날 브리핑을 근거로 답하고, 답변에 인용 번호를 붙인다.

/** 기사 본문 입력 상한 (DESIGN.md 7.5절 ②: 약 12,000토큰) */
const MAX_ARTICLE_CHARS = 36_000
/** 이전 대화는 최근 10턴(질문+답 20개)까지만 넘긴다 */
const MAX_HISTORY_MESSAGES = 20

export interface ChatDeps {
  db: Db
  config: AppConfig
  groq: Groq | null
  emit(event: ChatEvent): void
  log(level: 'info' | 'warn' | 'error', message: string): void
}

interface Context {
  system: string
  kind: CitationKind
  valid: Set<number>
}

/** 기사 채팅의 근거: 문단마다 [¶번호]를 붙인 본문 (길면 질문과 관련 있는 문단만) */
function articleContext(deps: ChatDeps, itemId: number, question: string): Context {
  const item = repo.getItemDetail(deps.db, itemId)
  if (!item) throw new Error('기사를 찾을 수 없습니다.')
  const paragraphs = selectParagraphs(item.paragraphs, question, MAX_ARTICLE_CHARS)
  const body = paragraphs.map((p) => `[¶${p.n}] ${p.text}`).join('\n\n')
  const header = [
    `원제: ${item.originalTitle}`,
    `한국어 제목: ${item.titleKo}`,
    `출처: ${item.sourceName}`,
    item.fullText ? '' : '(원문 본문을 가져오지 못해 요약·초록만 있음)'
  ]
    .filter(Boolean)
    .join('\n')
  return {
    system: `${deps.config.prompts.chatItem}\n\n--- 기사 ---\n${header}\n\n${body}`,
    kind: 'paragraph',
    valid: new Set(paragraphs.map((p) => p.n))
  }
}

/** 브리핑 채팅의 근거: 그날 실린 기사들의 [#순위] 제목·요약·왜 중요한가 */
function digestContext(deps: ChatDeps, date: string): Context {
  const digest = repo.getDigestByDate(deps.db, date)
  if (!digest) throw new Error('그날 브리핑이 없습니다.')
  const lines = digest.entries.map((e) =>
    [
      `[#${e.rank}] ${e.titleKo} (${CATEGORY_LABEL[e.category]}, ${e.sourceName})`,
      `  ${e.summaryKo}`,
      e.whyItMatters ? `  왜 중요한가: ${e.whyItMatters}` : ''
    ]
      .filter(Boolean)
      .join('\n')
  )
  return {
    system: `${deps.config.prompts.chatDigest}\n\n--- ${date} 브리핑: ${digest.headline} ---\n${lines.join('\n\n')}`,
    kind: 'digest',
    valid: new Set(digest.entries.map((e) => e.rank))
  }
}

/**
 * 질문을 저장하고 바로 돌려준다. 답변은 뒤에서 스트리밍으로 받아 emit으로 흘려보내고,
 * 끝나면 인용을 정리해 저장한 뒤 'done'을 보낸다. 실패하면 'error'를 보낸다 (질문은 남긴다).
 */
export function askQuestion(deps: ChatDeps, requestId: string, scope: ChatScope, question: string): ChatMessageDTO {
  const q = question.trim()
  if (!q) throw new Error('질문을 입력하세요.')
  if (!deps.groq) throw new Error('Groq API 키가 없습니다. 설정에서 키를 입력하세요.')
  const groq = deps.groq

  // 근거를 먼저 만들어서, 기사·브리핑이 없으면 질문을 저장하기 전에 실패시킨다
  const ctx = scope.kind === 'item' ? articleContext(deps, scope.itemId, q) : digestContext(deps, scope.date)
  const history = repo.listChatMessages(deps.db, scope).slice(-MAX_HISTORY_MESSAGES)
  const userMessage = repo.addChatMessage(deps.db, scope, { role: 'user', content: q })

  // 고정된 내용(규칙 + 근거)을 앞에 두면 같은 기사로 이어서 물을 때 Groq 자동 캐싱이 적용된다
  const messages: ChatTurn[] = [
    { role: 'system', content: ctx.system },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: q }
  ]

  const settings = repo.getSettings(deps.db)
  const now = new Date()
  const monthUsd = repo.costSince(deps.db, new Date(now.getFullYear(), now.getMonth(), 1).toISOString())
  const spec = modelFor(deps.config.models, 'chat', monthUsd >= settings.budgetUsd)
  const llm = new LlmSession(groq, deps.db, deps.config.pricing, null)

  void llm
    .stream('chat', spec, messages, (text) => deps.emit({ type: 'delta', requestId, text }))
    .then((answer) => {
      const { content, citations } = cleanCitations(answer, ctx.kind, ctx.valid)
      const message = repo.addChatMessage(deps.db, scope, {
        role: 'assistant',
        content: content || '답변을 만들지 못했습니다. 다시 질문해 주세요.',
        citations,
        model: spec.model
      })
      deps.emit({ type: 'done', requestId, message })
    })
    .catch((err: unknown) => {
      deps.log('warn', `질문 답변 실패: ${(err as Error).message}`)
      deps.emit({ type: 'error', requestId, message: (err as Error).message })
    })

  return userMessage
}
