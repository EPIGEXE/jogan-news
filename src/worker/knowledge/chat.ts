// ============================================================================
// AI 질문
//
// [역할]
// - 기사 한 건 또는 그날 브리핑을 근거로 질문에 답하고, 답변에 인용 번호를 붙임 (DESIGN.md 6.4절)
// - 기사 채팅: 본문 문단마다 [¶번호]를 붙여 넘김 (본문이 36,000자를 넘으면 질문과 관련 있는 문단만)
// - 브리핑 채팅: 그날 실린 기사마다 [#순위]와 제목 · 분류 · 출처 · 요약 · 왜 중요한가를 넘김
// - 질문은 저장하고 바로 돌려줌. 답변은 뒤에서 스트리밍으로 받아 조각마다 화면에 전달
// - 답변이 끝나면 근거에 실제로 있는 인용 번호만 남겨 저장
// - 이전 대화는 최근 20개(질문 · 답 10턴)까지만 함께 넘김
// - 이번 달 사용액이 월 예산 이상이면 절약 모드 모델로 답함
// - 답변에 실패하면 오류 알림만 보냄 (저장한 질문은 남김)
// ============================================================================
import type Groq from 'groq-sdk'
import { CATEGORY_LABEL, type ChatEvent, type ChatMessageDTO, type ChatScope } from '@shared/types'
import { modelSpecForRole, type AppConfig } from '../config'
import type { Db } from '../db/db'
import * as repo from '../db/repo'
import type { ChatTurn } from '../llm/groq'
import { LlmSession } from '../llm/service'
import { cleanCitations, selectParagraphs, type CitationKind } from './citations'

const MAX_ARTICLE_CHARS = 36_000 // 기사 본문 입력 상한 (글자 수). DESIGN.md 7.5절 ②의 약 12,000토큰
const MAX_HISTORY_MESSAGES = 20 // 함께 넘기는 이전 대화 수 (최근 10턴 = 질문 + 답 20개)

export interface ChatDeps {
    db: Db // DB 연결
    config: AppConfig // 프롬프트 · 모델 · 단가 설정
    groq: Groq | null // Groq 클라이언트 (API 키가 없으면 null)
    emit(event: ChatEvent): void // 답변 조각 · 완료 · 오류를 화면 쪽으로 전달
    log(level: 'info' | 'warn' | 'error', message: string): void // 진단 기록
}

// 질문에 붙여 보내는 근거
interface ChatContext {
    system: string // 시스템 메시지 (프롬프트 규칙 + 근거 자료)
    kind: CitationKind // 답변이 쓸 인용 표시의 종류
    valid: Set<number> // 근거로 넘긴 번호 (답변의 인용이 실제로 있는 번호인지 확인용)
}

// 기사 채팅의 근거 생성: 문단마다 [¶번호]를 붙인 본문 (길면 질문과 관련 있는 문단만)
function articleContext(deps: ChatDeps, itemId: number, question: string): ChatContext {
    // 기사가 없으면 실패
    const itemDetail = repo.getItemDetail(deps.db, itemId)
    if (!itemDetail) throw new Error('기사를 찾을 수 없습니다.')

    // 넘길 문단 고르기 (상한 안이면 전부, 넘으면 앞 3문단 + 질문과 낱말이 겹치는 문단)
    // 번호는 원래 문단 번호를 유지하므로 화면의 ¶ 번호와 같음
    const selectedParagraphs = selectParagraphs(itemDetail.paragraphs, question, MAX_ARTICLE_CHARS)
    const numberedBody = selectedParagraphs.map((numberedParagraph) => `[¶${numberedParagraph.n}] ${numberedParagraph.text}`).join('\n\n')

    // 본문 앞에 붙이는 기사 정보
    // 원문 본문을 가져오지 못한 기사는 그 사실을 한 줄로 알림
    const articleHeader = [
        `원제: ${itemDetail.originalTitle}`,
        `한국어 제목: ${itemDetail.titleKo}`,
        `출처: ${itemDetail.sourceName}`,
        itemDetail.hasFullText ? '' : '(원문 본문을 가져오지 못해 요약·초록만 있음)'
    ]
        .filter(Boolean)
        .join('\n')

    return {
        system: `${deps.config.prompts.chatItem}\n\n--- 기사 ---\n${articleHeader}\n\n${numberedBody}`,
        kind: 'paragraph',
        valid: new Set(selectedParagraphs.map((numberedParagraph) => numberedParagraph.n)) // 실제로 넘긴 문단의 번호만 인정
    }
}

