import { useEffect, useRef, useState } from 'react'
import type { HighlightDTO, HighlightVariant } from '@shared/types'
import { cn } from '@/common/lib/cn'
import { segments } from '@/domains/highlight/highlight'
import { SkeletonParagraphs } from '@/common/ui/Skeleton'
import { Caption } from '@/common/ui/Text'

/** 본문 보기: 한국어 번역 / 원문 / 번역 아래 원문을 함께 */
export type BodyMode = 'ko' | 'original' | 'both'

interface Props {
  paragraphs: string[] | null
  fullText: boolean
  /** 문단별 번역 (paragraphs와 같은 길이). 없으면 원문만 보여준다 */
  paragraphsKo?: (string | null)[] | null
  mode?: BodyMode
  /** AI 답변의 인용·하이라이트를 눌러 들어왔을 때 보여줄 문단 번호 */
  focus?: number | null
  /** 같은 문단을 다시 눌러도 형광 잔상이 다시 보이게 누를 때마다 바뀌는 값 */
  focusSeq?: number
  highlights?: HighlightDTO[]
  /** 방금 그은 하이라이트 (형광펜을 긋는 움직임을 보여준다) */
  freshHighlightIds?: ReadonlySet<number>
  /** 본문의 하이라이트를 눌렀을 때 */
  onHighlightClick?(id: number): void
  /** 하이라이트에 마우스를 올리고 내렸을 때 (메모 카드) */
  onHighlightHover?(id: number, el: HTMLElement): void
  onHighlightLeave?(): void
}

/** 문단 글자 하나. 하이라이트 구간은 <mark>로 칠하고, 선택 영역 계산을 위해 문단 번호·판을 data로 붙인다 */
function ParagraphText({
  text,
  para,
  variant,
  highlights,
  fresh,
  onHighlightClick,
  onHighlightHover,
  onHighlightLeave,
  className,
  revealDelay
}: {
  text: string
  para: number
  variant: HighlightVariant
  highlights: HighlightDTO[]
  fresh?: ReadonlySet<number>
  onHighlightClick?(id: number): void
  onHighlightHover?(id: number, el: HTMLElement): void
  onHighlightLeave?(): void
  className: string
  /** 번역이 막 도착했을 때 위에서부터 차례로 인쇄되듯 나타나게 하는 지연(ms) */
  revealDelay?: number
}) {
  const mine = highlights.filter((h) => h.paragraph === para && h.variant === variant)
  return (
    <p
      data-para={para}
      data-variant={variant}
      lang={variant === 'ko' ? 'ko' : 'en'}
      className={cn(className, revealDelay !== undefined && 'animate-ink-in')}
      // 지연은 문단 순서에 따라 실행 중에 정해지는 값이라 인라인 style로 준다
      style={revealDelay !== undefined ? { animationDelay: `${revealDelay}ms` } : undefined}
    >
      {mine.length === 0
        ? text
        : segments(text, mine).map((seg, i) =>
            seg.highlightId === null ? (
              seg.text
            ) : (
              <mark
                key={i}
                // 메모가 있으면 끝에 ✎ 표시 (app.css의 .marker[data-note])
                data-note={highlights.find((h) => h.id === seg.highlightId)?.note ? '' : undefined}
                onClick={() => onHighlightClick?.(seg.highlightId!)}
                onPointerEnter={(e) => onHighlightHover?.(seg.highlightId!, e.currentTarget)}
                onPointerLeave={() => onHighlightLeave?.()}
                className={cn('marker cursor-pointer bg-transparent text-inherit', fresh?.has(seg.highlightId) && 'animate-marker')}
              >
                {seg.text}
              </mark>
            )
          )}
    </p>
  )
}

function scrollToCenter(el: HTMLElement): void {
  let box = el.parentElement
  while (box && !(/(auto|scroll)/.test(getComputedStyle(box).overflowY) && box.scrollHeight > box.clientHeight)) {
    box = box.parentElement
  }
  if (!box) return
  const offset = el.getBoundingClientRect().top - box.getBoundingClientRect().top
  box.scrollTo({ top: box.scrollTop + offset - box.clientHeight / 3, behavior: 'smooth' })
}

/**
 * 읽기 모드 본문. 문단마다 번호(¶)를 붙인다 — 하이라이트와 AI 답변 인용의 기준이 된다.
 * 번역은 문단 단위라 번호가 원문과 같다. 번역하지 않은 문단(아주 긴 기사의 뒷부분)은 원문으로 보여준다.
 */
