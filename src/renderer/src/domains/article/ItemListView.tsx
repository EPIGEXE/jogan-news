import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { LibraryItemDTO } from '@shared/types'
import { ArticlePreview } from '@/domains/article/ArticlePreview'
import { LibraryRow } from '@/domains/article/LibraryRow'
import { DetailPane, ListPane } from '@/common/layout/AppShell'
import { SkeletonParagraphs } from '@/common/ui/Skeleton'
import { useArticleActions, useEnriching, useItemDetail } from '@/domains/article/queries'
import { useListKeys } from '@/common/lib/useListKeys'
import { ArticleReader } from '@/domains/article/ArticleReader'

interface Props {
  /** 목록 위 (제목, 검색창, 필터) */
  header: ReactNode
  items: LibraryItemDTO[]
  empty: ReactNode
  /** 읽기 화면의 "← …" 글자 */
  backLabel: string
}

/** 기사 목록 + 옆 패널(개요) + 읽기 화면. 라이브러리와 아카이브 검색이 함께 쓴다 */
export function ItemListView({ header, items, empty, backLabel }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [reading, setReading] = useState(false)
  const rowRefs = useRef(new Map<number, HTMLButtonElement>())
  const ids = useMemo(() => items.map((i) => i.itemId), [items])

  // 목록 행에는 요약·핵심 포인트가 없어서, 고른 기사의 상세를 불러와 개요·읽기 화면에 쓴다 (캐시에 있으면 바로)
  const view = useItemDetail(selectedId).data ?? null
  const enriching = useEnriching(selectedId)

  // 목록이 바뀌면(검색·필터) 첫 기사를 고른다. 고른 기사가 목록에 남아 있으면 그대로 둔다
  useEffect(() => {
    if (selectedId !== null && ids.includes(selectedId)) return
    setSelectedId(ids[0] ?? null)
    setReading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids])

  const select = (id: number, scroll = false) => {
    setSelectedId(id)
    if (scroll) setTimeout(() => rowRefs.current.get(id)?.scrollIntoView({ block: 'nearest' }), 0)
  }

  const handlers = useArticleActions(view)

  useListKeys({
    ids,
    selectedId,
    onSelect: (id) => select(id, true),
    onSave: handlers?.onToggleSave,
    onOpen: view ? () => setReading(true) : undefined,
    onOriginal: view ? () => handlers?.onOpenUrl(view.url) : undefined,
    enabled: !reading
  })

  if (reading && view) {
    const i = ids.indexOf(view.itemId)
    const neighbor = (id: number | undefined) => {
      const it = items.find((x) => x.itemId === id)
      return it ? { title: it.titleKo, go: () => select(it.itemId) } : undefined
    }
    return (
      <ArticleReader
        entry={view}
        onBack={() => {
          setReading(false)
          setTimeout(() => rowRefs.current.get(view.itemId)?.scrollIntoView({ block: 'nearest' }), 0)
        }}
        backLabel={backLabel}
        prev={neighbor(ids[i - 1])}
        next={neighbor(ids[i + 1])}
      />
    )
  }

  return (
    <>
      <ListPane label="기사 목록">
        <div className="flex min-h-full flex-col px-7 pt-6">
          {header}
          <div className="flex-1 pb-8">
            {items.length === 0 ? (
              empty
            ) : (
              <ol className="-mx-3 mt-2 list-none p-0">
                {items.map((it) => (
                  <li key={it.itemId}>
                    <LibraryRow
                      ref={(el) => {
                        if (el) rowRefs.current.set(it.itemId, el)
                        else rowRefs.current.delete(it.itemId)
                      }}
                      item={it}
                      selected={it.itemId === selectedId}
                      onSelect={() => select(it.itemId)}
                      onOpen={() => {
                        select(it.itemId)
                        setReading(true)
                      }}
                    />
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </ListPane>
      <DetailPane label="선택한 기사">
        {selectedId !== null && !view && (
          <div className="px-7 py-6">
            <SkeletonParagraphs count={3} />
          </div>
        )}
        {view && handlers && (
          <ArticlePreview
            entry={view}
            onToggleSave={handlers.onToggleSave}
            onOpenOriginal={() => handlers.onOpenUrl(view.url)}
            onAddTag={handlers.onAddTag}
            onRemoveTag={handlers.onRemoveTag}
            enriching={enriching}
          />
        )}
      </DetailPane>
    </>
  )
}
