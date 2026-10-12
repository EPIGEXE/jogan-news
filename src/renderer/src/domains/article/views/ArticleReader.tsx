// ============================================================================
// 기사 읽기 화면
//
// [역할]
// - 기사 한 건을 넓은 본문 단과 메모 · 질문 · 하이라이트 단으로 나누어 표시
// - 본문 문장 하이라이트, 하이라이트 메모 카드, 문장을 인용한 질문 연결
// - 본문 번역 표시와 한국어 · 원문 · 함께 보기 전환
// - 저장 · 태그 · 원문 열기, 이전 · 다음 기사 이동, 읽기 화면 단축키 처리
// ============================================================================
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CATEGORY_LABEL, type HighlightDTO } from '@shared/types'
import { ArticleBody, type BodyMode } from '@/domains/article/components/ArticleBody'
import { HighlightCard } from '@/domains/highlight/HighlightCard'
import { HighlightList } from '@/domains/highlight/HighlightList'
import { MemoPad } from '@/domains/article/components/MemoPad'
import { SelectionToolbar } from '@/domains/highlight/SelectionToolbar'
import { ResizeHandle, useResizableWidth } from '@/common/layout/ResizeHandle'
import { TagList } from '@/domains/article/components/TagList'
import { WhyItMatters } from '@/domains/article/components/WhyItMatters'
import { Button } from '@/common/ui/Button'
import { Segmented, type SegmentItem } from '@/common/ui/Segmented'
import { Tabs, type TabItem } from '@/common/ui/Tabs'
import { HelpText, Kicker, MetaText, OriginalTitle } from '@/common/ui/Text'
import { cn } from '@/common/lib/cn'
import { patchArticle, setEnriching } from '@/domains/article/cache'
import { useAutoTranslate } from '@/domains/article/hooks/useAutoTranslate'
import { useBodyMode } from '@/domains/article/hooks/useBodyMode'
import { useArticleActions, useEnrichingQuery, useItemDetailQuery } from '@/domains/article/queries'
import type { ArticleView } from '@/domains/article/types'
import { useAddHighlightsMutation, useRemoveHighlightMutation, useUpdateHighlightNoteMutation } from '@/domains/highlight/queries'
import { formatShortDate } from '@/common/lib/format'
import { buildQuoteQuestion, rangesFromSelection, selectedText } from '@/domains/highlight/highlight'
import { toast } from '@/common/lib/toast'
import { ArticleChat } from '@/domains/chat/ArticleChat'

type SideTab = 'memo' | 'ask' | 'highlights' // 옆 단의 탭 (메모 / 질문 / 하이라이트)

// 옆 단의 탭 목록 (하이라이트가 있으면 개수 표시)
function buildSideTabs(highlightCount: number): TabItem<SideTab>[] {
    return [
        { id: 'memo', label: '메모' },
        { id: 'ask', label: '질문' },
        { id: 'highlights', label: highlightCount ? `하이라이트 ${highlightCount}` : '하이라이트' }
    ]
}

// 본문 보기 방식 선택지 (T 단축키는 이 순서로 전환)
const BODY_MODES: SegmentItem<BodyMode>[] = [
    { id: 'ko', label: '한국어' },
    { id: 'original', label: '원문' },
    { id: 'both', label: '함께 보기', title: '번역 아래에 원문을 함께' }
]

// 이전 · 다음 기사
interface Neighbor {
    title: string
    open(): void // 그 기사로 이동
}

interface Props {
    article: ArticleView
    onBack(): void // 목록으로 돌아가기
    backLabel: string // 돌아가기 버튼의 "← …" 글자
    previousArticle?: Neighbor // 이전 기사 (없으면 버튼 비활성)
    nextArticle?: Neighbor // 다음 기사 (없으면 버튼 비활성)
}

// 입력창에 글을 쓰는 중인지 (쓰는 중에는 단축키 무시)
function isTyping(keyboardEvent: KeyboardEvent): boolean {
    const targetElement = keyboardEvent.target as HTMLElement | null
    return !!targetElement && (targetElement.tagName === 'INPUT' || targetElement.tagName === 'TEXTAREA' || targetElement.isContentEditable)
}

