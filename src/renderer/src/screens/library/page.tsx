import { useEffect, useState } from 'react'
import { EmptyState } from '@/common/ui/Notice'
import { ListHeader } from '@/common/layout/ListHeader'
import { SinglePane } from '@/common/layout/AppShell'
import { SearchInput } from '@/common/ui/SearchInput'
import { SkeletonList } from '@/common/ui/Skeleton'
import { Tabs } from '@/common/ui/Tabs'
import { Tag } from '@/common/ui/Tag'
import { useSearch, useTags } from '@/domains/article/queries'
import { ItemListView } from '@/domains/article/ItemListView'

type Filter = 'all' | 'memo'

/** 라이브러리: 저장한 기사. 검색, 메모 있는 기사, 태그로 거른다 */
export function LibraryPage() {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [tag, setTag] = useState<string | null>(null)
  const items = useSearch({ scope: 'saved', query, memoOnly: filter === 'memo', tag: tag ?? undefined }).data ?? null
  const total = useSearch({ scope: 'saved' }).data?.length ?? 0
  const tagsQuery = useTags()
  const tags = tagsQuery.data ?? []

  // 고른 태그가 더는 없으면(마지막 기사에서 떼면) 필터를 푼다
  useEffect(() => {
    if (tag && tagsQuery.data && !tagsQuery.data.some((t) => t.name === tag)) setTag(null)
  }, [tag, tagsQuery.data])

  if (!items) {
    return (
      <SinglePane label="라이브러리">
        <div className="max-w-190 px-7 py-6">
          <SkeletonList />
        </div>
      </SinglePane>
    )
  }

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
      backLabel="라이브러리로"
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
