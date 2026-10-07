import type { Ref } from 'react'
import type { ArticleView } from '../../lib/article'
import { Tabs, type TabItem } from '../ui/Tabs'
import { ArticleActions } from './ArticleActions'
import { ArticleBody } from './ArticleBody'
import { ArticleColumn } from './ArticleColumn'
import { MemoPad } from './MemoPad'
import { TagList } from './TagList'

export type ToolTab = 'memo' | 'body' | 'ask' | 'highlights'

const TOOL_TABS: TabItem<ToolTab>[] = [
  { id: 'memo', label: '메모' },
  { id: 'body', label: '본문' },
  { id: 'ask', label: '질문', disabled: true, title: '4단계에서 제공' },
  { id: 'highlights', label: '하이라이트', disabled: true, title: '6단계에서 제공' }
]

export interface ArticleHandlers {
  onToggleSave(): void
  onSaveMemo(body: string): Promise<{ savedAt: string }>
  onAddTag(name: string): void
  onRemoveTag(name: string): void
  onOpenUrl(url: string): void
}

interface Props extends ArticleHandlers {
  entry: ArticleView
  /** 본문 탭 내용. null이면 불러오는 중 */
  body: { paragraphs: string[]; fullText: boolean } | null
  tool: ToolTab
  onToolChange(tool: ToolTab): void
  memoRef?: Ref<HTMLTextAreaElement>
  /** 저장 직후 뒤에서 본문 추출·태그 추천이 도는 중 */
  enriching?: boolean
}

/** 오른쪽 기사 패널: 칼럼(제목·요약·왜 중요한가) + 저장·원문 + 태그 + 메모/본문 탭 */
export function ArticleDetail({ entry, body, tool, onToolChange, memoRef, enriching, ...h }: Props) {
  return (
    <div className="flex flex-col gap-4 px-7 py-6">
      <ArticleColumn entry={entry} onOpenUrl={h.onOpenUrl}>
        <ArticleActions saved={entry.isSaved} onToggleSave={h.onToggleSave} onOpenOriginal={() => h.onOpenUrl(entry.url)} />
        {(entry.isSaved || entry.tags.length > 0) && (
          <TagList tags={entry.tags} onAdd={h.onAddTag} onRemove={h.onRemoveTag} pending={enriching} />
        )}
      </ArticleColumn>
      <Tabs items={TOOL_TABS} value={tool} onChange={onToolChange} label="기사 도구" tone="display" />
      {tool === 'memo' && <MemoPad ref={memoRef} itemId={entry.itemId} initial={entry.memo} onSave={h.onSaveMemo} />}
      {tool === 'body' && <ArticleBody paragraphs={body?.paragraphs ?? null} fullText={body?.fullText ?? false} />}
    </div>
  )
}
