// ============================================================================
// 소스 종류별 수집기
//
// [역할]
// - 소스 한 곳에서 새 글을 가져와 공통 형식(RawItem)으로 변환 (RSS · Hugging Face 논문 · arXiv · Hacker News · GitHub 릴리스)
// - 기준 시각(since) 이후에 나온 글만 수집 (날짜가 없거나 읽을 수 없는 글은 받음, 중복은 DB에서 거름)
// - RSS: 피드 앞에서 maxItems개만, keywordFilter가 켜진 피드는 관심 키워드가 제목 · 요약에 든 글만
// - Hacker News: 검색어마다 따로 검색, minPoints를 넘는 글만, 여러 검색어에 걸린 글은 한 번만
// - GitHub 릴리스: 메이저 · 마이너 버전만 수집 (패치 · 프리릴리스 제외), 저장소 하나가 실패해도 나머지는 수집
// - 글자 수 상한: 제목 300자, RSS 요약 1,500자, 논문 초록 2,500자, 릴리스 노트 4,000자
// - 실패는 여기서 잡지 않고 그대로 던짐 (호출한 수집 단계가 소스 단위로 잡아 나머지 소스를 계속 진행)
// ============================================================================
import Parser from 'rss-parser'
import { z } from 'zod'
import type { Interest, SourceConfig } from '../config'
import { cleanLines, cleanText } from '../pipeline/normalize'
import { fetchJson, fetchText, isPublishedSince, type RawItem } from './types'

const rssParser = new Parser() // RSS · Atom 문서를 읽는 파서 (받아 온 글자를 넘겨서 씀)

// 피드를 요청할 때 보내는 Accept 값
// Accept가 없으면 406을 주는 피드가 있음 (Naver D2)
const FEED_ACCEPT = 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'

// 피드를 fetch로 받아 파서에 넘김
// rss-parser가 직접 받으면 gzip 응답을 풀지 못해 실패하는 피드가 있음 (DeepMind)
async function parseFeed(feedUrl: string) {
    return rssParser.parseString(await fetchText(feedUrl, FEED_ACCEPT))
}

// 글(제목 + 요약)에 관심 키워드가 하나라도 들어 있는지 (대소문자 구분 없음)
function matchesInterest(titleAndSnippet: string, interests: Interest[]): boolean {
    const lowerCaseText = titleAndSnippet.toLowerCase()
    return interests.some((interest) => lowerCaseText.includes(interest.term.toLowerCase()))
}

// RSS · Atom 피드 수집
async function collectRss(rssSource: Extract<SourceConfig, { type: 'rss' }>, since: Date, interests: Interest[]): Promise<RawItem[]> {
    const rssFeed = await parseFeed(rssSource.url)

    // 받을 글 고르기 → 공통 형식으로 변환
    // 1. 피드 앞에서 maxItems개만 남김 (순서가 곧 순위인 피드용, 설정이 없으면 전부)
    // 2. 링크나 제목이 없는 글, 기준 시각보다 오래된 글 제외
    // 3. keywordFilter가 켜진 피드는 관심 키워드에 맞는 글만 (꺼져 있으면 모두 통과)
    return rssFeed.items
        .slice(0, rssSource.maxItems)
        .filter((feedItem) => feedItem.link && feedItem.title && isPublishedSince(feedItem.isoDate, since))
        .filter((feedItem) => !rssSource.keywordFilter || matchesInterest(`${feedItem.title} ${feedItem.contentSnippet ?? ''}`, interests))
        .map((feedItem) => ({
            sourceId: rssSource.id,
            sourceName: rssSource.name,
            kind: rssSource.kind,
            title: cleanText(feedItem.title, 300), // 제목 상한 300자
            url: feedItem.link!,
            publishedAt: feedItem.isoDate ?? null,
            snippet: cleanText(feedItem.contentSnippet ?? feedItem.content, 1500), // 요약 상한 1,500자
            engagement: 0, // RSS에서는 화제성 수치를 받지 않음
            engagementLabel: null,
            lang: rssSource.lang ?? null // 설정에 언어가 없으면 모름으로 둠
        }))
}

