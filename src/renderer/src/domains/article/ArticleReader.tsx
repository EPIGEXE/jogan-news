import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CATEGORY_LABEL, type HighlightDTO } from '@shared/types'
import { ArticleBody, type BodyMode } from '@/domains/article/ArticleBody'
import { HighlightCard } from '@/domains/highlight/HighlightCard'
import { HighlightList } from '@/domains/highlight/HighlightList'
import { MemoPad } from '@/domains/article/MemoPad'
import { SelectionToolbar } from '@/domains/highlight/SelectionToolbar'
import { ResizeHandle, useResizableWidth } from '@/common/layout/ResizeHandle'
import { TagList } from '@/domains/article/TagList'
import { WhyItMatters } from '@/domains/article/WhyItMatters'
import { Button } from '@/common/ui/Button'
import { Segmented, type SegmentItem } from '@/common/ui/Segmented'
import { Tabs, type TabItem } from '@/common/ui/Tabs'
import { Help, Kicker, Meta, OriginalTitle } from '@/common/ui/Text'
import { api } from '@/common/lib/api'
import { cn } from '@/common/lib/cn'
import { useAutoTranslate, useBodyMode, type ArticleView } from '@/domains/article/article'
import { patchArticle, setEnriching, setHighlights } from '@/domains/article/cache'
import { useArticleActions, useEnriching, useItemDetail } from '@/domains/article/queries'
import { formatShortDate } from '@/common/lib/format'
import { quoteQuestion, rangesFromSelection, selectedText } from '@/domains/highlight/highlight'
import { toast } from '@/common/lib/toast'
import { ArticleChat } from '@/domains/chat/ArticleChat'

type SideTab = 'memo' | 'ask' | 'highlights'

function sideTabs(highlightCount: number): TabItem<SideTab>[] {
  return [
    { id: 'memo', label: '메모' },
    { id: 'ask', label: '질문' },
    { id: 'highlights', label: highlightCount ? `하이라이트 ${highlightCount}` : '하이라이트' }
  ]
}

const BODY_MODES: SegmentItem<BodyMode>[] = [
  { id: 'ko', label: '한국어' },
  { id: 'original', label: '원문' },
  { id: 'both', label: '함께 보기', title: '번역 아래에 원문을 함께' }
]

interface Neighbor {
  title: string
  go(): void
}

interface Props {
  entry: ArticleView
  onBack(): void
  backLabel: string
  prev?: Neighbor
  next?: Neighbor
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
}

/**
 * 기사 읽기 화면: 신문 기사처럼 넓은 본문 단 + 메모·질문 단.
 * 넓은 창(1280px 이상)에서는 메모·질문이 오른쪽에 붙고, 좁으면 기사 아래로 내려간다.
 * 단축키: Esc 목록으로, J/K 다음·이전 기사, S 저장, M 메모, / 질문, O 원문, T 본문 한국어·원문·함께 보기 전환,
 * H 선택한 문장 하이라이트
 */
