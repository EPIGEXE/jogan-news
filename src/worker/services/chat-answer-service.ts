// ============================================================================
// 질문 답변 서비스
//
// [역할]
// - 기사 한 건 또는 그날 브리핑을 근거로 질문에 답하고, 답변에 인용 번호를 붙임 (DESIGN.md 6.4절)
// - 기사 채팅: 본문 문단마다 [¶번호]를 붙여 넘김 (본문이 36,000자를 넘으면 질문과 관련 있는 문단만)
// - 브리핑 채팅: 그날 실린 기사마다 [#순위]와 제목 · 분류 · 출처 · 요약 · 왜 중요한가를 넘김
// - 이전 대화는 Main이 넘긴 것 중 최근 20개(질문 · 답 10턴)까지만 함께 넘김
// - 답변은 스트리밍으로 받아 조각마다 알리고, 끝나면 근거에 실제로 있는 인용 번호만 남겨 돌려줌
// - 이번 달 사용액이 월 예산 이상이면 절약 모드 모델로 답함
// - 질문 · 답변을 저장하지 않음 (대화 저장은 Main)
// - 질문이 비었거나, API 키가 없거나, 근거로 쓸 기사 · 브리핑이 없거나, 답변 생성에 실패하면 오류
// ============================================================================
import { modelSpecForRole, type AppConfig } from '@config/index'
import { summarizeUsage } from '@domain/usage'
import type { DigestRepository } from '@data/repositories/digest-repository'
import type { ItemRepository } from '@data/repositories/item-repository'
import type { LlmUsageRepository } from '@data/repositories/llm-usage-repository'
import type { SettingsRepository } from '@data/repositories/settings-repository'
import { CATEGORY_LABEL, type ChatMessageDTO, type ChatScope } from '@shared/types'
import { cleanCitations, selectParagraphs, type CitationKind } from '../knowledge/citations'
import type { ChatTurn } from '../llm/groq'
import type { LlmSessionSource } from '../llm/service'
import type { WorkerLog } from '../log'

const MAX_ARTICLE_CHARS = 36_000 // 기사 본문 입력 상한 (글자 수). DESIGN.md 7.5절 ②의 약 12,000토큰
const MAX_HISTORY_MESSAGES = 20 // 함께 넘기는 이전 대화 수 (최근 10턴 = 질문 + 답 20개)
const EMPTY_ANSWER_NOTICE = '답변을 만들지 못했습니다. 다시 질문해 주세요.' // 답변이 비었을 때 대신 돌려주는 안내 문구

// 질문에 붙여 보내는 근거
interface ChatContext {
    system: string // 시스템 메시지 (프롬프트 규칙 + 근거 자료)
    citationKind: CitationKind // 답변이 쓸 인용 표시의 종류
    validNumbers: Set<number> // 근거로 넘긴 번호 (답변의 인용이 실제로 있는 번호인지 확인용)
}

// 답변을 만들어 달라는 요청
export interface AnswerRequest {
    requestId: string // 이 질문의 요청 번호 (답변 조각 알림에 붙여 보냄)
    scope: ChatScope // 질문 범위 (기사 한 건 또는 그날 브리핑)
    question: string // 사용자 질문
    history: ChatMessageDTO[] // 이 질문 이전의 대화 (오래된 것부터)
}

// 완성된 답변
export interface ChatAnswer {
    content: string // 근거에 있는 인용 번호만 남긴 답변 (비었으면 안내 문구)
    citations: number[] // 실제로 인용한 번호
    model: string // 답한 모델
}

export interface ChatAnswerDeps {
    itemRepository: ItemRepository // 기사 채팅의 근거(기사 상세) 읽기
    digestRepository: DigestRepository // 브리핑 채팅의 근거(그날 브리핑) 읽기
    llmUsageRepository: LlmUsageRepository // 이번 달 사용액 확인 (절약 모드 판정)
    settingsRepository: SettingsRepository // 월 예산 읽기
    llmSessions: LlmSessionSource // 답변에 쓸 LLM 세션 (API 키가 없으면 오류)
    config: AppConfig // 프롬프트 · 모델 설정
    onChatDelta(requestId: string, deltaText: string): void // 답변 조각이 올 때마다 알림
    log: WorkerLog // 로그 남기기
}

/**
 * 질문에 대한 답변을 만드는 서비스
 */
export class ChatAnswerService {
    constructor(private readonly deps: ChatAnswerDeps) {}