/**
 * 기사 읽기 화면 (신문 기사처럼 넓은 본문 단 + 메모 · 질문 단)
 *
 * - 넓은 창(1280px 이상)에서는 메모 · 질문이 오른쪽에 붙고, 좁으면 기사 아래로 내려감
 * - 단축키: Esc 목록으로, J/K 다음 · 이전 기사, S 저장, M 메모, / 질문, O 원문,
 *   T 본문 한국어 · 원문 · 함께 보기 전환, H 선택한 문장 하이라이트
 *
 * @returns {JSX.Element} 읽기 화면
 */
export function ArticleReader({ article, onBack, backLabel, previousArticle, nextArticle }: Props) {
    // =============================== 훅 ===================================
    const queryClient = useQueryClient()
    const articleActions = useArticleActions(article)! // 이 기사에 대한 동작 (저장 · 메모 · 태그 · 원문 열기)
    const [bodyMode, setBodyMode] = useBodyMode() // 본문 보기 방식 (한국어 · 원문 · 함께 보기)
    const asideResize = useResizableWidth('ainews.readerAsideWidth', 440, 320, 720) // 메모 · 질문 단 너비 (넓은 창에서 끌어서 조절, 이 PC에 기억)

    // =============================== 쿼리 훅 ===================================
    const itemDetail = useItemDetailQuery(article.itemId).data ?? null // 기사 상세 (본문 문단 · 번역 · 하이라이트)
    const isEnriching = useEnrichingQuery(article.itemId) // 저장 후 보강(태그 추천 등)이 도는 중인지
    const { mutate: addHighlights } = useAddHighlightsMutation()
    const { mutate: updateHighlightNote } = useUpdateHighlightNoteMutation()
    const { mutate: removeHighlight } = useRemoveHighlightMutation()

    // =============================== 훅 ===================================
    const autoTranslation = useAutoTranslate(itemDetail) // 번역이 없는 기사면 번역 요청 (번역 중 · 실패 여부와 다시 시도 제공)

    // =============================== 상태 ===================================
    const [sideTab, setSideTab] = useState<SideTab>('memo') // 옆 단에서 보고 있는 탭
    // 짚어 줄 문단 (seq는 같은 문단을 다시 눌러도 잔상이 다시 보이게 누를 때마다 증가)
    const [focusedParagraph, setFocusedParagraph] = useState<{ paragraphNumber: number; seq: number } | null>(null)
    const [activeHighlightId, setActiveHighlightId] = useState<number | null>(null) // 하이라이트 탭에서 강조할 하이라이트
    // 방금 그은 하이라이트 (형광펜을 긋는 움직임은 이것만 표시, 기사를 열 때 이미 있던 것은 그냥 칠해져 있음)
    const [freshHighlightIds, setFreshHighlightIds] = useState<ReadonlySet<number>>(new Set())
    const [chatDraft, setChatDraft] = useState<{ text: string; key: number } | null>(null) // 질문 탭에 채워 넣을 질문 초안
    const [noteCard, setNoteCard] = useState<{ highlightId: number; rect: DOMRect } | null>(null) // 떠 있는 하이라이트 메모 카드 (하이라이트 번호와 화면 위치)

    // =============================== Ref ===================================
    const memoTextareaRef = useRef<HTMLTextAreaElement>(null)
    const askTextareaRef = useRef<HTMLTextAreaElement>(null)
    // 스크롤되는 상자들 (다른 기사로 넘어가면 맨 위로 되돌림, scrollIntoView는 바깥 화면까지 움직여서 쓰지 않음)
    const scrollBox = useRef<HTMLDivElement>(null)
    const articleBox = useRef<HTMLDivElement>(null)
    const bodyBox = useRef<HTMLDivElement>(null) // 본문 영역 (선택한 문장의 위치 계산 기준)
    const noteCardTimer = useRef<number | undefined>(undefined) // 메모 카드를 띄우거나 닫기까지 기다리는 타이머

    // =============================== 계산 ===================================
    const isTranslated = itemDetail?.translation === 'done'
    const highlights: HighlightDTO[] = itemDetail?.highlights ?? []
    const noteCardHighlight = noteCard ? highlights.find((highlight) => highlight.id === noteCard.highlightId) : undefined // 메모 카드가 가리키는 하이라이트

    // 문단 짚기 (누를 때마다 seq 증가)
    const focusOnParagraph = (paragraphNumber: number) =>
        setFocusedParagraph((previousFocus) => ({ paragraphNumber, seq: (previousFocus?.seq ?? 0) + 1 }))

    // 선택한 문장 하이라이트 (처음 하이라이트하면 기사 자동 저장)
    const highlightSelection = () => {
        const selectedRanges = bodyBox.current ? rangesFromSelection(bodyBox.current) : []
        if (selectedRanges.length === 0) return
        window.getSelection()?.removeAllRanges()
        const existingHighlightIds = new Set(highlights.map((highlight) => highlight.id))
        const wasSaved = article.isSaved
        addHighlights(
            { itemId: article.itemId, ranges: selectedRanges },
            {
                onSuccess: (updatedHighlights) => {
                    setFreshHighlightIds(
                        new Set(
                            updatedHighlights
                                .filter((highlight) => !existingHighlightIds.has(highlight.id))
                                .map((highlight) => highlight.id)
                        )
                    )
                    // 하이라이트를 그은 기사는 Worker가 자동으로 저장하므로 화면에도 저장으로 표시
                    if (!wasSaved) {
                        patchArticle(queryClient, article.itemId, { isSaved: true })
                        setEnriching(queryClient, article.itemId, true)
                        toast('하이라이트하고 기사를 저장했습니다')
                    } else {
                        toast('하이라이트했습니다')
                    }
                }
            }
        )
    }

    // 하이라이트 메모 카드: 마우스를 올리고 잠깐 있으면 뜨고, 하이라이트와 카드 밖으로 나가면 잠깐 뒤 닫힘
    const showNoteCard = (highlightId: number, markElement: HTMLElement) => {
        window.clearTimeout(noteCardTimer.current)
        // 문장을 고르는(드래그) 중에는 띄우지 않음
        if (!window.getSelection()?.isCollapsed) return
        noteCardTimer.current = window.setTimeout(() => setNoteCard({ highlightId, rect: markElement.getBoundingClientRect() }), 250)
    }
    const keepNoteCard = () => window.clearTimeout(noteCardTimer.current)
    const hideNoteCard = () => {
        window.clearTimeout(noteCardTimer.current)
        noteCardTimer.current = window.setTimeout(() => setNoteCard(null), 220)
    }

    // 문장을 인용해서 질문 탭에 질문 초안 채우기
    const askAbout = (quotedText: string) => {
        if (!quotedText) return
        setSideTab('ask')
        setChatDraft({ text: buildQuoteQuestion(quotedText), key: Date.now() })
    }

    // =============================== useEffect ===================================
    // 스크롤하면 메모 카드가 하이라이트에서 떨어지므로 닫기
    useEffect(() => {
        if (!noteCard) return
        const closeNoteCard = () => setNoteCard(null)
        window.addEventListener('scroll', closeNoteCard, true)
        return () => window.removeEventListener('scroll', closeNoteCard, true)
    }, [noteCard])

    // 다른 기사로 넘어가면 짚은 문단 · 방금 그은 하이라이트 · 메모 카드 · 강조한 하이라이트를 비우고 스크롤을 맨 위로
    useEffect(() => {
        setFocusedParagraph(null)
        setFreshHighlightIds(new Set())
        setNoteCard(null)
        setActiveHighlightId(null)
        for (const scrollContainer of [scrollBox.current, articleBox.current]) scrollContainer?.scrollTo({ top: 0 })
    }, [article.itemId])

    // 읽기 화면 단축키 (입력창에 쓰는 중이거나 Ctrl · Alt · Meta와 함께 누르면 무시)
    useEffect(() => {
        const handleKeyDown = (keyboardEvent: KeyboardEvent) => {
            if (keyboardEvent.key === 'Escape' && !isTyping(keyboardEvent)) return onBack()
            if (isTyping(keyboardEvent) || keyboardEvent.ctrlKey || keyboardEvent.altKey || keyboardEvent.metaKey) return
            const pressedKey = keyboardEvent.key.toLowerCase()
            if (pressedKey === 'j' && nextArticle) nextArticle.open()
            else if (pressedKey === 'k' && previousArticle) previousArticle.open()
            else if (pressedKey === 's') articleActions.onToggleSave()
            else if (pressedKey === 'o') articleActions.onOpenUrl(article.url)
            else if (pressedKey === 'h') highlightSelection()
            else if (pressedKey === 't' && isTranslated) {
                const bodyModeIndex = BODY_MODES.findIndex((bodyModeOption) => bodyModeOption.id === bodyMode)
                setBodyMode(BODY_MODES[(bodyModeIndex + 1) % BODY_MODES.length]!.id)
            } else if (pressedKey === 'm') {
                setSideTab('memo')
                setTimeout(() => memoTextareaRef.current?.focus(), 0)
            } else if (keyboardEvent.key === '/') {
                setSideTab('ask')
                setTimeout(() => askTextareaRef.current?.focus(), 0)
            } else return
            keyboardEvent.preventDefault()
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [article, previousArticle, nextArticle, onBack, articleActions, isTranslated, bodyMode, setBodyMode, highlightSelection])

    return (
        <section aria-label="기사 읽기" className="flex min-w-0 flex-auto flex-col wide:h-full">
            {/* 위쪽 줄 (목록으로 · 이전 · 다음) */}
            <div className="flex flex-wrap items-center gap-2 border-b border-rule bg-paper px-7 py-2">
                <Button variant="text" onClick={onBack} title="목록으로 (Esc)">
                    ← {backLabel}
                </Button>
                <span className="flex-1" />
                <Button
                    disabled={!previousArticle}
                    onClick={previousArticle?.open}
                    title={previousArticle ? `이전 기사 (K): ${previousArticle.title}` : undefined}
                >
                    ‹ 이전
                </Button>
                <Button
                    disabled={!nextArticle}
                    onClick={nextArticle?.open}
                    title={nextArticle ? `다음 기사 (J): ${nextArticle.title}` : undefined}
                >
                    다음 ›
                </Button>
            </div>

            <div ref={scrollBox} className="flex min-h-0 flex-1 flex-col overflow-y-auto reader:flex-row reader:overflow-hidden">
                {/* 기사 단 */}
                <div ref={articleBox} className="reader:min-w-0 reader:flex-1 reader:overflow-y-auto">
                    <article className="mx-auto flex max-w-180 flex-col gap-5 px-7 pt-8 pb-12">
                        {/* 분류 · 출처 · 날짜 */}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <Kicker>{CATEGORY_LABEL[article.category]}</Kicker>
                            <MetaText>
                                {article.sourceName}
                                {article.engagementLabel ? ` · ${article.engagementLabel}` : ''}
                                {article.publishedAt ? ` · ${new Date(article.publishedAt).toLocaleDateString('ko-KR')}` : ''}
                            </MetaText>
                        </div>

                        {/* 제목 */}
                        <div className="flex flex-col gap-2 border-b-3 border-double border-rule-strong pb-5">
                            <h1 className="font-display text-display font-bold tracking-tight">{article.titleKo}</h1>
                            <OriginalTitle>{article.originalTitle}</OriginalTitle>
                            {article.followUpOf && (
                                <HelpText>
                                    <span className="font-bold text-accent">후속 소식</span> · 지난
                                    {article.followUpOf.digestDate ? ` ${formatShortDate(article.followUpOf.digestDate)} ` : ' '}브리핑에
                                    실린 “{article.followUpOf.titleKo}”의 새 전개입니다.
                                </HelpText>
                            )}
                        </div>

                        {/* 저장 · 원문 버튼과 태그 */}
                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                variant={article.isSaved ? 'solid' : 'outline'}
                                icon="bookmark"
                                iconFilled={article.isSaved}
                                aria-pressed={article.isSaved}
                                onClick={articleActions.onToggleSave}
                                title="저장 (S)"
                            >
                                {article.isSaved ? '저장됨' : '저장'}
                            </Button>
                            <Button icon="external" onClick={() => articleActions.onOpenUrl(article.url)} title="원문 열기 (O)">
                                원문 열기
                            </Button>
                        </div>
                        {(article.isSaved || article.tags.length > 0) && (
                            <TagList
                                tags={article.tags}
                                onAdd={articleActions.onAddTag}
                                onRemove={articleActions.onRemoveTag}
                                isSuggestingTags={isEnriching}
                            />
                        )}

                        {/* 요약 · 핵심 포인트 · 왜 중요한가 */}
                        <p className="text-lead text-ink">{article.summaryKo}</p>
                        {article.keyPoints.length > 0 && (
                            <ul className="m-0 flex list-disc flex-col gap-1 pl-6 text-reading text-ink-secondary">
                                {article.keyPoints.map((keyPoint) => (
                                    <li key={keyPoint}>{keyPoint}</li>
                                ))}
                            </ul>
                        )}
                        {article.whyItMatters && <WhyItMatters>{article.whyItMatters}</WhyItMatters>}

                        {/* 본문 */}
                        <div className="flex flex-col gap-3 pt-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <h2 className="font-display text-label font-bold tracking-label text-accent">본문</h2>
                                {isTranslated && (
                                    <Segmented items={BODY_MODES} value={bodyMode} onChange={setBodyMode} label="본문 보기 (T)" />
                                )}
                            </div>
                            {autoTranslation.isTranslating && (
                                <HelpText role="status">본문을 한국어로 옮기는 중입니다. 끝나면 이 자리에서 바로 바뀝니다.</HelpText>
                            )}
                            {autoTranslation.hasFailed && (
                                <HelpText>
                                    번역하지 못해 원문을 보여줍니다. 네트워크·API 키·하루 사용 상한을 확인하세요.{' '}
                                    <Button variant="text" onClick={autoTranslation.retry}>
                                        다시 시도
                                    </Button>
                                </HelpText>
                            )}
                            <div ref={bodyBox}>
                                <ArticleBody
                                    paragraphs={itemDetail?.paragraphs ?? null}
                                    fullText={itemDetail?.hasFullText ?? false}
                                    paragraphsKo={itemDetail?.paragraphsKo}
                                    bodyMode={bodyMode}
                                    focusedParagraph={focusedParagraph?.paragraphNumber ?? null}
                                    focusSequence={focusedParagraph?.seq}
                                    freshHighlightIds={freshHighlightIds}
                                    highlights={highlights}
                                    onHighlightClick={(highlightId) => {
                                        setNoteCard(null)
                                        setSideTab('highlights')
                                        setActiveHighlightId(highlightId)
                                    }}
                                    onHighlightHover={showNoteCard}
                                    onHighlightLeave={hideNoteCard}
                                />
                            </div>
                            {/* 문장을 선택하면 뜨는 도구 · 하이라이트 메모 카드 */}
                            <SelectionToolbar
                                containerRef={bodyBox}
                                onHighlight={highlightSelection}
                                onAsk={() => askAbout(selectedText())}
                            />
                            {noteCard && noteCardHighlight && (
                                <HighlightCard
                                    highlight={noteCardHighlight}
                                    anchorRect={noteCard.rect}
                                    onPointerEnter={keepNoteCard}
                                    onPointerLeave={hideNoteCard}
                                    onSaveNote={(note) =>
                                        updateHighlightNote({ itemId: article.itemId, highlightId: noteCardHighlight.id, note })
                                    }
                                    onAsk={() => {
                                        setNoteCard(null)
                                        askAbout(noteCardHighlight.text)
                                    }}
                                    onRemove={() => {
                                        setNoteCard(null)
                                        removeHighlight({ itemId: article.itemId, highlightId: noteCardHighlight.id })
                                    }}
                                />
                            )}
                        </div>

                        {/* 같은 소식을 다룬 다른 출처 */}
                        {article.otherSources.length > 0 && (
                            <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-rule pt-4 text-meta text-ink-muted">
                                <span>같은 소식:</span>
                                {article.otherSources.map((otherSource) => (
                                    <button
                                        key={otherSource.url}
                                        type="button"
                                        onClick={() => articleActions.onOpenUrl(otherSource.url)}
                                        className="min-h-6 cursor-pointer border-0 bg-transparent p-0 text-meta text-ink-secondary underline underline-offset-3 hover:text-accent"
                                    >
                                        {otherSource.sourceName}
                                        {otherSource.engagementLabel ? ` (${otherSource.engagementLabel})` : ''}
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* 다음 기사 */}
                        {nextArticle && (
                            <button
                                type="button"
                                onClick={nextArticle.open}
                                className="mt-4 flex cursor-pointer flex-col items-start gap-1 border-0 border-t border-rule-strong bg-transparent pt-4 text-left hover:text-accent"
                            >
                                <span className="text-meta text-ink-muted">다음 기사 (J)</span>
                                <span className="font-display text-title font-semibold">{nextArticle.title}</span>
                            </button>
                        )}
                    </article>
                </div>

                {/* 메모 · 질문 · 하이라이트 단 */}
                <aside
                    aria-label="메모와 질문"
                    // 너비는 끌어서 바꾸는 값이라 CSS 변수로 전달
                    style={{ '--aside-w': `${asideResize.width}px` } as CSSProperties}
                    className={cn(
                        'relative flex flex-col border-t border-rule bg-paper-raised reader:w-(--aside-w) reader:flex-none reader:border-t-0 reader:border-l',
                        asideResize.easing && 'width-ease'
                    )}
                >
                    <ResizeHandle {...asideResize} label="메모·질문 단 너비" className="hidden reader:block" />
                    {/* 탭은 스크롤 영역 밖에 두어 내용을 가리지 않게 함 */}
                    <div className="flex-none border-b border-rule-soft px-7 pt-5">
                        <Tabs
                            items={buildSideTabs(highlights.length)}
                            value={sideTab}
                            onChange={setSideTab}
                            label="기사 도구"
                            tone="display"
                        />
                    </div>
                    <div className="flex min-h-0 flex-1 flex-col gap-4 px-7 py-5 reader:overflow-y-auto">
                        {sideTab === 'memo' && (
                            <MemoPad
                                ref={memoTextareaRef}
                                itemId={article.itemId}
                                initialBody={article.memo}
                                onSave={articleActions.onSaveMemo}
                            />
                        )}
                        {sideTab === 'ask' && (
                            <ArticleChat
                                ref={askTextareaRef}
                                itemId={article.itemId}
                                onCite={focusOnParagraph}
                                onAddToMemo={(answerText) => {
                                    void articleActions
                                        .onSaveMemo(article.memo ? `${article.memo}\n\n${answerText}` : answerText)
                                        .then(() => toast('메모에 추가했습니다'))
                                }}
                                draft={chatDraft}
                            />
                        )}
                        {sideTab === 'highlights' && (
                            <HighlightList
                                highlights={highlights}
                                activeHighlightId={activeHighlightId}
                                onGoTo={(highlight) => {
                                    setActiveHighlightId(highlight.id)
                                    focusOnParagraph(highlight.paragraph)
                                }}
                                onAsk={(highlight) => askAbout(highlight.text)}
                                onSaveNote={(highlightId, note) => updateHighlightNote({ itemId: article.itemId, highlightId, note })}
                                onRemove={(highlightId) => removeHighlight({ itemId: article.itemId, highlightId })}
                            />
                        )}
                    </div>
                </aside>
            </div>
        </section>
    )
}
