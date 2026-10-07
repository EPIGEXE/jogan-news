import { net } from 'electron'
import type { NetCheckResult } from '@shared/ipc'

// 같은 주소를 Node 기본 fetch와 Electron net.fetch(Chromium 네트워크, 시스템 프록시·인증서 사용)로
// 각각 호출해 본다. Node 쪽만 실패하면 사내 프록시나 SSL 검사가 원인일 가능성이 높다.

const TARGETS: { target: string; url: string }[] = [
  // 키 없이 호출하므로 401이 정상 (서버까지 도달했다는 뜻)
  { target: 'Groq API', url: 'https://api.groq.com/openai/v1/models' },
  { target: 'arXiv API', url: 'https://export.arxiv.org/api/query?search_query=cat:cs.CL&max_results=1' },
  { target: 'HF Daily Papers', url: 'https://huggingface.co/api/daily_papers?limit=1' },
  { target: 'Hacker News (Algolia)', url: 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=1' },
  { target: 'GeekNews RSS', url: 'https://news.hada.io/rss/news' }
]

const TIMEOUT_MS = 10_000
const UA = 'AINews/0.0.1 (+desktop briefing app)'

async function check(
  target: string,
  url: string,
  method: NetCheckResult['method']
): Promise<NetCheckResult> {
  const started = Date.now()
  const doFetch = method === 'electron-net' ? net.fetch : fetch
  try {
    const res = await doFetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    await res.arrayBuffer()
    const reachable = res.ok || (target === 'Groq API' && res.status === 401)
    return { target, url, method, ok: reachable, status: res.status, ms: Date.now() - started }
  } catch (err) {
    const e = err as Error & { cause?: { code?: string; message?: string } }
    const cause = e.cause?.code ?? e.cause?.message
    return {
      target,
      url,
      method,
      ok: false,
      ms: Date.now() - started,
      error: cause ? `${e.message} (${cause})` : e.message
    }
  }
}

export async function runNetworkChecks(): Promise<NetCheckResult[]> {
  const jobs = TARGETS.flatMap(({ target, url }) => [
    check(target, url, 'node-fetch'),
    check(target, url, 'electron-net')
  ])
  return Promise.all(jobs)
}