    /**
     * 답변 생성
     *
     * - 만드는 동안 조각을 onChatDelta로 알리고, 끝나면 인용을 정리한 답변을 돌려줌
     * - 질문 · 답변을 저장하지 않음
     *
     * @param {AnswerRequest} answerRequest - 요청 번호 · 질문 범위 · 질문 · 이전 대화
     * @returns {Promise<ChatAnswer>} 정리한 답변 · 인용 번호 · 답한 모델
     * @throws 질문이 비었거나, API 키가 없거나, 기사 · 브리핑이 없거나, 답변 생성에 실패하면 오류
     */
    async answerQuestion({ requestId, scope, question, history }: AnswerRequest): Promise<ChatAnswer> {
        const { llmUsageRepository, settingsRepository, llmSessions, config, log } = this.deps

        // 빈 질문과 API 키가 없는 경우는 받지 않음
        // 브리핑 실행 밖의 호출이라 실행 번호 없이 사용량만 기록
        const trimmedQuestion = question.trim()
        if (!trimmedQuestion) throw new Error('질문을 입력하세요.')
        const llmSession = llmSessions.openSession(null)
        if (!llmSession) throw new Error('Groq API 키가 없습니다. 설정에서 키를 입력하세요.')

        // 근거 만들기 (기사 · 브리핑이 없으면 여기서 실패)
        const chatContext = scope.kind === 'item' ? this.articleContext(scope.itemId, trimmedQuestion) : this.digestContext(scope.date)

        // 보낼 메시지 조립: 규칙 + 근거 → 이전 대화(최근 20개) → 새 질문
        // 고정된 내용(규칙 + 근거)을 앞에 두면 같은 기사로 이어서 물을 때 Groq 자동 캐싱이 적용됨
        const recentMessages = history.slice(-MAX_HISTORY_MESSAGES)
        const chatTurns: ChatTurn[] = [
            { role: 'system', content: chatContext.system },
            ...recentMessages.map((chatMessage) => ({ role: chatMessage.role, content: chatMessage.content })),
            { role: 'user', content: trimmedQuestion }
        ]

        // 모델 결정: 이번 달 사용액이 월 예산 이상이면 절약 모드 모델
        const modelSpec = modelSpecForRole(config.models, 'chat', summarizeUsage(llmUsageRepository, settingsRepository).saveMode)

        try {
            // 답변을 스트리밍으로 받으며 조각이 올 때마다 알림
            const rawAnswer = await llmSession.streamAnswer('chat', modelSpec, chatTurns, (deltaText) =>
                this.deps.onChatDelta(requestId, deltaText)
            )

            // 답변 완료 → 근거에 있는 인용 번호만 남김 (답변이 비었으면 안내 문구)
            const { content, citations } = cleanCitations(rawAnswer, chatContext.citationKind, chatContext.validNumbers)
            return { content: content || EMPTY_ANSWER_NOTICE, citations, model: modelSpec.model }
        } catch (answerError) {
            // 답변 실패 → 기록하고 부른 쪽이 알 수 있게 다시 던짐
            log('warn', `질문 답변 실패: ${(answerError as Error).message}`)
            throw answerError
        }
    }

    // 기사 채팅의 근거 생성: 문단마다 [¶번호]를 붙인 본문 (길면 질문과 관련 있는 문단만)
    private articleContext(itemId: number, question: string): ChatContext {
        // 기사가 없으면 실패
        const itemDetail = this.deps.itemRepository.findItemDetail(itemId)?.itemDetail
        if (!itemDetail) throw new Error('기사를 찾을 수 없습니다.')

        // 넘길 문단 고르기 (상한 안이면 전부, 넘으면 앞 3문단 + 질문과 낱말이 겹치는 문단)
        // 번호는 원래 문단 번호를 유지하므로 화면의 ¶ 번호와 같음
        const selectedParagraphs = selectParagraphs(itemDetail.paragraphs, question, MAX_ARTICLE_CHARS)
        const numberedBody = selectedParagraphs
            .map((numberedParagraph) => `[¶${numberedParagraph.n}] ${numberedParagraph.text}`)
            .join('\n\n')

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
            system: `${this.deps.config.prompts.chatItem}\n\n--- 기사 ---\n${articleHeader}\n\n${numberedBody}`,
            citationKind: 'paragraph',
            validNumbers: new Set(selectedParagraphs.map((numberedParagraph) => numberedParagraph.n)) // 실제로 넘긴 문단의 번호만 인정
        }
    }

    // 브리핑 채팅의 근거 생성: 그날 실린 기사들의 [#순위] 제목 · 요약 · 왜 중요한가
    private digestContext(digestDate: string): ChatContext {
        // 그날 브리핑이 없으면 실패
        const digest = this.deps.digestRepository.findDigestByDate(digestDate)
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
            system: `${this.deps.config.prompts.chatDigest}\n\n--- ${digestDate} 브리핑: ${digest.headline} ---\n${entryBlocks.join('\n\n')}`,
            citationKind: 'digest',
            validNumbers: new Set(digest.entries.map((entry) => entry.rank)) // 그날 실린 기사의 순위만 인정
        }
    }
}
