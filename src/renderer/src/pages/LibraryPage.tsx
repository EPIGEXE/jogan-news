import { useCallback, useEffect, useState } from 'react'
import type { LibraryItemDTO, TagCount } from '@shared/types'
import { EmptyState } from '../components/app/Notice'
import { ListHeader } from '../components/app/ListHeader'
import { SearchInput } from '../components/ui/SearchInput'
import { Tabs } from '../components/ui/Tabs'
import { Tag } from '../components/ui/Tag'
import { api } from '../lib/api'
import type { ArticleView } from '../lib/article'
import { ItemListView } from '../views/ItemListView'

type Filter = 'all' | 'memo'

/** 라이브러리: 저장한 기사. 검색, 메모 있는 기사, 태그로 거른다 */
export function LibraryPage() {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [tag, setTag] = useState<string | null>(null)
  const [items, setItems] = useState<LibraryItemDTO[] | null>(null)
  const [tags, setTags] = useState<TagCount[]>([])
  const [total, setTotal] = useState(0)

  const load = useCallback(async () => {
    const [found, all, tagList] = await Promise.all([
      api.search({ scope: 'saved', query, memoOnly: filter === 'memo', tag: tag ?? undefined }),
      api.search({ scope: 'saved' }),
      api.listTags()
    ])
    setItems(found)
    setTotal(all.length)
    setTags(tagList)
    // 고른 태그가 더는 없으면 필터를 푼다
    if (tag && !tagList.some((t) => t.name === tag)) setTag(null)
  }, [query, filter, tag])

  useEffect(() => {
    void load()
  }, [load])

  // 뒤에서 태그 추천이 끝나면 태그 목록을 새로 읽는다
  useEffect(() => api.onItemUpdated(() => void api.listTags().then(setTags)), [])

  const patch = useCallback((itemId: number, p: Partial<ArticleView>) => {
    setItems((list) => list?.map((it) => (it.itemId === itemId ? { ...it, ...p } : it)) ?? list)
    if (p.tags) void api.listTags().then(setTags)
  }, [])

  if (!items) return null

  const filtered = query || filter === 'memo' || tag
  const header = (
    <ListHeader title="라이브러리" meta={filtered ? `${items.length} / ${total}건` : `${total}건`}>
      <SearchInput value={query} onChange={setQuery} label="라이브러리 검색" placeholder="제목·요약·본문·메모에서 찾기" />
      <Tabs
        items={[
          { id: 'all', label: '전체' },
          { id: 'memo', label: '메모 있는 기사' }
        ]}
        value={filter}
        onChange={setFilter}
        label="보기"
      />
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {tags.map((t) => (
            <Tag key={t.name} name={t.name} count={t.count} selected={tag === t.name} onSelect={() => setTag(tag === t.name ? null : t.name)} />
          ))}
        </div>
      )}
    </ListHeader>
  )

  return (
    <ItemListView
      header={header}
      items={items}
      onPatch={patch}
      empty={
        total === 0 ? (
          <EmptyState title="저장한 기사가 없습니다">
            오늘 브리핑에서 저장(S)하거나 메모를 쓰면 여기에 모입니다. 저장하면 원문 본문도 함께 보관하고 태그를 추천합니다.
          </EmptyState>
        ) : (
          <EmptyState title="찾는 기사가 없습니다">검색어나 필터를 바꿔 보세요.</EmptyState>
        )
      }
    />
  )
}
