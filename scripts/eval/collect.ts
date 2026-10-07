// 한국어 품질 비교 테스트용 샘플 수집 (DESIGN.md 7.7절). API 키 없이 실행된다.
// 뉴스 10 · 논문 10 · 커뮤니티 10건을 모아 eval/output/samples.json에 저장한다.

import { mkdirSync, writeFileSync } from 'node:fs'
import Parser from 'rss-parser'
import { z } from 'zod'
import { extractArticle, USER_AGENT } from '../../src/worker/knowledge/extract'
import { OUTPUT_DIR, SAMPLES_PATH, type Sample, type SampleKind } from './types'

const PER_KIND = 10
const DAYS = 7
const MIN_CHARS = 300
const since = Date.now() - DAYS * 24 * 60 * 60 * 1000

const AI_PATTERN =
  /\b(LLMs?|GPT|Claude|Gemini|Llama|Qwen|DeepSeek|agents?|agentic|MCP|Anthropic|OpenAI|RAG|reasoning|inference|fine-?tun\w*|AI)\b|에이전트|언어 ?모델|인공지능|\bAI\b/i

const rss = new Parser({ timeout: 15_000, headers: { 'User-Agent': USER_AGENT } })

interface Candidate {
  kind: SampleKind
  source: string
  title: string
  url: string
  publishedAt: string | null
  fallbackText: string
  /** false면 본문 추출을 시도하지 않고 fallbackText를 쓴다 */
  extract: boolean
}

