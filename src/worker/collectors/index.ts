import Parser from 'rss-parser'
import { z } from 'zod'
import type { Interest, SourceConfig } from '../config'
import { cleanLines, cleanText } from '../pipeline/normalize'
import { fetchJson, fetchText, isAfter, type RawItem } from './types'

// 소스 종류별 수집기. 실패는 호출한 쪽(collect 단계)에서 소스 단위로 잡는다.

const rss = new Parser()

// 피드는 fetch로 받아서 넘긴다. rss-parser가 직접 받으면 gzip 응답을 풀지 못해 실패하는 피드가 있다(DeepMind).
// Accept가 없으면 406을 주는 피드도 있다(Naver D2).
const FEED_ACCEPT = 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
async function parseFeed(url: string) {
  return rss.parseString(await fetchText(url, FEED_ACCEPT))
}

function matchesInterest(text: string, interests: Interest[]): boolean {
  const lower = text.toLowerCase()
  return interests.some((k) => lower.includes(k.term.toLowerCase()))
}

async function collectRss(
  s: Extract<SourceConfig, { type: 'rss' }>,
  since: Date,
  interests: Interest[]
): Promise<RawItem[]> {
  const feed = await parseFeed(s.url)
  return feed.items
    .slice(0, s.maxItems)
    .filter((it) => it.link && it.title && isAfter(it.isoDate, since))
    .filter((it) => !s.keywordFilter || matchesInterest(`${it.title} ${it.contentSnippet ?? ''}`, interests))
    .map((it) => ({
      sourceId: s.id,
      sourceName: s.name,
      kind: s.kind,
      title: cleanText(it.title, 300),
      url: it.link!,
      publishedAt: it.isoDate ?? null,
      snippet: cleanText(it.contentSnippet ?? it.content, 1500),
      engagement: 0,
      engagementLabel: null,
      lang: s.lang ?? null
    }))
}

const HfPapers = z.array(
  z.object({
    publishedAt: z.string().optional(),
    paper: z.object({
      id: z.string(),
      title: z.string(),
      summary: z.string(),
      upvotes: z.number().optional(),
      publishedAt: z.string().optional()
    })
  })
)

async function collectHfPapers(s: Extract<SourceConfig, { type: 'hf_papers' }>, since: Date): Promise<RawItem[]> {
  const list = HfPapers.parse(await fetchJson('https://huggingface.co/api/daily_papers?limit=100'))
  return list
    .filter((e) => isAfter(e.publishedAt ?? e.paper.publishedAt, since))
    .map((e) => ({
      sourceId: s.id,
      sourceName: s.name,
      kind: s.kind,
      title: cleanText(e.paper.title, 300),
      url: `https://arxiv.org/abs/${e.paper.id}`,
      publishedAt: e.publishedAt ?? e.paper.publishedAt ?? null,
      snippet: cleanText(e.paper.summary, 2500),
      engagement: e.paper.upvotes ?? 0,
      engagementLabel: e.paper.upvotes ? `추천 ${e.paper.upvotes}` : null,
      lang: 'en'
    }))
}

async function collectArxiv(s: Extract<SourceConfig, { type: 'arxiv' }>, since: Date): Promise<RawItem[]> {
  const url =
    'https://export.arxiv.org/api/query?' +
    new URLSearchParams({
      search_query: s.query,
      sortBy: 'submittedDate',
      sortOrder: 'descending',
      max_results: String(s.maxResults)
    }).toString()
  const feed = await rss.parseString(await fetchText(url))
  return feed.items
    .filter((it) => it.link && it.title && isAfter(it.isoDate ?? it.pubDate, since))
    .map((it) => ({
      sourceId: s.id,
      sourceName: s.name,
      kind: s.kind,
      title: cleanText(it.title, 300),
      url: it.link!,
      publishedAt: it.isoDate ?? null,
      snippet: cleanText(it.contentSnippet ?? it.content ?? it.summary, 2500),
      engagement: 0,
      engagementLabel: null,
      lang: 'en'
    }))
}

const HnHits = z.object({
  hits: z.array(
    z.object({
      objectID: z.string(),
      title: z.string().nullable(),
      url: z.string().nullable().optional(),
      points: z.number().nullable(),
      num_comments: z.number().nullable().optional(),
      created_at: z.string()
    })
  )
})

