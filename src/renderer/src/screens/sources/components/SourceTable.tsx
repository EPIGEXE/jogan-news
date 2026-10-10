import { Fragment, useState } from 'react'
import type { SourceFetchDTO, SourceStatDTO } from '@shared/types'
import { cn } from '@/common/lib/cn'
import { formatShortDate, formatTime } from '@/common/lib/format'

type SortKey = 'name' | 'collected' | 'published' | 'rate' | 'saved'

const rate = (s: SourceStatDTO) => (s.period.collected ? s.period.published / s.period.collected : -1)

const SORT: Record<SortKey, (a: SourceStatDTO, b: SourceStatDTO) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  collected: (a, b) => a.period.collected - b.period.collected,
  published: (a, b) => a.period.published - b.period.published,
  rate: (a, b) => rate(a) - rate(b),
  saved: (a, b) => a.period.saved - b.period.saved
}

/** "3분 전", "2시간 전", "4일 전" */
function ago(iso: string): string {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (min < 1) return '방금'
  if (min < 60) return `${min}분 전`
  if (min < 60 * 24) return `${Math.round(min / 60)}시간 전`
  return `${Math.round(min / 60 / 24)}일 전`
}

function Status({ s }: { s: SourceStatDTO }) {
  const f = s.lastFetch
  const [dot, text, title] = !s.enabled
    ? ['border border-ink-faint bg-transparent', '꺼짐', 'sources.yaml에서 꺼 둔 출처']
    : !f
      ? ['bg-rule', '기록 없음', '이 기능을 넣은 뒤로 아직 수집하지 않았습니다']
      : f.ok
        ? ['bg-ink-secondary', `정상 · ${ago(f.at)}`, `마지막 수집 ${formatShortDate(f.at)} ${formatTime(f.at)}`]
        : ['bg-danger', `실패 · ${ago(f.at)}`, f.error ?? '']
  return (
    <span className="flex flex-col gap-0.5" title={title}>
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        <span aria-hidden="true" className={cn('size-2 flex-none rounded-full', dot)} />
        {text}
      </span>
      {s.enabled && s.failures > 0 && <span className="text-caption text-danger">기간 중 실패 {s.failures}회</span>}
    </span>
  )
}

function FetchLine({ f }: { f: SourceFetchDTO }) {
  return (
    <li className="flex flex-wrap gap-x-3 tabular-nums">
      <span className="text-ink-muted">
        {formatShortDate(f.at)} {formatTime(f.at)}
      </span>
      <span>{f.reason === 'collect' ? '미리 수집' : '브리핑'}</span>
      {f.ok ? (
        <span>
          받은 글 {f.fetched} · 새 글 {f.newItems}
        </span>
      ) : (
        <span className="text-danger">실패 — {f.error}</span>
      )}
    </li>
  )
}

