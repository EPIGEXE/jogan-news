import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CATEGORIES, CATEGORY_LABEL, SECTION_LABEL, SECTION_ORDER, type Category, type DigestDTO } from '@shared/types'
import { ArticleDetail, type ToolTab } from '../components/article/ArticleDetail'
import { ArticleGroup } from '../components/article/ArticleGroup'
import { ArticleRow } from '../components/article/ArticleRow'
import { EditionHeader } from '../components/article/EditionHeader'
import { DetailPane, ListPane } from '../components/layout/AppShell'
import { KeyboardHints } from '../components/ui/KeyboardHints'
import { Tabs, type TabItem } from '../components/ui/Tabs'
import { api } from '../lib/api'
import { makeArticleHandlers, useItemDetail, type ArticleView } from '../lib/article'
import { useListKeys } from '../lib/useListKeys'

type Filter = 'all' | Category

const HINTS = [
  { keys: 'J K', label: '이동' },
  { keys: 'S', label: '저장' },
  { keys: 'M', label: '메모' },
  { keys: 'Enter', label: '원문' }
]

interface Props {
  digest: DigestDTO
  /** 저장·메모·태그·읽음을 화면 상태에 반영 (브리핑 상태는 부모가 가진다) */
  onPatch(itemId: number, patch: Partial<ArticleView>): void
  notice?: string
  /** 머리 아래쪽 (다시 만들기 버튼, 진행 상황 등) */
  headerActions?: ReactNode
  /** 머리와 목록 사이 (오류 안내 등) */
  belowHeader?: ReactNode
}

/** 브리핑 한 호: 지면 머리 + 섹션별 목록 + 기사 패널. 오늘 화면과 아카이브가 함께 쓴다 */
export function DigestView({ digest, onPatch, notice, headerActions, belowHeader }: Props) {
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [tool, setTool] = useState<ToolTab>('memo')
  const memoRef = useRef<HTMLTextAreaElement>(null)
  const rowRefs = useRef(new Map<number, HTMLButtonElement>())

  const entries = digest.entries
  const visible = useMemo(() => (filter === 'all' ? entries : entries.filter((e) => e.category === filter)), [entries, filter])
  const groups = useMemo(
    () => SECTION_ORDER.map((section) => ({ section, items: visible.filter((e) => e.section === section) })).filter((g) => g.items.length),
    [visible]
  )
  // 키보드 이동은 화면에 보이는 순서(섹션 순)를 따른다
  const orderedIds = useMemo(() => groups.flatMap((g) => g.items.map((e) => e.itemId)), [groups])
  const selected = entries.find((e) => e.itemId === selectedId) ?? null

  const { detail, enriching, setEnriching } = useItemDetail(selectedId, (d) => onPatch(d.itemId, { tags: d.tags }))

  const filterTabs: TabItem<Filter>[] = useMemo(() => {
    const counts = new Map<Category, number>()
    for (const e of entries) counts.set(e.category, (counts.get(e.category) ?? 0) + 1)
    return [
      { id: 'all' as const, label: `전체 ${entries.length}` },
      ...CATEGORIES.filter((c) => counts.get(c)).map((c) => ({ id: c, label: `${CATEGORY_LABEL[c]} ${counts.get(c)}` }))
    ]
  }, [entries])

  const select = useCallback(
    (itemId: number, scroll = false) => {
      setSelectedId(itemId)
      // 키보드로 옮길 때만 목록을 따라 스크롤한다. 첫 자동 선택이나 클릭에서는 화면을 움직이지 않는다.
      if (scroll) rowRefs.current.get(itemId)?.scrollIntoView({ block: 'nearest' })
      const e = entries.find((x) => x.itemId === itemId)
      if (e && !e.isRead) {
        onPatch(itemId, { isRead: true })
        void api.markRead(itemId)
      }
    },
    [entries, onPatch]
  )

  // 브리핑이나 필터가 바뀌면 첫 기사를 고른다
  useEffect(() => {
    if (orderedIds.length && (selectedId === null || !orderedIds.includes(selectedId))) select(orderedIds[0]!)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digest.id, filter])

  const handlers = makeArticleHandlers(selected, onPatch, () => setEnriching(true))

  useListKeys({
    ids: orderedIds,
    selectedId,
    onSelect: (id) => select(id, true),
    onSave: handlers?.onToggleSave,
    onMemo: () => {
      setTool('memo')
      setTimeout(() => memoRef.current?.focus(), 0)
    },
    onOpen: selected ? () => handlers?.onOpenUrl(selected.url) : undefined
  })

  return (
    <>
      <ListPane label="기사 목록">
        <div className="flex min-h-full flex-col px-7 pt-6">
          <EditionHeader
            date={digest.date}
            createdAt={digest.createdAt}
            headline={digest.headline}
            overview={digest.overview}
            stats={digest.stats}
            notice={notice}
            actions={headerActions}
          />
          {belowHeader}
          <div className="border-b border-rule py-3">
            <Tabs items={filterTabs} value={filter} onChange={setFilter} label="분류" />
          </div>
          <div className="flex-1 pb-6">
            {groups.map((g) => (
              <ArticleGroup key={g.section} label={SECTION_LABEL[g.section]}>
                {g.items.map((e) => (
                  <li key={e.itemId}>
                    <ArticleRow
                      ref={(el) => {
                        if (el) rowRefs.current.set(e.itemId, el)
                        else rowRefs.current.delete(e.itemId)
                      }}
                      entry={e}
                      selected={e.itemId === selectedId}
                      onSelect={() => select(e.itemId)}
                    />
                  </li>
                ))}
              </ArticleGroup>
            ))}
          </div>
          <div className="sticky bottom-0 border-t border-rule bg-paper py-3">
            <KeyboardHints hints={HINTS} />
          </div>
        </div>
      </ListPane>
      <DetailPane label="선택한 기사">
        {selected && handlers && (
          <ArticleDetail
            entry={selected}
            body={detail}
            tool={tool}
            onToolChange={setTool}
            memoRef={memoRef}
            enriching={enriching}
            {...handlers}
          />
        )}
      </DetailPane>
    </>
  )
}
