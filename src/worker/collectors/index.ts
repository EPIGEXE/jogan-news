import Parser from 'rss-parser'
import { z } from 'zod'
import type { Interest, SourceConfig } from '../config'
import { cleanText } from '../pipeline/normalize'
import { fetchJson, fetchText, FETCH_TIMEOUT_MS, isAfter, USER_AGENT, type RawItem } from './types'

// 소스 종류별 수집기. 실패는 호출한 쪽(collect 단계)에서 소스 단위로 잡는다.

const rss = new Parser({ timeout: FETCH_TIMEOUT_MS, headers: { 'User-Agent': USER_AGENT } })

function matchesInterest(text: string, interests: Interest[]): boolean {
  const lower = text.toLowerCase()
  return interests.some((k) => lower.includes(k.term.toLowerCase()))
}

async function collectRss(
  s: Extract<SourceConfig, { type: 'rss' }>,
  since: Date,
  interests: Interest[]
): Promise<RawItem[]> {
  const feed = await rss.parseURL(s.url)
  return feed.items
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
        tags: 'story',
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
  }
}
