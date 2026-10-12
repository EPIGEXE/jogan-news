// ============================================================================
// 기사 본문
//
// [역할]
// - 읽기 화면의 본문을 문단 번호(¶)와 함께 표시 (번호는 하이라이트와 AI 답변 인용의 기준)
// - 한국어 번역 · 원문 · 함께 보기 방식에 맞춰 문단 표시
// - 하이라이트 구간을 형광펜으로 칠하고 누르기 · 마우스 올리기를 바깥에 전달
// - 인용 · 하이라이트로 짚은 문단까지 스크롤하고 잠깐 강조
// ============================================================================
import { useEffect, useRef, useState } from 'react'
import type { HighlightDTO, HighlightVariant } from '@shared/types'
import { cn } from '@/common/lib/cn'
import { splitIntoSegments } from '@/domains/highlight/highlight'
import { SkeletonParagraphs } from '@/common/ui/Skeleton'
import { Caption } from '@/common/ui/Text'

// 본문 보기 방식: 한국어 번역 / 원문 / 번역 아래 원문을 함께
export type BodyMode = 'ko' | 'original' | 'both'

interface Props {
    paragraphs: string[] | null // 본문 문단들 (아직 불러오는 중이면 null)
    fullText: boolean // 원문 본문 전체를 가져왔는지 (false면 요약 · 초록만 있음)
    paragraphsKo?: (string | null)[] | null // 문단별 번역 (paragraphs와 같은 길이), 없으면 원문만 표시
    bodyMode?: BodyMode
    focusedParagraph?: number | null // AI 답변의 인용 · 하이라이트를 눌러 들어왔을 때 보여줄 문단 번호
    focusSequence?: number // 같은 문단을 다시 눌러도 형광 잔상이 다시 보이게 누를 때마다 바뀌는 값
    highlights?: HighlightDTO[]
    freshHighlightIds?: ReadonlySet<number> // 방금 그은 하이라이트 (형광펜을 긋는 움직임 표시)
    onHighlightClick?(id: number): void // 본문의 하이라이트를 눌렀을 때
    onHighlightHover?(id: number, el: HTMLElement): void // 하이라이트에 마우스를 올렸을 때 (메모 카드 표시용)
    onHighlightLeave?(): void // 하이라이트에서 마우스가 나갔을 때
}

// 문단 글 하나
// 하이라이트 구간은 <mark>로 칠하고, 선택 영역 계산을 위해 문단 번호 · 판(번역문 / 원문)을 data로 붙임
function ParagraphText({
    text,
    paragraphNumber,
    variant,
    highlights,
    freshHighlightIds,
    onHighlightClick,
    onHighlightHover,
    onHighlightLeave,
    className,
    revealDelay
}: {
    text: string
    paragraphNumber: number
    variant: HighlightVariant
    highlights: HighlightDTO[]
    freshHighlightIds?: ReadonlySet<number>
    onHighlightClick?(id: number): void
    onHighlightHover?(id: number, el: HTMLElement): void
    onHighlightLeave?(): void
    className: string
    revealDelay?: number // 번역이 막 도착했을 때 위에서부터 차례로 인쇄되듯 나타나게 하는 지연 (밀리초)
}) {
    const variantHighlights = highlights.filter((highlight) => highlight.paragraph === paragraphNumber && highlight.variant === variant) // 이 문단 · 이 판에 그은 하이라이트
    return (
        <p
            data-para={paragraphNumber}
            data-variant={variant}
            lang={variant === 'ko' ? 'ko' : 'en'}
            className={cn(className, revealDelay !== undefined && 'animate-ink-in')}
            // 지연은 문단 순서에 따라 실행 중에 정해지는 값이라 인라인 style로 전달
            style={revealDelay !== undefined ? { animationDelay: `${revealDelay}ms` } : undefined}
        >
            {variantHighlights.length === 0
                ? text
                : splitIntoSegments(text, variantHighlights).map((segment, segmentIndex) =>
                      segment.highlightId === null ? (
                          segment.text
                      ) : (
                          <mark
                              key={segmentIndex}
                              // 메모가 있으면 끝에 ✎ 표시 (app.css의 .marker[data-note])
                              data-note={highlights.find((highlight) => highlight.id === segment.highlightId)?.note ? '' : undefined}
                              onClick={() => onHighlightClick?.(segment.highlightId!)}
                              onPointerEnter={(pointerEvent) => onHighlightHover?.(segment.highlightId!, pointerEvent.currentTarget)}
                              onPointerLeave={() => onHighlightLeave?.()}
                              className={cn(
                                  'marker cursor-pointer bg-transparent text-inherit',
                                  freshHighlightIds?.has(segment.highlightId) && 'animate-marker'
                              )}
                          >
                              {segment.text}
                          </mark>
                      )
                  )}
        </p>
    )
}

