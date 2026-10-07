import { useCallback, useEffect, useState } from 'react'
import type { DigestDTO, DigestSummaryDTO, LibraryItemDTO } from '@shared/types'
import { EmptyState } from '../components/app/Notice'
import { ListHeader } from '../components/app/ListHeader'
import { SinglePane } from '../components/layout/AppShell'
import { Button } from '../components/ui/Button'
import { SearchInput } from '../components/ui/SearchInput'
import { api } from '../lib/api'
import type { ArticleView } from '../lib/article'
import { formatKoreanDate } from '../lib/format'
import { DigestView } from '../views/DigestView'
import { ItemListView } from '../views/ItemListView'

/** 아카이브: 날짜별 지난 브리핑. 검색하면 지금까지 브리핑에 실린 모든 기사에서 찾는다 */
export function ArchivePage() {
  const [digests, setDigests] = useState<DigestSummaryDTO[] | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LibraryItemDTO[]>([])
  const [opened, setOpened] = useState<DigestDTO | null>(null)

  useEffect(() => {
    void api.listDigests().then(setDigests)
  }, [])

  useEffect(() => {
    if (!query) return setResults([])
    void api.search({ scope: 'published', query }).then(setResults)
  }, [query])

  const open = async (date: string) => setOpened(await api.getDigest(date))

  const patchOpened = useCallback((itemId: number, p: Partial<ArticleView>) => {
    setOpened((d) => (d ? { ...d, entries: d.entries.map((e) => (e.itemId === itemId ? { ...e, ...p } : e)) } : d))
  }, [])

  const patchResults = useCallback((itemId: number, p: Partial<ArticleView>) => {
    setResults((list) => list.map((it) => (it.itemId === itemId ? { ...it, ...p } : it)))
  }, [])

  if (!digests) return null

  if (opened) {
    return (
      <DigestView
        digest={opened}
        onPatch={patchOpened}
        headerActions={
          <div className="mt-1">
            <Button variant="text" onClick={() => setOpened(null)}>
              ← 아카이브로
            </Button>
          </div>
        }
      />
    )
  }

  const search = <SearchInput value={query} onChange={setQuery} label="아카이브 검색" placeholder="지금까지 브리핑에 실린 기사에서 찾기" />

  if (query) {
    return (
      <ItemListView
        header={
          <ListHeader title="아카이브" meta={`검색 결과 ${results.length}건`}>
            {search}
          </ListHeader>
        }
        items={results}
        onPatch={patchResults}
        defaultTool="body"
        empty={<EmptyState title="찾는 기사가 없습니다">다른 검색어로 찾아 보세요.</EmptyState>}
      />
    )
  }

  return (
    <SinglePane label="아카이브">
      <div className="flex max-w-190 flex-col gap-2 px-7 pt-6 pb-7">
        <ListHeader title="아카이브" meta={`${digests.length}호`}>
          {search}
        </ListHeader>
        {digests.length === 0 ? (
          <EmptyState title="아직 지난 브리핑이 없습니다" />
        ) : (
          <ol className="m-0 list-none p-0">
            {digests.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => void open(d.date)}
                  className="flex w-full cursor-pointer flex-col gap-1 border-0 border-b border-rule bg-transparent py-4 text-left hover:bg-paper-sunken/50"
                >
                  <span className="flex flex-wrap justify-between gap-2 text-meta font-medium tracking-dateline text-ink-muted tabular-nums">
                    <span>{formatKoreanDate(d.date)}</span>
                    <span>
                      {d.entries}건{d.saved ? ` · 저장 ${d.saved}` : ''}
                    </span>
                  </span>
                  <span className="font-display text-title font-semibold text-ink">{d.headline}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </SinglePane>
  )
}