// Hugging Face 오늘의 논문 API 응답 중 쓰는 필드
const HfDailyPapersSchema = z.array(
    z.object({
        publishedAt: z.string().optional(), // 오늘의 논문에 실린 시각
        paper: z.object({
            id: z.string(), // arXiv 논문 번호
            title: z.string(),
            summary: z.string(), // 초록
            upvotes: z.number().optional(), // 추천 수
            publishedAt: z.string().optional() // 논문 공개 시각
        })
    })
)

// Hugging Face 오늘의 논문 수집 (추천 수를 화제성으로 씀)
async function collectHfPapers(hfPapersSource: Extract<SourceConfig, { type: 'hf_papers' }>, since: Date): Promise<RawItem[]> {
    // 최근 논문 100건까지 요청 (응답 모양이 다르면 여기서 실패)
    const dailyPapers = HfDailyPapersSchema.parse(await fetchJson('https://huggingface.co/api/daily_papers?limit=100'))

    // 기준 시각 이후 것만 골라 공통 형식으로 변환 (실린 시각이 없으면 논문 공개 시각으로 판단)
    return dailyPapers
        .filter((dailyPaper) => isPublishedSince(dailyPaper.publishedAt ?? dailyPaper.paper.publishedAt, since))
        .map((dailyPaper) => ({
            sourceId: hfPapersSource.id,
            sourceName: hfPapersSource.name,
            kind: hfPapersSource.kind,
            title: cleanText(dailyPaper.paper.title, 300),
            url: `https://arxiv.org/abs/${dailyPaper.paper.id}`, // 링크는 arXiv 초록 페이지로 통일
            publishedAt: dailyPaper.publishedAt ?? dailyPaper.paper.publishedAt ?? null,
            snippet: cleanText(dailyPaper.paper.summary, 2500), // 초록 상한 2,500자
            engagement: dailyPaper.paper.upvotes ?? 0,
            engagementLabel: dailyPaper.paper.upvotes ? `추천 ${dailyPaper.paper.upvotes}` : null, // 추천이 0이거나 없으면 표시 안 함
            lang: 'en'
        }))
}

// arXiv 검색 수집 (설정의 검색식으로 최신 제출순 조회)
async function collectArxiv(arxivSource: Extract<SourceConfig, { type: 'arxiv' }>, since: Date): Promise<RawItem[]> {
    // 검색 주소 조립 (제출일 내림차순, 최대 maxResults건)
    const arxivQueryUrl =
        'https://export.arxiv.org/api/query?' +
        new URLSearchParams({
            search_query: arxivSource.query,
            sortBy: 'submittedDate',
            sortOrder: 'descending',
            max_results: String(arxivSource.maxResults)
        }).toString()

    // 응답이 Atom 피드라 RSS 파서로 읽음
    const arxivFeed = await rssParser.parseString(await fetchText(arxivQueryUrl))

    // 링크나 제목이 없는 논문, 기준 시각보다 오래된 논문을 빼고 공통 형식으로 변환
    return arxivFeed.items
        .filter((arxivEntry) => arxivEntry.link && arxivEntry.title && isPublishedSince(arxivEntry.isoDate ?? arxivEntry.pubDate, since))
        .map((arxivEntry) => ({
            sourceId: arxivSource.id,
            sourceName: arxivSource.name,
            kind: arxivSource.kind,
            title: cleanText(arxivEntry.title, 300),
            url: arxivEntry.link!,
            publishedAt: arxivEntry.isoDate ?? null,
            snippet: cleanText(arxivEntry.contentSnippet ?? arxivEntry.content ?? arxivEntry.summary, 2500), // 초록 상한 2,500자
            engagement: 0, // arXiv에서는 화제성 수치를 받지 않음
            engagementLabel: null,
            lang: 'en'
        }))
}

// Hacker News 검색 API(Algolia) 응답 중 쓰는 필드
const HnSearchResponseSchema = z.object({
    hits: z.array(
        z.object({
            objectID: z.string(), // 글 번호
            title: z.string().nullable(),
            url: z.string().nullable().optional(), // 글이 가리키는 바깥 링크 (없는 글도 있음)
            points: z.number().nullable(), // 점수
            num_comments: z.number().nullable().optional(), // 댓글 수 (지금은 쓰지 않음)
            created_at: z.string() // 올라온 시각
        })
    )
})