// 문단이 화면 위에서 3분의 1쯤에 오도록 가장 가까운 스크롤 상자를 부드럽게 이동
function scrollToCenter(paragraphElement: HTMLElement): void {
    let scrollBox = paragraphElement.parentElement
    while (scrollBox && !(/(auto|scroll)/.test(getComputedStyle(scrollBox).overflowY) && scrollBox.scrollHeight > scrollBox.clientHeight)) {
        scrollBox = scrollBox.parentElement
    }
    if (!scrollBox) return
    const offsetInScrollBox = paragraphElement.getBoundingClientRect().top - scrollBox.getBoundingClientRect().top
    scrollBox.scrollTo({ top: scrollBox.scrollTop + offsetInScrollBox - scrollBox.clientHeight / 3, behavior: 'smooth' })
}

/**
 * 읽기 화면의 본문
 *
 * - 문단마다 번호(¶) 표시 (하이라이트와 AI 답변 인용의 기준)
 * - 번역은 문단 단위라 번호가 원문과 같음
 * - 번역하지 않은 문단(아주 긴 기사의 뒷부분)은 원문으로 표시
 *
 * @returns {JSX.Element} 문단 목록 (불러오는 중이면 뼈대, 본문이 없으면 안내 글)
 */
export function ArticleBody({
    paragraphs,
    fullText,
    paragraphsKo = null,
    bodyMode = 'ko',
    focusedParagraph = null,
    focusSequence = 0,
    highlights = [],
    freshHighlightIds,
    onHighlightClick,
    onHighlightHover,
    onHighlightLeave
}: Props) {
    // =============================== 상태 ===================================
    const [shouldReveal, setShouldReveal] = useState(false) // 번역 문단을 위에서부터 차례로 나타나게 할지

    // =============================== Ref ===================================
    const previousContent = useRef({ paragraphs, paragraphsKo }) // 직전 렌더의 본문 · 번역, 번역이 막 도착한 순간을 알아내는 용도

    // =============================== 계산 ===================================
    const shownTranslations = bodyMode !== 'original' ? paragraphsKo : null // 지금 보기 방식에서 쓸 번역 (원문 보기면 null)
    const untranslatedCount = shownTranslations ? shownTranslations.filter((translatedParagraph) => translatedParagraph === null).length : 0 // 번역이 없어 원문으로 보여주는 문단 수

    // =============================== useEffect ===================================
    // 원문을 보여주던 중에 번역이 도착하면 번역 문단을 위에서부터 차례로 표시 (기사가 바뀌면 해제)
    useEffect(() => {
        const previous = previousContent.current
        if (previous.paragraphs !== paragraphs) setShouldReveal(false)
        if (previous.paragraphs !== null && previous.paragraphs.length === paragraphs?.length && !previous.paragraphsKo && paragraphsKo)
            setShouldReveal(true)
        previousContent.current = { paragraphs, paragraphsKo }
    }, [paragraphs, paragraphsKo])

    // 인용한 문단으로 스크롤 (문단이 그려진 뒤, 가장 가까운 스크롤 상자만 이동)
    useEffect(() => {
        if (focusedParagraph === null || !paragraphs) return
        const focusedParagraphElement = document.getElementById(`p-${focusedParagraph}`)
        if (focusedParagraphElement) scrollToCenter(focusedParagraphElement)
    }, [focusedParagraph, focusSequence, paragraphs])

    // 불러오는 중 · 본문 없음
    if (paragraphs === null) return <SkeletonParagraphs />
    if (paragraphs.length === 0) return <Caption>보관된 본문이 없습니다. 기사를 저장하면 원문에서 본문을 가져옵니다.</Caption>

    return (
        <div className="flex flex-col gap-3">
            {/* 안내 글 */}
            {!fullText && <Caption>원문 본문을 가져오지 못해 요약·초록만 있습니다.</Caption>}
            {untranslatedCount > 0 && (
                <Caption>문단 {untranslatedCount}개는 번역하지 않아 원문으로 보여줍니다. 아주 긴 기사는 앞부분만 번역합니다.</Caption>
            )}

            {/* 문단 목록 */}
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
                {paragraphs.map((paragraph, paragraphIndex) => {
                    const translatedParagraph = shownTranslations?.[paragraphIndex] ?? null // 이 문단의 번역 (없으면 원문으로 표시)
                    const shownVariants: HighlightVariant[] = translatedParagraph
                        ? bodyMode === 'both'
                            ? ['ko', 'original']
                            : ['ko']
                        : ['original'] // 지금 화면에 보이는 판
                    // 여백 교정 표시: 하이라이트가 있는 문단은 ¶ 옆에 강조색 괘선 (지금 보이지 않는 판에만 있으면 옅게)
                    const paragraphHighlights = highlights.filter((highlight) => highlight.paragraph === paragraphIndex + 1)
                    const hasHighlights = paragraphHighlights.length > 0
                    const isOnlyInHiddenVariant =
                        hasHighlights && paragraphHighlights.every((highlight) => !shownVariants.includes(highlight.variant))
                    const isFocused = focusedParagraph === paragraphIndex + 1
                    return (
                        <li
                            // 짚어 준 문단은 누를 때마다 다시 그려서 형광 잔상을 다시 표시
                            key={isFocused ? `${paragraphIndex}-${focusSequence}` : paragraphIndex}
                            id={`p-${paragraphIndex + 1}`}
                            className={cn('relative -mx-2 flex gap-3 px-2 py-1', isFocused && 'animate-flash')}
                        >
                            {hasHighlights && (
                                <span
                                    aria-hidden="true"
                                    title={
                                        isOnlyInHiddenVariant
                                            ? translatedParagraph && bodyMode !== 'original'
                                                ? '원문에 그은 하이라이트가 있습니다'
                                                : '번역문에 그은 하이라이트가 있습니다'
                                            : undefined
                                    }
                                    className={cn(
                                        'absolute top-1.5 bottom-1.5 -left-1 w-0.5',
                                        isOnlyInHiddenVariant ? 'bg-accent/35' : 'bg-accent'
                                    )}
                                />
                            )}
                            <span
                                className={cn(
                                    'w-7 flex-none pt-0.5 text-right font-display text-caption tabular-nums',
                                    hasHighlights ? 'text-accent' : 'text-ink-faint'
                                )}
                            >
                                ¶{paragraphIndex + 1}
                            </span>
                            <div className="flex min-w-0 flex-col gap-1.5">
                                <ParagraphText
                                    text={translatedParagraph ?? paragraph}
                                    paragraphNumber={paragraphIndex + 1}
                                    variant={translatedParagraph ? 'ko' : 'original'}
                                    highlights={highlights}
                                    freshHighlightIds={freshHighlightIds}
                                    onHighlightClick={onHighlightClick}
                                    onHighlightHover={onHighlightHover}
                                    onHighlightLeave={onHighlightLeave}
                                    className="text-reading text-ink-body"
                                    revealDelay={shouldReveal && translatedParagraph ? Math.min(paragraphIndex * 20, 600) : undefined}
                                />
                                {bodyMode === 'both' && translatedParagraph && (
                                    <ParagraphText
                                        text={paragraph}
                                        paragraphNumber={paragraphIndex + 1}
                                        variant="original"
                                        highlights={highlights}
                                        freshHighlightIds={freshHighlightIds}
                                        onHighlightClick={onHighlightClick}
                                        onHighlightHover={onHighlightHover}
                                        onHighlightLeave={onHighlightLeave}
                                        className="border-l-2 border-rule pl-3 text-body text-ink-muted"
                                    />
                                )}
                            </div>
                        </li>
                    )
                })}
            </ol>
        </div>
    )
}
