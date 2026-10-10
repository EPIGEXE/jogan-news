import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CATEGORIES, CATEGORY_SHORT, SECTION_LABEL, SECTION_ORDER, type Category, type DigestDTO } from '@shared/types'
import { ArticleGroup } from '@/domains/article/ArticleGroup'
import { ArticlePreview } from '@/domains/article/ArticlePreview'
import { ArticleRow } from '@/domains/article/ArticleRow'
import { EditionHeader } from '@/domains/digest/EditionHeader'
import { DetailPane, ListPane } from '@/common/layout/AppShell'
import { Tabs, type TabItem } from '@/common/ui/Tabs'
import { useArticleActions, useEnriching, useMarkRead } from '@/domains/article/queries'
import { useListKeys } from '@/common/lib/useListKeys'
import { ArticleReader } from '@/domains/article/ArticleReader'

type Filter = 'all' | Category

interface Props {
  digest: DigestDTO
  notice?: string
  /** 머리 아래쪽 (오늘 브리핑 만들기 버튼 등) */
  headerActions?: ReactNode
  /** 머리와 목록 사이 (진행 상황, 오류 안내 등) */
  belowHeader?: ReactNode
  /** 다른 화면에서 이 기사를 열어 달라고 할 때 (질문 화면의 인용 등) */
  focusItemId?: number | null
  onFocusHandled?(): void
  /** 읽기 화면의 "← …" 글자 */
  backLabel?: string
  /** 방금 만들어진 브리핑 (지면 머리 이중선이 그어지는 움직임) */
  fresh?: boolean
}

/**
 * 브리핑 한 호: 지면 머리 + 섹션별 목록 + 옆 패널(개요). "기사 읽기"를 누르면 읽기 화면으로 바뀐다.
 * 오늘 화면과 아카이브가 함께 쓴다.
 */
export function DigestView(p: Props) {
  const { digest } = p
  const markRead = useMarkRead()
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [readingId, setReadingId] = useState<number | null>(null)
  const rowRefs = useRef(new Map<number, HTMLButtonElement>())

  const entries = digest.entries
  const visible = useMemo(() => (filter === 'all' ? entries : entries.filter((e) => e.category === filter)), [entries, filter])
  const groups = useMemo(
    () => SECTION_ORDER.map((section) => ({ section, items: visible.filter((e) => e.section === section) })).filter((g) => g.items.length),
    [visible]
  )
  // 이동은 화면에 보이는 순서(섹션 순)를 따른다
  const orderedIds = useMemo(() => groups.flatMap((g) => g.items.map((e) => e.itemId)), [groups])
  const selected = entries.find((e) => e.itemId === selectedId) ?? null
  const reading = entries.find((e) => e.itemId === readingId) ?? null

  const enriching = useEnriching(selectedId)

  const filterTabs: TabItem<Filter>[] = useMemo(() => {
    const counts = new Map<Category, number>()
    for (const e of entries) counts.set(e.category, (counts.get(e.category) ?? 0) + 1)
    return [
      { id: 'all' as const, label: `전체 ${entries.length}` },
      ...CATEGORIES.filter((c) => counts.get(c)).map((c) => ({ id: c, label: `${CATEGORY_SHORT[c]} ${counts.get(c)}` }))
    ]
  }, [entries])

  const select = useCallback(
    (itemId: number, scroll = false) => {
      setSelectedId(itemId)
      // 키보드로 옮길 때만 목록을 따라 스크롤한다. 첫 자동 선택이나 클릭에서는 화면을 움직이지 않는다.
      if (scroll) setTimeout(() => rowRefs.current.get(itemId)?.scrollIntoView({ block: 'nearest' }), 0)
      const e = entries.find((x) => x.itemId === itemId)
      if (e && !e.isRead) markRead(itemId)
    },
    [entries, markRead]
  )

  const read = useCallback(
    (itemId: number) => {
      select(itemId)
      setReadingId(itemId)
    },
    [select]
  )

  // 브리핑이나 필터가 바뀌면 첫 기사를 고른다
  useEffect(() => {
    if (orderedIds.length && (selectedId === null || !orderedIds.includes(selectedId))) select(orderedIds[0]!)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digest.id, filter])

  // 다른 화면에서 고른 기사를 바로 읽기 화면으로 연다 (필터를 풀어서)
  useEffect(() => {
    if (p.focusItemId == null || !entries.some((e) => e.itemId === p.focusItemId)) return
    setFilter('all')
    read(p.focusItemId)
    p.onFocusHandled?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.focusItemId, digest.id])

  const handlers = useArticleActions(selected)

  useListKeys({
    ids: orderedIds,
    selectedId,
    onSelect: (id) => select(id, true),
    onSave: handlers?.onToggleSave,
    onOpen: selected ? () => read(selected.itemId) : undefined,
    onOriginal: selected ? () => handlers?.onOpenUrl(selected.url) : undefined,
    enabled: readingId === null
  })

  if (reading) {
    const i = orderedIds.indexOf(reading.itemId)
    const neighbor = (id: number | undefined) => {
      const e = entries.find((x) => x.itemId === id)
      return e ? { title: e.titleKo, go: () => read(e.itemId) } : undefined
    }
    return (
      <ArticleReader
        entry={reading}
        onBack={() => {
          setReadingId(null)
          setTimeout(() => rowRefs.current.get(reading.itemId)?.scrollIntoView({ block: 'nearest' }), 0)
        }}
        backLabel={p.backLabel ?? '목록으로'}
        prev={neighbor(orderedIds[i - 1])}
        next={neighbor(orderedIds[i + 1])}
      />
    )
  }

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
            notice={p.notice}
            actions={p.headerActions}
            fresh={p.fresh}
          />
          {p.belowHeader}
          <div className="border-b border-rule py-3">
            <Tabs items={filterTabs} value={filter} onChange={setFilter} label="분류" scroll />
          </div>
          <div className="flex-1 pb-8">
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
                      onOpen={() => read(e.itemId)}
                    />
                  </li>
                ))}
              </ArticleGroup>
            ))}
          </div>
        </div>
      </ListPane>
      <DetailPane label="선택한 기사">
        {selected && handlers && (
          <ArticlePreview
            entry={selected}
            onToggleSave={handlers.onToggleSave}
            onOpenOriginal={() => handlers.onOpenUrl(selected.url)}
            onAddTag={handlers.onAddTag}
            onRemoveTag={handlers.onRemoveTag}
            enriching={enriching}
          />
        )}
      </DetailPane>
    </>
  )
}
