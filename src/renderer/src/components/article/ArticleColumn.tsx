import type { ReactNode } from 'react'
import { CATEGORY_LABEL } from '@shared/types'
import type { ArticleView } from '../../lib/article'
import { Kicker, Meta, OriginalTitle } from '../ui/Text'
import { WhyItMatters } from './WhyItMatters'

interface Props {
  entry: ArticleView
  onOpenUrl(url: string): void
  /** 제목·요약 아래에 붙는 영역 (저장 버튼 등) */
  children?: ReactNode
}

/** 기사 패널: 신문 칼럼처럼 분류 → 제목 → 원제 → 요약 → 왜 중요한가 */
export function ArticleColumn({ entry, onOpenUrl, children }: Props) {
  return (
    <article className="flex flex-col gap-3">
      <div className="flex flex-wrap justify-between gap-2">
        <Kicker>{CATEGORY_LABEL[entry.category]}</Kicker>
        <Meta>
          {entry.sourceName}
          {entry.engagementLabel ? ` · ${entry.engagementLabel}` : ''}
          {entry.otherSources.length ? ` 외 ${entry.otherSources.length}곳` : ''}
        </Meta>
      </div>
      <div className="flex flex-col gap-1 border-b border-rule pb-3">
        <h2 className="font-display text-headline font-bold tracking-tight">{entry.titleKo}</h2>
        <OriginalTitle>{entry.originalTitle}</OriginalTitle>
      </div>
      <p className="text-reading text-ink-body">{entry.summaryKo}</p>
      {entry.keyPoints.length > 0 && (
        <ul className="m-0 list-disc space-y-1 pl-5 text-ink-secondary">
          {entry.keyPoints.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {entry.whyItMatters && <WhyItMatters>{entry.whyItMatters}</WhyItMatters>}
      {entry.otherSources.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-meta text-ink-muted">
          <span>같은 소식:</span>
          {entry.otherSources.map((s) => (
            <button
              key={s.url}
              type="button"
              onClick={() => onOpenUrl(s.url)}
              className="cursor-pointer border-0 bg-transparent p-0 text-meta text-ink-secondary underline underline-offset-3 hover:text-accent"
            >
              {s.sourceName}
              {s.engagementLabel ? ` (${s.engagementLabel})` : ''}
            </button>
          ))}
        </div>
      )}
      {children}
    </article>
  )
}
