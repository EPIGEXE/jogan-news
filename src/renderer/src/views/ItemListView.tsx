import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ItemDetailDTO, LibraryItemDTO } from '@shared/types'
import { ArticleDetail, type ToolTab } from '../components/article/ArticleDetail'
import { LibraryRow } from '../components/article/LibraryRow'
import { DetailPane, ListPane } from '../components/layout/AppShell'
import { KeyboardHints } from '../components/ui/KeyboardHints'
import { makeArticleHandlers, useItemDetail, type ArticleView } from '../lib/article'
import { useListKeys } from '../lib/useListKeys'

const HINTS = [
  { keys: 'J K', label: '이동' },
  { keys: 'S', label: '저장' },
  { keys: 'M', label: '메모' },
  { keys: 'Enter', label: '원문' }
]

interface Props {
  /** 목록 위 (제목, 검색창, 필터) */
  header: ReactNode
  items: LibraryItemDTO[]
  /** 저장·메모·태그를 목록 상태에 반영 */
  onPatch(itemId: number, patch: Partial<ArticleView>): void
  empty: ReactNode
  /** 처음 고를 탭 (라이브러리는 메모, 아카이브 검색은 본문) */
  defaultTool?: ToolTab
}

/** 기사 목록 + 기사 패널. 라이브러리와 아카이브 검색이 함께 쓴다 */
export function ItemListView({ header, items, onPatch, empty, defaultTool = 'memo' }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [tool, setTool] = useState<ToolTab>(defaultTool)
  const [view, setView] = useState<ItemDetailDTO | null>(null)
  const memoRef = useRef<HTMLTextAreaElement>(null)
  const rowRefs = useRef(new Map<number, HTMLButtonElement>())
  const ids = useMemo(() => items.map((i) => i.itemId), [items])

  const { detail, enriching, setEnriching } = useItemDetail(selectedId, (d) => {
    setView(d)
    onPatch(d.itemId, { tags: d.tags })
  })
  useEffect(() => setView(detail), [detail])

  // 목록이 바뀌면(검색·필터) 첫 기사를 고른다. 고른 기사가 목록에 남아 있으면 그대로 둔다
  useEffect(() => {
    if (selectedId !== null && ids.includes(selectedId)) return
    setSelectedId(ids[0] ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids])

  const patch = useCallback(
    (itemId: number, p: Partial<ArticleView>) => {
      onPatch(itemId, p)
      setView((v) => (v && v.itemId === itemId ? { ...v, ...p } : v))
    },
    [onPatch]
  )

  const select = (id: number, scroll = false) => {
    setSelectedId(id)
    if (scroll) rowRefs.current.get(id)?.scrollIntoView({ block: 'nearest' })
  }

  const handlers = makeArticleHandlers(view, patch, () => setEnriching(true))

  useListKeys({
    ids,
    selectedId,
    onSelect: (id) => select(id, true),
    onSave: handlers?.onToggleSave,
    onMemo: () => {
      setTool('memo')
      setTimeout(() => memoRef.current?.focus(), 0)
    },
    onOpen: view ? () => handlers?.onOpenUrl(view.url) : undefined
  })

  return (
    <>
      <ListPane label="기사 목록">
        <div className="flex min-h-full flex-col px-7 pt-6">
          {header}
          <div className="flex-1 pb-6">
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
                    />
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div className="sticky bottom-0 border-t border-rule bg-paper py-3">
            <KeyboardHints hints={HINTS} />
          </div>
        </div>
      </ListPane>
      <DetailPane label="선택한 기사">
        {view && handlers && (
          <ArticleDetail
            entry={view}
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
