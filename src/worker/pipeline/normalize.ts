// 수집한 항목을 같은 기준으로 맞추는 순수 함수들. 중복 판정의 기준이 된다.

const TRACKING_PARAMS = /^(utm_|ref$|ref_src$|fbclid$|gclid$|mc_cid$|mc_eid$|igshid$|s$|source$)/i
const ARXIV_ID = /(\d{4}\.\d{4,5})(v\d+)?/

/**
 * 같은 글이면 같은 값이 나오도록 URL을 정규화한다.
 * - arXiv abs/pdf, HF Papers 페이지는 모두 `arxiv:<id>`로 묶는다.
 * - 추적용 쿼리, 해시, www, 끝의 /는 버린다.
 */
export function urlKey(raw: string): string {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return raw.trim().toLowerCase()
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  if (host.endsWith('arxiv.org') || (host === 'huggingface.co' && u.pathname.startsWith('/papers/'))) {
    const m = ARXIV_ID.exec(u.pathname)
    if (m) return `arxiv:${m[1]}`
  }
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAMS.test(k))
    .sort(([a], [b]) => a.localeCompare(b))
  const query = params.length ? '?' + new URLSearchParams(params).toString() : ''
  const path = u.pathname.replace(/\/+$/, '') || ''
  return `${host}${path}${query}`
}

/** 제목 비교용: 소문자, 기호·공백 제거 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .slice(0, 200)
}

export function cleanText(s: string | undefined | null, max = 2000): string {
  if (!s) return ''
  return s.replace(/\s+/g, ' ').trim().slice(0, max)
}
