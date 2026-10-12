// ============================================================================
// 네트워크 진단
//
// [역할]
// - 앱이 쓰는 외부 주소(Groq · arXiv · HF · Hacker News · GeekNews)에 닿는지 확인 (진단 화면에서 실행)
// - 같은 주소를 Node 기본 fetch와 Electron net.fetch(Chromium 네트워크, 시스템 프록시 · 인증서 사용)로 각각 호출
// - Node 쪽만 실패하면 사내 프록시나 SSL 검사가 원인일 가능성이 높음
// - 성공 기준: HTTP 2xx 응답 (Groq는 키 없이 부르므로 401도 성공)
// - 주소 하나당 10초까지 기다리고, 실패하면 오류와 그 원인(연결 끊김 · 인증서 오류 등)을 함께 기록
// - 모든 호출을 동시에 보내고, 하나가 실패해도 나머지 결과는 그대로 반환
// ============================================================================
import { net } from 'electron'
import type { NetCheckResult } from '@shared/ipc'

// 확인할 주소 목록
const CHECK_TARGETS: { target: string; url: string }[] = [
    // 키 없이 호출하므로 401이 정상 (서버까지 도달했다는 뜻)
    { target: 'Groq API', url: 'https://api.groq.com/openai/v1/models' },
    { target: 'arXiv API', url: 'https://export.arxiv.org/api/query?search_query=cat:cs.CL&max_results=1' },
    { target: 'HF Daily Papers', url: 'https://huggingface.co/api/daily_papers?limit=1' },
    { target: 'Hacker News (Algolia)', url: 'https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=1' },
    { target: 'GeekNews RSS', url: 'https://news.hada.io/rss/news' }
]

const TIMEOUT_MS = 10_000 // 주소 하나를 기다리는 최대 시간
// 괄호 안에 설명을 붙이면 일부 사이트(GeekNews 등)가 봇으로 보고 403을 줌
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AINews/0.1'

// 주소 하나를 한 가지 방식으로 호출하고 걸린 시간과 결과를 기록 (실패해도 던지지 않고 결과로 반환)
async function checkTarget(target: string, url: string, method: NetCheckResult['method']): Promise<NetCheckResult> {
    const startedAt = Date.now() // 걸린 시간 계산용
    const fetchByMethod = method === 'electron-net' ? net.fetch : fetch // 방식에 맞는 호출 함수
    try {
        // 주소 호출 (TIMEOUT_MS 안에 응답이 없으면 중단)
        const checkResponse = await fetchByMethod(url, {
            headers: { 'User-Agent': USER_AGENT },
            signal: AbortSignal.timeout(TIMEOUT_MS)
        })
        await checkResponse.arrayBuffer() // 본문까지 다 받아야 걸린 시간이 맞음

        // 서버까지 닿았는지 판단 (2xx면 성공, Groq는 키 없이 불러 401이 정상)
        const isReachable = checkResponse.ok || (target === 'Groq API' && checkResponse.status === 401)
        return { target, url, method, ok: isReachable, status: checkResponse.status, elapsedMs: Date.now() - startedAt }
    } catch (error) {
        // 응답을 받지 못함 (연결 실패 · 시간 초과) → 오류 내용을 결과에 담음
        const fetchError = error as Error & { cause?: { code?: string; message?: string } }
        const errorCause = fetchError.cause?.code ?? fetchError.cause?.message // 실제 원인 (ECONNRESET · 인증서 오류 등)
        return {
            target,
            url,
            method,
            ok: false,
            elapsedMs: Date.now() - startedAt,
            error: errorCause ? `${fetchError.message} (${errorCause})` : fetchError.message
        }
    }
}

/**
 * 모든 확인 대상을 두 가지 방식으로 동시에 호출
 *
 * @returns {Promise<NetCheckResult[]>} 주소 · 방식별 결과 (대상마다 node-fetch, electron-net 순서)
 */
export async function runNetworkChecks(): Promise<NetCheckResult[]> {
    // 대상마다 두 방식의 호출을 한꺼번에 시작
    const pendingChecks = CHECK_TARGETS.flatMap(({ target, url }) => [
        checkTarget(target, url, 'node-fetch'),
        checkTarget(target, url, 'electron-net')
    ])

    // 모두 끝나면 시작한 순서대로 반환
    return Promise.all(pendingChecks)
}
