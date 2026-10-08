import { useCallback, useEffect, useRef, useState } from 'react'
import type { DigestDTO, DigestSummaryDTO, LibraryItemDTO } from '@shared/types'
import { RowReadButton } from '../components/article/RowReadButton'
import { EmptyState } from '../components/app/Notice'
import { ListHeader } from '../components/app/ListHeader'
import { SinglePane } from '../components/layout/AppShell'
import { Button } from '../components/ui/Button'
import { SearchInput } from '../components/ui/SearchInput'
import { SkeletonList } from '../components/ui/Skeleton'
import { api } from '../lib/api'
import type { ArticleView } from '../lib/article'
import { formatKoreanDate } from '../lib/format'
import { useListKeys } from '../lib/useListKeys'
import { DigestView } from '../views/DigestView'
import { ItemListView } from '../views/ItemListView'

/**
 * 아카이브: 날짜별 지난 브리핑 목록(화면 폭 전체). 다른 목록처럼 J/K로 고르고 Enter·"보기"로 그날 지면을 연다.
 * 검색하면 지금까지 브리핑에 실린 모든 기사에서 찾는다.
 */
export function ArchivePage() {
  const [digests, setDigests] = useState<DigestSummaryDTO[] | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LibraryItemDTO[]>([])
  const [opened, setOpened] = useState<DigestDTO | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())

  useEffect(() => {
    void api.listDigests().then((list) => {
      setDigests(list)
      setSelectedDate((d) => d ?? list[0]?.date ?? null)
    })
  }, [])

  const ids = (digests ?? []).map((d) => d.id)
  const dateOf = (id: number) => digests?.find((d) => d.id === id)?.date ?? null
  const selectedId = digests?.find((d) => d.date === selectedDate)?.id ?? null
  const selectById = useCallback(
    (id: number) => {
      const date = digests?.find((d) => d.id === id)?.date
      if (!date) return
      setSelectedDate(date)
      rowRefs.current.get(date)?.scrollIntoView({ block: 'nearest' })
    },
    [digests]
  )

  useEffect(() => {
    if (!query) return setResults([])
    void api.search({ scope: 'published', query }).then(setResults)
  }, [query])

  const open = async (date: string) => setOpened(await api.getDigest(date))

  useListKeys({
    ids,
    selectedId,
    onSelect: selectById,
    onOpen: selectedId !== null ? () => void open(dateOf(selectedId)!) : undefined,
    enabled: !opened && !query
  })

  const patchOpened = useCallback((itemId: number, p: Partial<ArticleView>) => {
    setOpened((d) => (d ? { ...d, entries: d.entries.map((e) => (e.itemId === itemId ? { ...e, ...p } : e)) } : d))
  }, [])

  const patchResults = useCallback((itemId: number, p: Partial<ArticleView>) => {
    setResults((list) => list.map((it) => (it.itemId === itemId ? { ...it, ...p } : it)))
  }, [])

  if (!digests) {
    return (
      <SinglePane label="아카이브">
        <div className="max-w-190 px-7 py-6">
          <SkeletonList />
        </div>
      </SinglePane>
    )
  }

  if (opened) {
    return (
      <DigestView
        digest={opened}
        onPatch={patchOpened}
        backLabel="그날 목록으로"
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
        backLabel="검색 결과로"
        empty={<EmptyState title="찾는 기사가 없습니다">다른 검색어로 찾아 보세요.</EmptyState>}
      />
    )
  }

  return (
    <SinglePane label="아카이브">
      <div className="flex flex-col gap-2 px-7 pt-6 pb-7">
        <ListHeader title="아카이브" meta={`${digests.length}호`}>
          {search}
        </ListHeader>
        {digests.length === 0 ? (
          <EmptyState title="아직 지난 브리핑이 없습니다" />
        ) : (
          <ol className="m-0 list-none p-0">
            {digests.map((d) => {
              const selected = d.date === selectedDate
              return (
                <li key={d.id} className="group/row relative">
                  <button
                    ref={(el) => {
                      if (el) rowRefs.current.set(d.date, el)
                      else rowRefs.current.delete(d.date)
                    }}
                    type="button"
                    aria-current={selected ? 'true' : undefined}
                    data-selected={selected || undefined}
                    onClick={() => setSelectedDate(d.date)}
                    onDoubleClick={() => void open(d.date)}
                    className="relative flex w-full cursor-pointer flex-col gap-1 border-0 border-b border-rule-soft bg-transparent py-4 pr-24 pl-3 text-left transition-colors duration-120 hover:bg-paper-sunken/50 data-selected:bg-paper-sunken before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:origin-top before:scale-y-0 before:bg-accent before:transition-transform before:duration-200 before:ease-ink data-selected:before:scale-y-100"
                  >
                    <span className="flex flex-wrap gap-x-3 gap-y-1 text-meta font-medium tracking-dateline text-ink-muted tabular-nums">
                      <span>{formatKoreanDate(d.date)}</span>
                      <span>
                        {d.entries}건{d.saved ? ` · 저장 ${d.saved}` : ''}
                      </span>
                    </span>
                    <span className="font-display text-title font-semibold text-ink">{d.headline}</span>
                  </button>
                  <RowReadButton selected={selected} onClick={() => void open(d.date)} label="보기" title="이 날 브리핑 보기 (Enter)" />
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </SinglePane>
  )
}