// Hacker News 수집 (설정의 검색어마다 검색해서 점수가 높은 글만)
async function collectHackerNews(hackerNewsSource: Extract<SourceConfig, { type: 'hackernews' }>, since: Date): Promise<RawItem[]> {
    const sinceEpochSeconds = Math.floor(since.getTime() / 1000) // 기준 시각 (검색 API가 받는 초 단위)
    const itemsByObjectId = new Map<string, RawItem>() // 글 번호별 수집 결과 (여러 검색어에 걸린 글을 한 번만 담기 위함)

    // 검색어를 하나씩 차례로 검색
    for (const searchQuery of hackerNewsSource.queries) {
        // 검색 주소 조립 (글 종류는 tags, 기준 시각 이후 · minPoints 초과만, 검색어당 최대 50건)
        const searchUrl =
            'https://hn.algolia.com/api/v1/search?' +
            new URLSearchParams({
                tags: hackerNewsSource.tags,
                query: searchQuery,
                numericFilters: `created_at_i>${sinceEpochSeconds},points>${hackerNewsSource.minPoints}`,
                hitsPerPage: '50'
            }).toString()
        const { hits } = HnSearchResponseSchema.parse(await fetchJson(searchUrl))

        for (const hit of hits) {
            // 제목이 없는 글, 앞선 검색어에서 이미 담은 글은 건너뜀
            if (!hit.title || itemsByObjectId.has(hit.objectID)) continue

            const points = hit.points ?? 0
            itemsByObjectId.set(hit.objectID, {
                sourceId: hackerNewsSource.id,
                sourceName: hackerNewsSource.name,
                kind: hackerNewsSource.kind,
                title: cleanText(hit.title, 300),
                url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`, // 바깥 링크가 없으면 Hacker News 글 페이지
                publishedAt: hit.created_at,
                snippet: '', // 글의 내용은 받지 않음 (제목과 점수만)
                engagement: points,
                engagementLabel: `HN ${points.toLocaleString('en-US')}점`,
                lang: 'en'
            })
        }
    }
    return [...itemsByObjectId.values()]
}

// 프리릴리스 표시 (rc · alpha · beta · dev · preview · nightly · pre, 파이썬식 1.2.0a1)
const PRERELEASE_PATTERN = /(rc|alpha|beta|dev|preview|nightly|pre)[.-]?\d*\b|\d(a|b)\d/i
// 버전 번호 (x.y 또는 x.y.z, 태그 안에서 처음 나오는 것)
const VERSION_PATTERN = /(\d+)\.(\d+)(?:\.(\d+))?/

/**
 * 릴리스 태그에서 소식으로 칠 버전 추출
 * - 메이저 · 마이너 버전만 인정 (x.y 또는 x.y.0)
 * - 패치 버전 · 프리릴리스 · 버전 형식이 아닌 태그는 받지 않음
 *
 * @param {string} releaseTag - 릴리스 태그 (예: v0.31.0, langgraph==1.2.0)
 * @returns {string | null} 버전 글자 (예: 0.31.0), 받지 않는 릴리스면 null
 */
export function releaseVersion(releaseTag: string): string | null {
    // 프리릴리스 → 받지 않음
    if (PRERELEASE_PATTERN.test(releaseTag)) return null

    // 버전 형식이 아님 (빌드 번호뿐인 태그 등) → 받지 않음
    const versionMatch = VERSION_PATTERN.exec(releaseTag)
    if (!versionMatch) return null

    // 세 번째 자리가 1 이상이면 패치 버전 → 받지 않음
    if (versionMatch[3] !== undefined && Number(versionMatch[3]) > 0) return null
    return versionMatch[0]
}

// GitHub 릴리스 수집 (감시 목록의 저장소마다 릴리스 피드를 읽음)
async function collectGithubReleases(releasesSource: Extract<SourceConfig, { type: 'github_releases' }>, since: Date): Promise<RawItem[]> {
    // 저장소마다 동시에 릴리스 피드 읽기
    // 저장소 하나가 실패해도(이름 변경 · 삭제) 나머지는 받도록 결과를 저장소별로 따로 받음
    const repoResults = await Promise.allSettled(
        releasesSource.repos.map(async (watchedRepo) => {
            const releaseFeed = await parseFeed(`https://github.com/${watchedRepo.repo}/releases.atom`)
            return releaseFeed.items.flatMap((releaseEntry): RawItem[] => {
                // 링크가 없는 릴리스, 기준 시각보다 오래된 릴리스 제외
                if (!releaseEntry.link || !isPublishedSince(releaseEntry.isoDate, since)) return []

                // 릴리스 태그는 링크의 /releases/tag/ 뒷부분 (없으면 제목으로 대신)
                const releaseTag = decodeURIComponent(releaseEntry.link.split('/releases/tag/')[1] ?? releaseEntry.title ?? '')

                // 한 저장소에서 여러 패키지를 내는 경우 → 태그에 match 글자가 든 릴리스만
                if (watchedRepo.match && !releaseTag.includes(watchedRepo.match)) return []

                // 패치 · 프리릴리스 제외
                const version = releaseVersion(releaseTag)
                if (!version) return []

                const releaseTitle = (releaseEntry.title ?? '').trim()
                return [
                    {
                        sourceId: releasesSource.id,
                        sourceName: releasesSource.name,
                        kind: releasesSource.kind,
                        // 제목에 프로젝트 이름이 없으면 앞에 붙임 (제목이 버전뿐일 때 "vLLM 0.31.0"처럼, 제목이 비었으면 버전으로)
                        title: cleanText(
                            releaseTitle.toLowerCase().includes(watchedRepo.name.toLowerCase())
                                ? releaseTitle
                                : `${watchedRepo.name} ${releaseTitle || version}`,
                            300
                        ),
                        url: releaseEntry.link,
                        publishedAt: releaseEntry.isoDate ?? null,
                        snippet: cleanLines(releaseEntry.contentSnippet ?? releaseEntry.content, 4000), // 릴리스 노트 (줄 구분 유지, 상한 4,000자)
                        engagement: 0, // 릴리스 피드에서는 화제성 수치를 받지 않음
                        engagementLabel: null,
                        lang: 'en'
                    }
                ]
            })
        })
    )

    // 성공한 저장소의 릴리스만 모음
    const fulfilledRepoItems = repoResults.flatMap((repoResult) => (repoResult.status === 'fulfilled' ? [repoResult.value] : []))
    const firstRejectedRepo = repoResults.find((repoResult) => repoResult.status === 'rejected') // 실패한 저장소 중 첫 번째 (전부 실패했을 때 던질 오류용)

    // 저장소가 전부 실패 → 소스 실패로 보고 첫 오류를 던짐
    if (fulfilledRepoItems.length === 0 && firstRejectedRepo) throw firstRejectedRepo.reason
    return fulfilledRepoItems.flat()
}

/**
 * 소스 한 곳에서 새 글 수집
 * - 소스 종류(type)에 맞는 수집기 실행
 * - 실패하면 예외를 그대로 던짐 (호출한 쪽이 소스 단위로 잡음)
 *
 * @param {SourceConfig} source - 수집할 소스 설정 (config/sources.yaml의 한 항목)
 * @param {Date} since - 이 시각 이후에 나온 글만 수집
 * @param {Interest[]} interests - 관심 키워드 (keywordFilter가 켜진 RSS 피드에서만 씀)
 * @returns {Promise<RawItem[]>} 공통 형식으로 바꾼 수집 결과
 */
export function collectSource(source: SourceConfig, since: Date, interests: Interest[]): Promise<RawItem[]> {
    switch (source.type) {
        case 'rss':
            return collectRss(source, since, interests)
        case 'hf_papers':
            return collectHfPapers(source, since)
        case 'arxiv':
            return collectArxiv(source, since)
        case 'hackernews':
            return collectHackerNews(source, since)
        case 'github_releases':
            return collectGithubReleases(source, since)
    }
}
