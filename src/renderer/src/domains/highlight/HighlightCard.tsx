// ============================================================================
// 하이라이트 카드
//
// [역할]
// - 본문의 하이라이트에 마우스를 올리면 뜨는 작은 종이 카드
// - 메모 보기 · 고치기, 이 부분 질문, 지우기 (하이라이트 탭에 가지 않고 본문에서 바로 처리)
// - 하이라이트 위(자리가 없으면 아래)에 창 밖으로 나가지 않게 배치
// ============================================================================
import { useEffect, useState } from 'react'
import type { HighlightDTO } from '@shared/types'
import { Button } from '@/common/ui/Button'

interface Props {
    highlight: HighlightDTO
    anchorRect: DOMRect // 하이라이트(<mark>)의 화면 위치, 카드는 그 위(자리가 없으면 아래)에 표시
    onSaveNote(note: string): void
    onAsk(): void
    onRemove(): void
    onPointerEnter(): void // 카드 위에 마우스가 있는 동안 닫히지 않게 하는 용도
    onPointerLeave(): void
}

const CARD_WIDTH = 288 // 카드 너비 (px)
const CARD_GAP = 8 // 하이라이트 · 창 가장자리와 카드 사이 간격 (px)

/**
 * 본문의 하이라이트에 마우스를 올리면 뜨는 작은 종이 카드
 *
 * - 메모 보기 · 고치기, 이 부분 질문, 지우기
 * - 하이라이트 탭에 가지 않아도 본문에서 바로 다루기 위한 것
 *
 * @returns {JSX.Element} 하이라이트 근처에 뜨는 카드
 */
export function HighlightCard({ highlight, anchorRect, onSaveNote, onAsk, onRemove, onPointerEnter, onPointerLeave }: Props) {
    // =============================== 상태 ===================================
    const [isEditingNote, setIsEditingNote] = useState(false) // 메모를 고치는 중인지
    const [noteDraft, setNoteDraft] = useState(highlight.note) // 입력란에 쓰고 있는 메모

    // =============================== 계산 ===================================
    // 창 안에 들어오게 배치: 가로는 하이라이트 가운데 기준, 위에 자리가 없으면 아래
    const left = Math.max(
        CARD_GAP,
        Math.min(window.innerWidth - CARD_WIDTH - CARD_GAP, anchorRect.left + anchorRect.width / 2 - CARD_WIDTH / 2)
    )
    const hasRoomAbove = anchorRect.top > 180
    const cardPosition = hasRoomAbove
        ? { left, bottom: window.innerHeight - anchorRect.top + CARD_GAP }
        : { left, top: anchorRect.bottom + CARD_GAP }

    // 고치기를 끝내고, 메모가 바뀌었을 때만 저장
    const saveNoteDraft = () => {
        setIsEditingNote(false)
        if (noteDraft !== highlight.note) onSaveNote(noteDraft.trim())
    }

    // =============================== useEffect ===================================
    // 다른 하이라이트로 바뀌거나 저장된 메모가 바뀌면 입력란을 그 메모로 되돌리고 고치기 종료
    useEffect(() => {
        setNoteDraft(highlight.note)
        setIsEditingNote(false)
    }, [highlight.id, highlight.note])

    return (
        <div
            role="dialog"
            aria-label="하이라이트"
            onPointerEnter={onPointerEnter}
            onPointerLeave={onPointerLeave}
            className="fixed z-20 flex w-72 animate-paper-drop flex-col gap-2 rounded-control border border-rule-strong bg-paper-raised p-3"
            // 위치는 하이라이트 자리에 따라 실행 중에 정해지는 값이라 인라인 style로 지정
            style={cardPosition}
        >
            {/* 문단 번호 */}
            <span className="font-display text-caption font-bold tracking-label text-accent">
                ¶{highlight.paragraph} 하이라이트{highlight.variant === 'original' ? ' · 원문' : ''}
            </span>

            {/* 메모 (고치는 중이면 입력란) */}
            {isEditingNote ? (
                <>
                    <label htmlFor={`hl-card-${highlight.id}`} className="sr-only">
                        하이라이트 메모
                    </label>
                    <textarea
                        id={`hl-card-${highlight.id}`}
                        autoFocus
                        rows={3}
                        value={noteDraft}
                        placeholder="메모 덧붙이기"
                        onChange={(changeEvent) => setNoteDraft(changeEvent.target.value)}
                        onBlur={saveNoteDraft}
                        onKeyDown={(keyboardEvent) => {
                            // Enter로 저장, Shift+Enter 줄바꿈, Esc 취소 (한글 조합 중에는 저장하지 않음)
                            if (keyboardEvent.key === 'Enter' && !keyboardEvent.shiftKey && !keyboardEvent.nativeEvent.isComposing) {
                                keyboardEvent.preventDefault()
                                saveNoteDraft()
                            } else if (keyboardEvent.key === 'Escape') {
                                keyboardEvent.stopPropagation()
                                setNoteDraft(highlight.note)
                                setIsEditingNote(false)
                            }
                        }}
                        className="w-full resize-y rounded-control border border-rule bg-paper-input px-2 py-1 text-body text-ink-body placeholder:text-ink-faint focus:border-ink"
                    />
                </>
            ) : highlight.note ? (
                <p className="whitespace-pre-wrap text-body text-ink-body">{highlight.note}</p>
            ) : (
                <p className="text-meta text-ink-muted">메모 없음</p>
            )}

            {/* 동작 버튼 */}
            <div className="flex flex-wrap gap-x-4 border-t border-rule-soft pt-2">
                {!isEditingNote && (
                    <Button variant="text" onClick={() => setIsEditingNote(true)}>
                        {highlight.note ? '메모 고치기' : '메모 쓰기'}
                    </Button>
                )}
                <Button variant="text" onClick={onAsk}>
                    이 부분 질문
                </Button>
                <Button variant="text" onClick={onRemove}>
                    지우기
                </Button>
            </div>
        </div>
    )
}
