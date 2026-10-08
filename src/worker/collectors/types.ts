import type { ItemKind } from '../config'

export interface RawItem {
  sourceId: string
  sourceName: string
  kind: ItemKind
  title: string
  url: string
  publishedAt: string | null
  snippet: string
  engagement: number
  engagementLabel: string | null
  lang: string | null
}

// 괄호 안에 URL·설명을 붙이면 일부 사이트(GeekNews 등)가 봇으로 보고 403을 준다.
export const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AINews/0.1'
export const FETCH_TIMEOUT_MS = 15_000

export async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchText(url: string, accept = '*/*'): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: accept },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

export function isAfter(iso: string | null | undefined, since: Date): boolean {
  if (!iso) return true // 날짜가 없으면 일단 받고, 중복은 DB에서 거른다
  const t = Date.parse(iso)
  return Number.isNaN(t) || t >= since.getTime()
}