async function collectHackerNews(s: Extract<SourceConfig, { type: 'hackernews' }>, since: Date): Promise<RawItem[]> {
  const sinceSec = Math.floor(since.getTime() / 1000)
  const seen = new Map<string, RawItem>()
  for (const q of s.queries) {
    const url =
      'https://hn.algolia.com/api/v1/search?' +
      new URLSearchParams({
        tags: s.tags,
        query: q,
        numericFilters: `created_at_i>${sinceSec},points>${s.minPoints}`,
        hitsPerPage: '50'
      }).toString()
    const { hits } = HnHits.parse(await fetchJson(url))
    for (const h of hits) {
      if (!h.title || seen.has(h.objectID)) continue
      const points = h.points ?? 0
      seen.set(h.objectID, {
        sourceId: s.id,
        sourceName: s.name,
        kind: s.kind,
        title: cleanText(h.title, 300),
        url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        publishedAt: h.created_at,
        snippet: '',
        engagement: points,
        engagementLabel: `HN ${points.toLocaleString('en-US')}점`,
        lang: 'en'
      })
    }
  }
  return [...seen.values()]
}

// 프리릴리스(rc·alpha·beta·dev·nightly, 파이썬식 1.2.0a1)는 받지 않는다
const PRERELEASE = /(rc|alpha|beta|dev|preview|nightly|pre)[.-]?\d*\b|\d(a|b)\d/i
const VERSION = /(\d+)\.(\d+)(?:\.(\d+))?/

/** 메이저·마이너 버전만 소식으로 친다 (x.y 또는 x.y.0). 패치·프리릴리스는 null */
export function releaseVersion(tag: string): string | null {
  if (PRERELEASE.test(tag)) return null
  const m = VERSION.exec(tag)
  if (!m) return null
  if (m[3] !== undefined && Number(m[3]) > 0) return null
  return m[0]
}

async function collectGithubReleases(s: Extract<SourceConfig, { type: 'github_releases' }>, since: Date): Promise<RawItem[]> {
  // 저장소 하나가 실패해도(이름 변경·삭제) 나머지는 받는다. 전부 실패하면 소스 실패로 본다
  const settled = await Promise.allSettled(
    s.repos.map(async (r) => {
      const feed = await parseFeed(`https://github.com/${r.repo}/releases.atom`)
      return feed.items.flatMap((it): RawItem[] => {
        if (!it.link || !isAfter(it.isoDate, since)) return []
        const tag = decodeURIComponent(it.link.split('/releases/tag/')[1] ?? it.title ?? '')
        if (r.match && !tag.includes(r.match)) return []
        const version = releaseVersion(tag)
        if (!version) return []
        const title = (it.title ?? '').trim()
        return [
          {
            sourceId: s.id,
            sourceName: s.name,
            kind: s.kind,
            // 릴리스 제목이 버전뿐이면 "vLLM 0.31.0"처럼 프로젝트 이름을 붙인다
            title: cleanText(title.toLowerCase().includes(r.name.toLowerCase()) ? title : `${r.name} ${title || version}`, 300),
            url: it.link,
            publishedAt: it.isoDate ?? null,
            snippet: cleanLines(it.contentSnippet ?? it.content, 4000),
            engagement: 0,
            engagementLabel: null,
            lang: 'en'
          }
        ]
      })
    })
  )
  const ok = settled.flatMap((x) => (x.status === 'fulfilled' ? [x.value] : []))
  const failed = settled.find((x) => x.status === 'rejected')
  if (ok.length === 0 && failed) throw failed.reason
  return ok.flat()
}

export function collectSource(s: SourceConfig, since: Date, interests: Interest[]): Promise<RawItem[]> {
  switch (s.type) {
    case 'rss':
      return collectRss(s, since, interests)
    case 'hf_papers':
      return collectHfPapers(s, since)
    case 'arxiv':
      return collectArxiv(s, since)
    case 'hackernews':
      return collectHackerNews(s, since)
    case 'github_releases':
      return collectGithubReleases(s, since)
  }
}