const NEWS_FEEDS: { source: string; url: string }[] = [
  { source: 'OpenAI News', url: 'https://openai.com/news/rss.xml' },
  { source: 'Hugging Face Blog', url: 'https://huggingface.co/blog/feed.xml' },
  { source: 'Simon Willison', url: 'https://simonwillison.net/atom/everything/' },
  { source: 'TechCrunch AI', url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
  { source: 'The Verge AI', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' }
]

async function newsCandidates(): Promise<Candidate[]> {
  const perFeed = await Promise.all(
    NEWS_FEEDS.map(async (f) => {
      try {
        const feed = await rss.parseURL(f.url)
        return feed.items
          .filter((it) => it.link && it.title)
          .filter((it) => !it.isoDate || Date.parse(it.isoDate) >= since)
          .filter((it) => AI_PATTERN.test(`${it.title} ${it.contentSnippet ?? ''}`))
          .map<Candidate>((it) => ({
            kind: 'news',
            source: f.source,
            title: it.title!,
            url: it.link!,
            publishedAt: it.isoDate ?? null,
            fallbackText: it.contentSnippet ?? '',
            extract: true
          }))
      } catch (err) {
        console.warn(`  ! ${f.source} 피드 실패: ${(err as Error).message}`)
        return []
      }
    })
  )
  // 한 소스에 몰리지 않도록 소스별로 번갈아 뽑는다.
  const out: Candidate[] = []
  for (let i = 0; perFeed.some((l) => l[i]); i++) for (const l of perFeed) if (l[i]) out.push(l[i]!)
  return out
}

const HfPapers = z.array(
  z.object({
    paper: z.object({
      id: z.string(),
      title: z.string(),
      summary: z.string(),
      upvotes: z.number().optional(),
      publishedAt: z.string().optional()
    })
  })
)

async function paperCandidates(): Promise<Candidate[]> {
  const res = await fetch('https://huggingface.co/api/daily_papers?limit=100', {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(15_000)
  })
  const papers = HfPapers.parse(await res.json())
  return papers
    .map((p) => p.paper)
    .filter((p) => AI_PATTERN.test(`${p.title} ${p.summary}`))
    .sort((a, b) => (b.upvotes ?? 0) - (a.upvotes ?? 0))
    .map<Candidate>((p) => ({
      kind: 'paper',
      source: `HF Daily Papers (👍${p.upvotes ?? 0})`,
      title: p.title.replace(/\s+/g, ' ').trim(),
      url: `https://arxiv.org/abs/${p.id}`,
      publishedAt: p.publishedAt ?? null,
      fallbackText: p.summary.replace(/\s+/g, ' ').trim(),
      extract: false
    }))
}

const HnHits = z.object({
  hits: z.array(
    z.object({
      objectID: z.string(),
      title: z.string().nullable(),
      url: z.string().nullable().optional(),
      points: z.number().nullable(),
      created_at: z.string()
    })
  )
})

async function communityCandidates(): Promise<Candidate[]> {
  const sinceSec = Math.floor(since / 1000)
  const queries = ['LLM', 'agent', 'Claude', 'OpenAI', 'model']
  const seen = new Set<string>()
  const hn: (Candidate & { points: number })[] = []
  for (const q of queries) {
    const url = `https://hn.algolia.com/api/v1/search?tags=story&query=${encodeURIComponent(q)}&numericFilters=created_at_i>${sinceSec},points>80&hitsPerPage=30`
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      for (const h of HnHits.parse(await res.json()).hits) {
        if (!h.url || !h.title || seen.has(h.objectID)) continue
        seen.add(h.objectID)
        hn.push({
          kind: 'community',
          source: `Hacker News (${h.points ?? 0}점)`,
          title: h.title,
          url: h.url,
          publishedAt: h.created_at,
          fallbackText: '',
          extract: true,
          points: h.points ?? 0
        })
      }
    } catch (err) {
      console.warn(`  ! HN 검색(${q}) 실패: ${(err as Error).message}`)
    }
  }
  hn.sort((a, b) => b.points - a.points)

  // GeekNews 토픽 페이지에는 한국어 요약과 HN 의견 번역이 있다. 한국어 입력 처리를 보려고 원문 대신 이 페이지를 쓴다.
  let geek: Candidate[] = []
  try {
    const feed = await rss.parseURL('https://news.hada.io/rss/news')
    geek = feed.items
      .filter((it) => it.link && it.title && AI_PATTERN.test(`${it.title} ${it.contentSnippet ?? ''}`))
      .map((it) => ({
        kind: 'community' as const,
        source: 'GeekNews',
        title: it.title!,
        url: it.link!,
        publishedAt: it.isoDate ?? null,
        fallbackText: it.contentSnippet ?? '',
        extract: true
      }))
  } catch (err) {
    console.warn(`  ! GeekNews 피드 실패: ${(err as Error).message}`)
  }
  return [...geek.slice(0, 4), ...hn, ...geek.slice(4)]
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}|\r\n\r\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

async function materialize(candidates: Candidate[], want: number): Promise<Sample[]> {
  const out: Sample[] = []
  for (const c of candidates) {
    if (out.length >= want) break
    let paragraphs: string[] = []
    let fullText = false
    if (c.extract) {
      try {
        const ex = await extractArticle(c.url)
        if (ex) {
          paragraphs = ex.paragraphs
          fullText = true
        }
      } catch (err) {
        console.warn(`  ! 본문 추출 실패 (${c.source}): ${(err as Error).message}`)
      }
    }
    if (!fullText) paragraphs = splitParagraphs(c.fallbackText)
    if (paragraphs.join(' ').length < MIN_CHARS) continue
    out.push({
      id: `${c.kind}-${out.length + 1}`,
      kind: c.kind,
      source: c.source,
      title: c.title,
      url: c.url,
      publishedAt: c.publishedAt,
      fullText,
      paragraphs
    })
    console.log(`  ✓ [${c.source}] ${c.title.slice(0, 70)}${fullText ? '' : ' (요약만)'}`)
  }
  if (out.length < want) console.warn(`  ! ${candidates[0]?.kind ?? ''} ${out.length}/${want}건만 모음`)
  return out
}

async function main(): Promise<void> {
  console.log('뉴스 수집…')
  const news = await materialize(await newsCandidates(), PER_KIND)
  console.log('논문 수집…')
  const papers = await materialize(await paperCandidates(), PER_KIND)
  console.log('커뮤니티 수집…')
  const community = await materialize(await communityCandidates(), PER_KIND)

  const samples = [...news, ...papers, ...community]
  mkdirSync(OUTPUT_DIR, { recursive: true })
  writeFileSync(SAMPLES_PATH, JSON.stringify(samples, null, 2))
  console.log(`\n${samples.length}건 저장 → ${SAMPLES_PATH}`)
  console.log(`  뉴스 ${news.length} · 논문 ${papers.length} · 커뮤니티 ${community.length}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
