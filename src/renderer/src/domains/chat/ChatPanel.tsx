// ============================================================================
// AI 질문 패널
//
// [역할]
// - 대화 · 빠른 질문 버튼 · 입력란을 한 패널로 표시 (기사 질문과 브리핑 질문이 함께 사용)
// - 답변 글의 [¶n] · [#n]을 눌러볼 수 있는 인용 버튼으로 변환
// - 답변을 받는 동안 타자기 커서 표시, 대화 끝이 보이게 스크롤
// ============================================================================
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import type { ChatMessageDTO, QuickAction } from '@shared/types'
import { ErrorNotice } from '@/common/ui/Notice'
import { Button } from '@/common/ui/Button'
import { Chip } from '@/common/ui/Chip'
import { Caption } from '@/common/ui/Text'
import { cn } from '@/common/lib/cn'

const CITATION = /\[(¶|#)\s*(\d+)\]/g // 답변 글 속 인용 표시 ([¶3] · [#2] 모양)

interface Props {
    messages: ChatMessageDTO[]
    streamingAnswer: string | null
    errorMessage: string | null
    quickActions: QuickAction[]
    onAsk(question: string): void
    onClear(): void
    onCite(citationNumber: number): void // 인용 번호를 눌렀을 때 (기사 채팅: 문단 번호, 브리핑 채팅: 순위)
    citeTitle?(citationNumber: number): string // 인용 버튼에 마우스를 올렸을 때 보일 설명 (예: 기사 제목)
    onAddToMemo?(text: string): void // 있으면 답변마다 "메모에 추가" 버튼 표시
    emptyHint: ReactNode
    placeholder: string
    draft?: { text: string; key: number } | null // 입력란에 미리 채울 글 (하이라이트에서 "질문"), key가 바뀔 때마다 채우고 입력란에 초점
}

// 답변 글에서 [¶n] · [#n]을 눌러볼 수 있는 인용 버튼으로 변환
// caret: 받는 중이면 글 끝에 타자기 커서. fresh: 방금 끝난 답변이면 인용이 차례로 도장처럼 찍힘
function CitedText({
    text,
    onCite,
    citeTitle,
    caret = false,
    fresh = false
}: {
    text: string
    onCite(citationNumber: number): void
    citeTitle?(citationNumber: number): string
    caret?: boolean
    fresh?: boolean
}) {
    const textAndCitationParts: ReactNode[] = []
    let previousCitationEnd = 0
    let citationOrder = 0
    for (const citationMatch of text.matchAll(CITATION)) {
        const citationNumber = Number(citationMatch[2])
        textAndCitationParts.push(text.slice(previousCitationEnd, citationMatch.index))
        textAndCitationParts.push(
            <button
                key={`${citationMatch.index}-${citationNumber}`}
                type="button"
                onClick={() => onCite(citationNumber)}
                title={citeTitle?.(citationNumber)}
                className={cn(
                    'mx-0.5 inline-flex min-h-6 cursor-pointer items-center rounded-control border-0 bg-transparent px-1 align-baseline text-meta font-bold text-accent underline underline-offset-3 hover:bg-paper-sunken hover:text-ink',
                    fresh && 'animate-stamp'
                )}
                // 인용 순서대로 조금씩 늦게 찍힘 (실행 중에 정해지는 값)
                style={fresh ? { animationDelay: `${Math.min(citationOrder++ * 60, 600)}ms` } : undefined}
            >
                {citationMatch[1]}
                {citationNumber}
            </button>
        )
        previousCitationEnd = (citationMatch.index ?? 0) + citationMatch[0].length
    }
    textAndCitationParts.push(text.slice(previousCitationEnd))
    return (
        <p className="whitespace-pre-wrap text-reading text-ink-body">
            {textAndCitationParts}
            {caret && (
                <span aria-hidden="true" className="ml-0.5 animate-caret text-accent">
                    ▍
                </span>
            )}
        </p>
    )
}

/**
 * AI 질문 패널 (대화, 빠른 질문, 입력란)
 *
 * - 신문 Q&A처럼 질문은 명조, 답은 본문 글자
 * - ref는 질문 입력란에 연결
 *
 * @returns {JSX.Element} 질문 패널
 */
export const ChatPanel = forwardRef<HTMLTextAreaElement, Props>(function ChatPanel(props, ref) {
    // =============================== 상태 ===================================
    const [questionDraft, setQuestionDraft] = useState('') // 입력란에 쓰고 있는 질문
    const [freshMessageId, setFreshMessageId] = useState<number | null>(null) // 방금 받기를 마친 답변 (인용이 도장처럼 찍히는 움직임은 이 답변에만)

    // =============================== Ref ===================================
    const conversationEndRef = useRef<HTMLDivElement>(null) // 대화 맨 끝 자리 (스크롤 맞춤용)
    const questionInputRef = useRef<HTMLTextAreaElement>(null) // 질문 입력란
    const wasAnswering = useRef(false) // 직전 렌더에서 답변을 받는 중이었는지, 받기가 끝난 순간을 알아내는 용도

    // =============================== 계산 ===================================
    const isAnswering = props.streamingAnswer !== null // 답변을 받는 중인지
    const draftKey = props.draft?.key

    // 질문 보내기 (빈 글이거나 답변을 받는 중이면 무시)
    const submitQuestion = () => {
        if (!questionDraft.trim() || isAnswering) return
        props.onAsk(questionDraft)
        setQuestionDraft('')
    }

    // =============================== useEffect ===================================
    // 답변 받기가 끝난 순간 마지막 답변을 "방금 끝난 답변"으로 기록
    useEffect(() => {
        if (wasAnswering.current && !isAnswering) {
            const lastAssistantMessage = [...props.messages].reverse().find((chatMessage) => chatMessage.role === 'assistant')
            if (lastAssistantMessage) setFreshMessageId(lastAssistantMessage.id)
        }
        wasAnswering.current = isAnswering
    }, [isAnswering, props.messages])

    // 바깥에서 받은 ref를 질문 입력란에 연결
    useImperativeHandle(ref, () => questionInputRef.current!, [])

    // 미리 채울 글이 새로 오면 입력란에 채우고 초점 이동
    useEffect(() => {
        if (draftKey === undefined || !props.draft) return
        setQuestionDraft(props.draft.text)
        // 커서를 끝에 두어 이어서 질문을 쓰게 함
        setTimeout(() => {
            const questionInputElement = questionInputRef.current
            if (!questionInputElement) return
            questionInputElement.focus()
            questionInputElement.setSelectionRange(questionInputElement.value.length, questionInputElement.value.length)
        }, 0)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- key가 바뀔 때만 채운다
    }, [draftKey])

    // 새 답변 조각이 오면 대화 끝이 보이게 스크롤
    useEffect(() => {
        conversationEndRef.current?.scrollIntoView({ block: 'nearest' })
    }, [props.messages.length, props.streamingAnswer])

    return (
        <div className="flex flex-col gap-4">
            {/* 빈 대화 안내 */}
            {props.messages.length === 0 && !isAnswering && <Caption>{props.emptyHint}</Caption>}

            {/* 대화 */}
            <ol className="m-0 flex list-none flex-col gap-4 p-0">
                {props.messages.map((chatMessage) =>
                    chatMessage.role === 'user' ? (
                        <li key={chatMessage.id} className="border-t border-rule pt-3 font-display text-title font-semibold text-ink">
                            <span className="mr-2 text-accent">Q.</span>
                            {chatMessage.content}
                        </li>
                    ) : (
                        <li key={chatMessage.id} className="flex flex-col gap-2">
                            <CitedText
                                text={chatMessage.content}
                                onCite={props.onCite}
                                citeTitle={props.citeTitle}
                                fresh={chatMessage.id === freshMessageId}
                            />
                            {props.onAddToMemo && (
                                <div>
                                    <Button variant="text" onClick={() => props.onAddToMemo?.(chatMessage.content)}>
                                        메모에 추가
                                    </Button>
                                </div>
                            )}
                        </li>
                    )
                )}
                {isAnswering && (
                    <li className="flex flex-col gap-1">
                        <CitedText text={props.streamingAnswer ?? ''} onCite={props.onCite} citeTitle={props.citeTitle} caret />
                        {!props.streamingAnswer && <Caption>답하는 중…</Caption>}
                    </li>
                )}
            </ol>
            <div ref={conversationEndRef} />

            {/* 오류 안내 */}
            {props.errorMessage && <ErrorNotice>{props.errorMessage}</ErrorNotice>}

            {/* 빠른 질문 */}
            {props.quickActions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {props.quickActions.map((quickAction) => (
                        <Chip
                            key={quickAction.label}
                            disabled={isAnswering}
                            onClick={() => props.onAsk(quickAction.prompt)}
                            title={quickAction.prompt}
                        >
                            {quickAction.label}
                        </Chip>
                    ))}
                </div>
            )}

            {/* 질문 입력 */}
            <form
                className="flex flex-col gap-2"
                onSubmit={(submitEvent) => {
                    submitEvent.preventDefault()
                    submitQuestion()
                }}
            >
                <label className="sr-only" htmlFor="chat-input">
                    질문
                </label>
                <textarea
                    ref={questionInputRef}
                    id="chat-input"
                    rows={3}
                    value={questionDraft}
                    placeholder={props.placeholder}
                    onChange={(changeEvent) => setQuestionDraft(changeEvent.target.value)}
                    onKeyDown={(keyboardEvent) => {
                        // Enter로 보내고, Shift+Enter는 줄바꿈 (한글 조합 중에는 보내지 않음)
                        if (keyboardEvent.key === 'Enter' && !keyboardEvent.shiftKey && !keyboardEvent.nativeEvent.isComposing) {
                            keyboardEvent.preventDefault()
                            submitQuestion()
                        }
                    }}
                    className="w-full resize-y rounded-control border border-rule bg-paper-input px-3 py-2 text-ink-body placeholder:text-ink-faint focus:border-ink"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <Caption>Enter 보내기 · Shift+Enter 줄바꿈</Caption>
                    <div className="flex items-center gap-3">
                        {props.messages.length > 0 && (
                            <Button variant="text" disabled={isAnswering} onClick={props.onClear}>
                                대화 지우기
                            </Button>
                        )}
                        <Button type="submit" variant="solid" icon="chat" disabled={isAnswering || !questionDraft.trim()}>
                            질문하기
                        </Button>
                    </div>
                </div>
            </form>
        </div>
    )
})