export function ArticleReader({ entry, onBack, backLabel, prev, next }: Props) {
  const [side, setSide] = useState<SideTab>('memo')
  // 짚어 줄 문단. seq는 같은 문단을 다시 눌러도 잔상이 다시 보이게 누를 때마다 늘린다
  const [focus, setFocus] = useState<{ n: number; seq: number } | null>(null)
  const focusOn = (n: number) => setFocus((f) => ({ n, seq: (f?.seq ?? 0) + 1 }))
  const memoRef = useRef<HTMLTextAreaElement>(null)
  const askRef = useRef<HTMLTextAreaElement>(null)
  // 스크롤되는 상자들. 다른 기사로 넘어가면 맨 위로 되돌린다 (scrollIntoView는 바깥 화면까지 움직여서 쓰지 않음)
  const scrollBox = useRef<HTMLDivElement>(null)
  const articleBox = useRef<HTMLDivElement>(null)
  const qc = useQueryClient()
  const detail = useItemDetail(entry.itemId).data ?? null
  const enriching = useEnriching(entry.itemId)
  const h = useArticleActions(entry)!
  const [bodyMode, setBodyMode] = useBodyMode()
  const translation = useAutoTranslate(detail)
  const translated = detail?.translation === 'done'
  const bodyBox = useRef<HTMLDivElement>(null)
  // 메모·질문 단 너비 (넓은 창에서 끌어서 조절, 이 PC에 기억)
  const aside = useResizableWidth('ainews.readerAsideWidth', 440, 320, 720)
  const highlights: HighlightDTO[] = detail?.highlights ?? []
  const updateHighlights = (list: HighlightDTO[]) => setHighlights(qc, entry.itemId, list)
  const [activeHighlight, setActiveHighlight] = useState<number | null>(null)
  // 방금 그은 하이라이트: 형광펜을 긋는 움직임은 이것만 보여준다 (기사를 열 때 이미 있던 것은 그냥 칠해져 있음)
  const [freshHighlights, setFreshHighlights] = useState<ReadonlySet<number>>(new Set())
  const [chatDraft, setChatDraft] = useState<{ text: string; key: number } | null>(null)


  /** 선택한 문장을 하이라이트한다. 처음 하이라이트하면 기사가 자동 저장된다 */
  const addHighlight = () => {
    const ranges = bodyBox.current ? rangesFromSelection(bodyBox.current) : []
    if (ranges.length === 0) return
    window.getSelection()?.removeAllRanges()
    void api.addHighlights(entry.itemId, ranges).then((list) => {
      const before = new Set(highlights.map((x) => x.id))
      setFreshHighlights(new Set(list.filter((x) => !before.has(x.id)).map((x) => x.id)))
      updateHighlights(list)
      if (!entry.isSaved) {
        patchArticle(qc, entry.itemId, { isSaved: true })
        setEnriching(qc, entry.itemId, true)
        toast('하이라이트하고 기사를 저장했습니다')
      } else {
        toast('하이라이트했습니다')
      }
    })
  }

  // 하이라이트 메모 카드: 마우스를 올리고 잠깐 있으면 뜨고, 하이라이트와 카드 밖으로 나가면 잠깐 뒤 닫힌다
  const [card, setCard] = useState<{ id: number; rect: DOMRect } | null>(null)
  const cardTimer = useRef<number | undefined>(undefined)
  const showCard = (id: number, el: HTMLElement) => {
    window.clearTimeout(cardTimer.current)
    // 문장을 고르는(드래그) 중에는 띄우지 않는다
    if (!window.getSelection()?.isCollapsed) return
    cardTimer.current = window.setTimeout(() => setCard({ id, rect: el.getBoundingClientRect() }), 250)
  }
  const keepCard = () => window.clearTimeout(cardTimer.current)
  const hideCard = () => {
    window.clearTimeout(cardTimer.current)
    cardTimer.current = window.setTimeout(() => setCard(null), 220)
  }
  const cardHighlight = card ? highlights.find((x) => x.id === card.id) : undefined
  // 스크롤하면 카드가 하이라이트에서 떨어지므로 닫는다
  useEffect(() => {
    if (!card) return
    const close = () => setCard(null)
    window.addEventListener('scroll', close, true)
    return () => window.removeEventListener('scroll', close, true)
  }, [card])

  /** 문장을 인용해서 질문 탭에 질문 초안을 채운다 */
  const askAbout = (text: string) => {
    if (!text) return
    setSide('ask')
    setChatDraft({ text: quoteQuestion(text), key: Date.now() })
  }

  useEffect(() => {
    setFocus(null)
    setFreshHighlights(new Set())
    setCard(null)
    setActiveHighlight(null)
    for (const box of [scrollBox.current, articleBox.current]) box?.scrollTo({ top: 0 })
  }, [entry.itemId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isTyping(e)) return onBack()
      if (isTyping(e) || e.ctrlKey || e.altKey || e.metaKey) return
      const key = e.key.toLowerCase()
      if (key === 'j' && next) next.go()
      else if (key === 'k' && prev) prev.go()
      else if (key === 's') h.onToggleSave()
      else if (key === 'o') h.onOpenUrl(entry.url)
      else if (key === 'h') addHighlight()
      else if (key === 't' && translated) {
        const i = BODY_MODES.findIndex((m) => m.id === bodyMode)
        setBodyMode(BODY_MODES[(i + 1) % BODY_MODES.length]!.id)
      } else if (key === 'm') {
        setSide('memo')
        setTimeout(() => memoRef.current?.focus(), 0)
      } else if (e.key === '/') {
        setSide('ask')
        setTimeout(() => askRef.current?.focus(), 0)
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [entry, prev, next, onBack, h, translated, bodyMode, setBodyMode, addHighlight])

  return (
    <section aria-label="기사 읽기" className="flex min-w-0 flex-auto flex-col wide:h-full">
      <div className="flex flex-wrap items-center gap-2 border-b border-rule bg-paper px-7 py-2">
        <Button variant="text" onClick={onBack} title="목록으로 (Esc)">
          ← {backLabel}
        </Button>
        <span className="flex-1" />
        <Button disabled={!prev} onClick={prev?.go} title={prev ? `이전 기사 (K): ${prev.title}` : undefined}>
          ‹ 이전
        </Button>
        <Button disabled={!next} onClick={next?.go} title={next ? `다음 기사 (J): ${next.title}` : undefined}>
          다음 ›
        </Button>
      </div>

      <div ref={scrollBox} className="flex min-h-0 flex-1 flex-col overflow-y-auto reader:flex-row reader:overflow-hidden">
        <div ref={articleBox} className="reader:min-w-0 reader:flex-1 reader:overflow-y-auto">
          <article className="mx-auto flex max-w-180 flex-col gap-5 px-7 pt-8 pb-12">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Kicker>{CATEGORY_LABEL[entry.category]}</Kicker>
              <Meta>
                {entry.sourceName}
                {entry.engagementLabel ? ` · ${entry.engagementLabel}` : ''}
                {entry.publishedAt ? ` · ${new Date(entry.publishedAt).toLocaleDateString('ko-KR')}` : ''}
              </Meta>
            </div>
            <div className="flex flex-col gap-2 border-b-3 border-double border-rule-strong pb-5">
              <h1 className="font-display text-display font-bold tracking-tight">{entry.titleKo}</h1>
              <OriginalTitle>{entry.originalTitle}</OriginalTitle>
              {entry.followUpOf && (
                <Help>
                  <span className="font-bold text-accent">후속 소식</span> · 지난
                  {entry.followUpOf.digestDate ? ` ${formatShortDate(entry.followUpOf.digestDate)} ` : ' '}브리핑에 실린 “
                  {entry.followUpOf.titleKo}”의 새 전개입니다.
                </Help>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant={entry.isSaved ? 'solid' : 'outline'}
                icon="bookmark"
                iconFilled={entry.isSaved}
                aria-pressed={entry.isSaved}
                onClick={h.onToggleSave}
                title="저장 (S)"
              >
                {entry.isSaved ? '저장됨' : '저장'}
              </Button>
              <Button icon="external" onClick={() => h.onOpenUrl(entry.url)} title="원문 열기 (O)">
                원문 열기
              </Button>
            </div>
            {(entry.isSaved || entry.tags.length > 0) && (
              <TagList tags={entry.tags} onAdd={h.onAddTag} onRemove={h.onRemoveTag} pending={enriching} />
            )}

            <p className="text-lead text-ink">{entry.summaryKo}</p>
            {entry.keyPoints.length > 0 && (
              <ul className="m-0 flex list-disc flex-col gap-1 pl-6 text-reading text-ink-secondary">
                {entry.keyPoints.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            {entry.whyItMatters && <WhyItMatters>{entry.whyItMatters}</WhyItMatters>}

            <div className="flex flex-col gap-3 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-label font-bold tracking-label text-accent">본문</h2>
                {translated && <Segmented items={BODY_MODES} value={bodyMode} onChange={setBodyMode} label="본문 보기 (T)" />}
              </div>
              {translation.translating && <Help role="status">본문을 한국어로 옮기는 중입니다. 끝나면 이 자리에서 바로 바뀝니다.</Help>}
              {translation.failed && (
                <Help>
                  번역하지 못해 원문을 보여줍니다. 네트워크·API 키·하루 사용 상한을 확인하세요.{' '}
                  <Button variant="text" onClick={translation.retry}>
                    다시 시도
                  </Button>
                </Help>
              )}
              <div ref={bodyBox}>
                <ArticleBody
                  paragraphs={detail?.paragraphs ?? null}
                  fullText={detail?.fullText ?? false}
                  paragraphsKo={detail?.paragraphsKo}
                  mode={bodyMode}
                  focus={focus?.n ?? null}
                  focusSeq={focus?.seq}
                  freshHighlightIds={freshHighlights}
                  highlights={highlights}
                  onHighlightClick={(id) => {
                    setCard(null)
                    setSide('highlights')
                    setActiveHighlight(id)
                  }}
                  onHighlightHover={showCard}
                  onHighlightLeave={hideCard}
                />
              </div>
              <SelectionToolbar container={bodyBox} onHighlight={addHighlight} onAsk={() => askAbout(selectedText())} />
              {card && cardHighlight && (
                <HighlightCard
                  highlight={cardHighlight}
                  anchor={card.rect}
                  onPointerEnter={keepCard}
                  onPointerLeave={hideCard}
                  onSaveNote={(note) => void api.updateHighlightNote(cardHighlight.id, note).then(updateHighlights)}
                  onAsk={() => {
                    setCard(null)
                    askAbout(cardHighlight.text)
                  }}
                  onRemove={() => {
                    setCard(null)
                    void api.removeHighlight(cardHighlight.id).then(updateHighlights)
                  }}
                />
              )}
            </div>

            {entry.otherSources.length > 0 && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-rule pt-4 text-meta text-ink-muted">
                <span>같은 소식:</span>
                {entry.otherSources.map((s) => (
                  <button
                    key={s.url}
                    type="button"
                    onClick={() => h.onOpenUrl(s.url)}
                    className="min-h-6 cursor-pointer border-0 bg-transparent p-0 text-meta text-ink-secondary underline underline-offset-3 hover:text-accent"
                  >
                    {s.sourceName}
                    {s.engagementLabel ? ` (${s.engagementLabel})` : ''}
                  </button>
                ))}
              </div>
            )}

            {next && (
              <button
                type="button"
                onClick={next.go}
                className="mt-4 flex cursor-pointer flex-col items-start gap-1 border-0 border-t border-rule-strong bg-transparent pt-4 text-left hover:text-accent"
              >
                <span className="text-meta text-ink-muted">다음 기사 (J)</span>
                <span className="font-display text-title font-semibold">{next.title}</span>
              </button>
            )}
          </article>
        </div>

        <aside
          aria-label="메모와 질문"
          // 너비는 끌어서 바꾸는 값이라 CSS 변수로 넘긴다
          style={{ '--aside-w': `${aside.width}px` } as CSSProperties}
          className={cn(
            'relative flex flex-col border-t border-rule bg-paper-raised reader:w-(--aside-w) reader:flex-none reader:border-t-0 reader:border-l',
            aside.easing && 'width-ease'
          )}
        >
          <ResizeHandle {...aside} label="메모·질문 단 너비" className="hidden reader:block" />
          {/* 탭은 스크롤 영역 밖에 두어 내용을 가리지 않는다 */}
          <div className="flex-none border-b border-rule-soft px-7 pt-5">
            <Tabs items={sideTabs(highlights.length)} value={side} onChange={setSide} label="기사 도구" tone="display" />
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-4 px-7 py-5 reader:overflow-y-auto">
            {side === 'memo' && <MemoPad ref={memoRef} itemId={entry.itemId} initial={entry.memo} onSave={h.onSaveMemo} />}
            {side === 'ask' && (
              <ArticleChat
                ref={askRef}
                itemId={entry.itemId}
                onCite={focusOn}
                onAddToMemo={(text) => {
                  void h.onSaveMemo(entry.memo ? `${entry.memo}\n\n${text}` : text).then(() => toast('메모에 추가했습니다'))
                }}
                draft={chatDraft}
              />
            )}
            {side === 'highlights' && (
              <HighlightList
                highlights={highlights}
                activeId={activeHighlight}
                onGoTo={(hl) => {
                  setActiveHighlight(hl.id)
                  focusOn(hl.paragraph)
                }}
                onAsk={(hl) => askAbout(hl.text)}
                onSaveNote={(id, note) => void api.updateHighlightNote(id, note).then(updateHighlights)}
                onRemove={(id) => void api.removeHighlight(id).then(updateHighlights)}
              />
            )}
          </div>
        </aside>
      </div>
    </section>
  )
}