/** 펼친 행: 수집 조건, 최근 수집 기록, 최근 실린 기사 */
function Detail({ s }: { s: SourceStatDTO }) {
  return (
    <div className="grid gap-x-8 gap-y-4 px-3 pt-1 pb-4 text-body text-ink-body reader:grid-cols-3">
      <section className="flex flex-col gap-1.5">
        <h3 className="font-display text-label font-bold tracking-label text-accent">수집 조건</h3>
        <ul className="m-0 flex list-disc flex-col gap-0.5 pl-5">
          {s.rules.map((r) => (
            <li key={r} className="break-words">
              {r}
            </li>
          ))}
        </ul>
        {s.url && <span className="truncate text-meta text-ink-muted">{s.url}</span>}
      </section>
      <section className="flex flex-col gap-1.5">
        <h3 className="font-display text-label font-bold tracking-label text-accent">최근 수집 기록</h3>
        {s.recentFetches.length ? (
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-meta">
            {s.recentFetches.map((f) => (
              <FetchLine key={f.at + f.reason} f={f} />
            ))}
          </ul>
        ) : (
          <span className="text-meta text-ink-muted">아직 기록이 없습니다</span>
        )}
      </section>
      <section className="flex flex-col gap-1.5">
        <h3 className="font-display text-label font-bold tracking-label text-accent">최근 실린 기사</h3>
        {s.recentPublished.length ? (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {s.recentPublished.map((p) => (
              <li key={p.itemId} className="flex gap-2">
                <span className="flex-none text-meta text-ink-muted tabular-nums">{formatShortDate(p.digestDate)}</span>
                <span className="min-w-0">{p.titleKo}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-meta text-ink-muted">아직 실린 기사가 없습니다</span>
        )}
      </section>
    </div>
  )
}

/** 출처별 표. 열 머리를 눌러 정렬하고, 행을 누르면 그 출처의 수집 조건·기록·실린 기사가 펼쳐진다 */
export function SourceTable({ sources, showTotal }: { sources: SourceStatDTO[]; showTotal: boolean }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'published', desc: true })
  const [open, setOpen] = useState<string | null>(null)

  // 꺼진 출처는 항상 아래로
  const rows = [...sources].sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
    const d = SORT[sort.key](a, b)
    return sort.desc ? -d : d
  })

  const Head = ({ k, children, className }: { k: SortKey; children: string; className?: string }) => (
    <th
      scope="col"
      aria-sort={sort.key === k ? (sort.desc ? 'descending' : 'ascending') : 'none'}
      className={cn('p-0 font-normal', className)}
    >
      <button
        type="button"
        onClick={() => setSort((s) => ({ key: k, desc: s.key === k ? !s.desc : k !== 'name' }))}
        className={cn(
          'flex min-h-9 w-full cursor-pointer items-center gap-1 border-0 bg-transparent px-3 text-meta font-bold text-ink-secondary hover:text-ink',
          k === 'name' ? 'justify-start' : 'justify-end'
        )}
      >
        {children}
        <span aria-hidden="true" className={cn('text-caption', sort.key === k ? 'text-accent' : 'text-transparent')}>
          {sort.desc ? '▾' : '▴'}
        </span>
      </button>
    </th>
  )

  const num = 'px-3 py-2.5 text-right tabular-nums'
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-body">
        <thead className="border-y border-rule-strong">
          <tr>
            <Head k="name">출처</Head>
            <th scope="col" className="px-3 text-left text-meta font-bold text-ink-secondary">
              상태
            </th>
            <Head k="collected">수집</Head>
            <Head k="published">실림</Head>
            <Head k="rate">채택률</Head>
            <Head k="saved">저장</Head>
            {showTotal && (
              <th scope="col" className="px-3 text-right text-meta font-bold whitespace-nowrap text-ink-secondary">
                전체 수집 · 실림
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const expanded = open === s.id
            return (
              <Fragment key={s.id}>
                <tr
                  onClick={() => setOpen(expanded ? null : s.id)}
                  aria-expanded={expanded}
                  className={cn(
                    'cursor-pointer border-b border-rule-soft transition-colors duration-120 hover:bg-paper-sunken/50',
                    expanded && 'bg-paper-sunken',
                    !s.enabled && 'text-ink-muted'
                  )}
                >
                  <td className="px-3 py-2.5">
                    <span className="flex flex-col">
                      <span className="font-display font-semibold">{s.name}</span>
                      <span className="text-caption text-ink-muted">{s.method}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-meta">
                    <Status s={s} />
                  </td>
                  <td className={num}>{s.period.collected.toLocaleString('ko-KR')}</td>
                  <td className={cn(num, 'font-bold')}>{s.period.published}</td>
                  <td className={num}>{s.period.collected ? `${((s.period.published / s.period.collected) * 100).toFixed(0)}%` : '—'}</td>
                  <td className={num}>{s.period.saved}</td>
                  {showTotal && (
                    <td className={cn(num, 'text-ink-muted')}>
                      {s.total.collected.toLocaleString('ko-KR')} · {s.total.published}
                    </td>
                  )}
                </tr>
                {expanded && (
                  <tr className="border-b border-rule bg-paper-sunken/40">
                    <td colSpan={showTotal ? 7 : 6} className="animate-ink-in">
                      <Detail s={s} />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