// 브리핑 채팅의 근거 생성: 그날 실린 기사들의 [#순위] 제목 · 요약 · 왜 중요한가
function digestContext(deps: ChatDeps, date: string): ChatContext {
    // 그날 브리핑이 없으면 실패
    const digest = repo.getDigestByDate(deps.db, date)
    if (!digest) throw new Error('그날 브리핑이 없습니다.')

    // 기사마다 한 덩어리: [#순위] 한국어 제목 (분류, 출처) / 요약 / 왜 중요한가(있을 때만)
    const entryBlocks = digest.entries.map((entry) =>
        [
            `[#${entry.rank}] ${entry.titleKo} (${CATEGORY_LABEL[entry.category]}, ${entry.sourceName})`,
            `  ${entry.summaryKo}`,
            entry.whyItMatters ? `  왜 중요한가: ${entry.whyItMatters}` : ''
        ]
            .filter(Boolean)
            .join('\n')
    )

    return {
        system: `${deps.config.prompts.chatDigest}\n\n--- ${date} 브리핑: ${digest.headline} ---\n${entryBlocks.join('\n\n')}`,
        kind: 'digest',
        valid: new Set(digest.entries.map((entry) => entry.rank)) // 그날 실린 기사의 순위만 인정
    }
}

/**
 * 질문 접수와 답변 생성
 * - 질문을 저장하고 바로 돌려줌 (답변을 기다리지 않음)
 * - 답변은 뒤에서 스트리밍으로 받아 조각마다 'delta'로 전달
 * - 끝나면 인용을 정리해 저장한 뒤 'done' 전달, 실패하면 'error' 전달 (질문은 남김)
 *
 * @param {ChatDeps} deps - DB · 설정 · Groq 클라이언트 · 알림 · 기록
 * @param {string} requestId - 이 질문의 요청 번호 (화면이 자기 질문의 답변 조각을 가려내는 데 씀)
 * @param {ChatScope} scope - 질문 범위 (기사 한 건 또는 그날 브리핑)
 * @param {string} question - 사용자 질문
 * @returns {ChatMessageDTO} 저장한 질문 메시지
 * @throws 질문이 비었거나, API 키가 없거나, 기사 · 브리핑이 없으면 오류 (질문을 저장하지 않음)
 */
export function askQuestion(deps: ChatDeps, requestId: string, scope: ChatScope, question: string): ChatMessageDTO {
    // 빈 질문과 API 키가 없는 경우는 받지 않음
    const trimmedQuestion = question.trim()
    if (!trimmedQuestion) throw new Error('질문을 입력하세요.')
    if (!deps.groq) throw new Error('Groq API 키가 없습니다. 설정에서 키를 입력하세요.')
    const groq = deps.groq

    // 근거를 먼저 만들어서, 기사 · 브리핑이 없으면 질문을 저장하기 전에 실패시킴
    const chatContext = scope.kind === 'item' ? articleContext(deps, scope.itemId, trimmedQuestion) : digestContext(deps, scope.date)

    // 이전 대화(최근 20개)를 읽은 뒤 이번 질문 저장
    // 저장 전에 읽으므로 이번 질문은 이전 대화에 들어가지 않음
    const recentMessages = repo.listChatMessages(deps.db, scope).slice(-MAX_HISTORY_MESSAGES)
    const userMessage = repo.addChatMessage(deps.db, scope, { role: 'user', content: trimmedQuestion })

    // 보낼 메시지 조립: 규칙 + 근거 → 이전 대화 → 새 질문
    // 고정된 내용(규칙 + 근거)을 앞에 두면 같은 기사로 이어서 물을 때 Groq 자동 캐싱이 적용됨
    const chatTurns: ChatTurn[] = [
        { role: 'system', content: chatContext.system },
        ...recentMessages.map((chatMessage) => ({ role: chatMessage.role, content: chatMessage.content })),
        { role: 'user', content: trimmedQuestion }
    ]

    // 모델 결정: 이번 달 1일부터 쓴 금액이 월 예산 이상이면 절약 모드 모델
    const settings = repo.getSettings(deps.db)
    const now = new Date()
    const monthCostUsd = repo.sumCostSince(deps.db, new Date(now.getFullYear(), now.getMonth(), 1).toISOString()) // 이번 달 사용액 (달러)
    const modelSpec = modelSpecForRole(deps.config.models, 'chat', monthCostUsd >= settings.budgetUsd)
    const llmSession = new LlmSession(groq, deps.db, deps.config.pricing, null) // 브리핑 실행 밖의 호출이라 실행 번호 없이 사용량만 기록

    // 답변 생성은 기다리지 않고 뒤에서 진행 (조각이 올 때마다 화면에 전달)
    void llmSession
        .streamAnswer('chat', modelSpec, chatTurns, (deltaText) => deps.emit({ type: 'delta', requestId, text: deltaText }))
        .then((rawAnswer) => {
            // 답변 완료 → 근거에 있는 인용 번호만 남기고 저장
            const { content, citations } = cleanCitations(rawAnswer, chatContext.kind, chatContext.valid)
            const assistantMessage = repo.addChatMessage(deps.db, scope, {
                role: 'assistant',
                content: content || '답변을 만들지 못했습니다. 다시 질문해 주세요.', // 답변이 비었으면 안내 문구를 대신 저장
                citations,
                model: modelSpec.model
            })
            deps.emit({ type: 'done', requestId, message: assistantMessage })
        })
        .catch((answerError: unknown) => {
            // 답변 실패 → 기록하고 화면에 오류 전달 (저장한 질문은 그대로 둠)
            deps.log('warn', `질문 답변 실패: ${(answerError as Error).message}`)
            deps.emit({ type: 'error', requestId, message: (answerError as Error).message })
        })

    return userMessage
}