export function ArticleBody({
  paragraphs,
  fullText,
  paragraphsKo = null,
  mode = 'ko',
  focus = null,
  focusSeq = 0,
  highlights = [],
  freshHighlightIds,
  onHighlightClick,
  onHighlightHover,
  onHighlightLeave
}: Props) {
  // 원문을 보여주던 중에 번역이 도착하면, 번역 문단을 위에서부터 차례로 나타나게 한다
  const prev = useRef({ paragraphs, paragraphsKo })
  const [reveal, setReveal] = useState(false)
  useEffect(() => {
    const before = prev.current
    if (before.paragraphs !== paragraphs) setReveal(false)
    if (before.paragraphs !== null && before.paragraphs.length === paragraphs?.length && !before.paragraphsKo && paragraphsKo) setReveal(true)
    prev.current = { paragraphs, paragraphsKo }
  }, [paragraphs, paragraphsKo])

  // 인용한 문단으로 스크롤한다 (문단이 그려진 뒤에). 가장 가까운 스크롤 상자만 움직인다
  useEffect(() => {
    if (focus === null || !paragraphs) return
    const el = document.getElementById(`p-${focus}`)
    if (el) scrollToCenter(el)
  }, [focus, focusSeq, paragraphs])

  if (paragraphs === null) return <SkeletonParagraphs />
  if (paragraphs.length === 0) return <Caption>보관된 본문이 없습니다. 기사를 저장하면 원문에서 본문을 가져옵니다.</Caption>
  const ko = mode !== 'original' ? paragraphsKo : null
  const untranslated = ko ? ko.filter((t) => t === null).length : 0
  return (
    <div className="flex flex-col gap-3">
      {!fullText && <Caption>원문 본문을 가져오지 못해 요약·초록만 있습니다.</Caption>}
      {untranslated > 0 && (
        <Caption>문단 {untranslated}개는 번역하지 않아 원문으로 보여줍니다. 아주 긴 기사는 앞부분만 번역합니다.</Caption>
      )}
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {paragraphs.map((p, i) => {
          const t = ko?.[i] ?? null
          const shown: HighlightVariant[] = t ? (mode === 'both' ? ['ko', 'original'] : ['ko']) : ['original']
          // 여백 교정 표시: 하이라이트가 있는 문단은 ¶ 옆에 강조색 괘선. 지금 보이지 않는 판에만 있으면 옅게
          const mine = highlights.filter((h) => h.paragraph === i + 1)
          const marked = mine.length > 0
          const onlyHidden = marked && mine.every((h) => !shown.includes(h.variant))
          const focused = focus === i + 1
          return (
            <li
              // 짚어 준 문단은 누를 때마다 다시 그려서 형광 잔상이 다시 보이게 한다
              key={focused ? `${i}-${focusSeq}` : i}
              id={`p-${i + 1}`}
              className={cn('relative -mx-2 flex gap-3 px-2 py-1', focused && 'animate-flash')}
            >
              {marked && (
                <span
                  aria-hidden="true"
                  title={onlyHidden ? (t && mode !== 'original' ? '원문에 그은 하이라이트가 있습니다' : '번역문에 그은 하이라이트가 있습니다') : undefined}
                  className={cn('absolute top-1.5 bottom-1.5 -left-1 w-0.5', onlyHidden ? 'bg-accent/35' : 'bg-accent')}
                />
              )}
              <span
                className={cn(
                  'w-7 flex-none pt-0.5 text-right font-display text-caption tabular-nums',
                  marked ? 'text-accent' : 'text-ink-faint'
                )}
              >
                ¶{i + 1}
              </span>
              <div className="flex min-w-0 flex-col gap-1.5">
                <ParagraphText
                  text={t ?? p}
                  para={i + 1}
                  variant={t ? 'ko' : 'original'}
                  highlights={highlights}
                  fresh={freshHighlightIds}
                  onHighlightClick={onHighlightClick}
                  onHighlightHover={onHighlightHover}
                  onHighlightLeave={onHighlightLeave}
                  className="text-reading text-ink-body"
                  revealDelay={reveal && t ? Math.min(i * 20, 600) : undefined}
                />
                {mode === 'both' && t && (
                  <ParagraphText
                    text={p}
                    para={i + 1}
                    variant="original"
                    highlights={highlights}
                    fresh={freshHighlightIds}
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
