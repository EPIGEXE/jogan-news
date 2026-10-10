import { CATEGORY_LABEL } from '@shared/types'
import type { ArticleView } from '@/domains/article/article'
import { Button } from '@/common/ui/Button'
import { Kicker, Meta, OriginalTitle } from '@/common/ui/Text'
import { TagList } from '@/domains/article/TagList'
import { WhyItMatters } from '@/domains/article/WhyItMatters'

interface Props {
  entry: ArticleView
  onToggleSave(): void
  onOpenOriginal(): void
  onAddTag(name: string): void
  onRemoveTag(name: string): void
  enriching?: boolean
}

/** 옆 패널: 기사 개요만. 읽기 화면은 목록 줄의 "읽기" 버튼(또는 Enter·두 번 누르기)으로 연다 */
export function ArticlePreview({ entry, onToggleSave, onOpenOriginal, onAddTag, onRemoveTag, enriching }: Props) {
  return (
    <article className="flex flex-col gap-4 px-7 py-6">
      <div className="flex flex-col gap-1">
        <Kicker>{CATEGORY_LABEL[entry.category]}</Kicker>
        <Meta>
          {entry.sourceName}
          {entry.engagementLabel ? ` · ${entry.engagementLabel}` : ''}
          {entry.otherSources.length ? ` · 외 ${entry.otherSources.length}곳` : ''}
        </Meta>
      </div>
      <div className="flex flex-col gap-1 border-b border-rule pb-4">
        <h2 className="font-display text-subhead font-bold tracking-tight">{entry.titleKo}</h2>
        <OriginalTitle>{entry.originalTitle}</OriginalTitle>
      </div>
      <p className="text-reading text-ink-body">{entry.summaryKo}</p>
      {entry.whyItMatters && <WhyItMatters>{entry.whyItMatters}</WhyItMatters>}
      <div className="flex flex-wrap gap-2">
        <Button icon="bookmark" iconFilled={entry.isSaved} aria-pressed={entry.isSaved} onClick={onToggleSave} title="저장 (S)">
          {entry.isSaved ? '저장됨' : '저장'}
        </Button>
        <Button variant="text" onClick={onOpenOriginal} title="원문 열기 (O)">
          원문
        </Button>
      </div>
      {(entry.isSaved || entry.tags.length > 0) && <TagList tags={entry.tags} onAdd={onAddTag} onRemove={onRemoveTag} pending={enriching} />}
    </article>
  )
}
