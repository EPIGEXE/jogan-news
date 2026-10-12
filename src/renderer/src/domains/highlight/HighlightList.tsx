// ============================================================================
// 하이라이트 목록
//
// [역할]
// - 읽기 화면의 "하이라이트" 탭에 그은 문장을 본문 순서대로 모아 표시
// - 하이라이트마다 본문에서 보기 · 메모 · 이 부분 질문 · 지우기
// - 본문에서 하이라이트를 눌러 들어오면 그 항목을 강조하고 보이게 스크롤
// ============================================================================
import { useEffect, useState } from 'react'
import type { HighlightDTO } from '@shared/types'
import { cn } from '@/common/lib/cn'
import { Button } from '@/common/ui/Button'
import { HelpText } from '@/common/ui/Text'

interface Props {
    highlights: HighlightDTO[]
    activeHighlightId: number | null // 본문에서 하이라이트를 눌러 들어왔을 때 강조할 항목
    onGoTo(highlight: HighlightDTO): void
    onAsk(highlight: HighlightDTO): void
    onSaveNote(highlightId: number, note: string): void
    onRemove(highlightId: number): void
}

// 하이라이트 메모 한 줄 (입력을 마치고 나가면(blur) 저장)
function NoteInput({ highlight, onSave }: { highlight: HighlightDTO; onSave(note: string): void }) {
    const [noteDraft, setNoteDraft] = useState(highlight.note) // 입력란에 쓰고 있는 메모

    // 저장된 메모가 바뀌면 입력란도 그 값으로 맞춤
    useEffect(() => setNoteDraft(highlight.note), [highlight.note])

    return (
        <>
            <label className="sr-only" htmlFor={`hl-note-${highlight.id}`}>
                하이라이트 메모
            </label>
            <textarea
                id={`hl-note-${highlight.id}`}
                rows={noteDraft ? 2 : 1}
                value={noteDraft}
                placeholder="메모 덧붙이기"
                onChange={(changeEvent) => setNoteDraft(changeEvent.target.value)}
                onBlur={() => noteDraft !== highlight.note && onSave(noteDraft)}
                className="w-full resize-y rounded-control border border-rule bg-paper-input px-2 py-1 text-body text-ink-body placeholder:text-ink-faint focus:border-ink"
            />
        </>
    )
}

/**
 * 읽기 화면의 "하이라이트" 탭 (그은 문장을 본문 순서대로 모아 표시)
 *
 * @returns {JSX.Element} 하이라이트 목록 (하나도 없으면 안내 글)
 */
export function HighlightList({ highlights, activeHighlightId, onGoTo, onAsk, onSaveNote, onRemove }: Props) {
    // 강조할 항목이 정해지면 그 항목이 보이게 스크롤
    useEffect(() => {
        if (activeHighlightId !== null) document.getElementById(`hl-${activeHighlightId}`)?.scrollIntoView({ block: 'nearest' })
    }, [activeHighlightId])

    if (highlights.length === 0) {
        return (
            <HelpText>
                본문에서 문장을 드래그한 뒤 "하이라이트"(H)를 누르면 여기에 모입니다. 하이라이트를 그은 기사는 자동으로 저장됩니다.
            </HelpText>
        )
    }

    return (
        <ol className="m-0 flex list-none flex-col gap-5 p-0">
            {highlights.map((highlight) => (
                <li
                    key={highlight.id}
                    id={`hl-${highlight.id}`}
                    className={cn(
                        '-mx-2 flex flex-col gap-2 px-2 py-2 transition-colors duration-120',
                        activeHighlightId === highlight.id && 'bg-paper-sunken'
                    )}
                >
                    {/* 그은 문장 (누르면 본문에서 보기) */}
                    <button
                        type="button"
                        onClick={() => onGoTo(highlight)}
                        title="본문에서 보기"
                        className="cursor-pointer border-0 border-l-3 border-highlight bg-transparent py-0.5 pr-0 pl-3 text-left text-reading text-ink-body hover:text-ink"
                    >
                        <span className="mr-2 font-display text-caption text-ink-faint">
                            ¶{highlight.paragraph}
                            {highlight.variant === 'original' ? ' 원문' : ''}
                        </span>
                        {highlight.text}
                    </button>

                    {/* 메모 */}
                    <NoteInput highlight={highlight} onSave={(note) => onSaveNote(highlight.id, note)} />

                    {/* 동작 버튼 */}
                    <div className="flex gap-4">
                        <Button variant="text" onClick={() => onAsk(highlight)}>
                            이 부분 질문
                        </Button>
                        <Button variant="text" onClick={() => onRemove(highlight.id)}>
                            지우기
                        </Button>
                    </div>
                </li>
            ))}
        </ol>
    )
}
