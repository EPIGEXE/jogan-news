// ============================================================================
// 브리핑 조회 서비스
//
// [역할]
// - 화면에 보여 줄 브리핑 조회: 가장 최근 브리핑, 날짜별 브리핑, 지난 브리핑 목록
// - 마지막 브리핑 날짜 조회 (오늘 브리핑이 이미 있는지 판단하는 데 사용, triggers/와 진단 화면이 씀)
// - 읽기만 함 (브리핑을 만들고 게시하는 일은 Worker, 생성 흐름은 briefing-service.ts)
// ============================================================================
import type { DigestDTO, DigestSummaryDTO } from '@shared/types'
import type { DigestRepository } from '@data/repositories/digest-repository'

/**
 * 브리핑 조회
 */
export class DigestService {
    constructor(private readonly deps: { digestRepository: DigestRepository }) {}

    // 가장 최근 브리핑과 실린 기사 (하나도 없으면 null)
    getLatestDigest(): DigestDTO | null {
        return this.deps.digestRepository.findLatestDigest()
    }

    // 그 날짜('YYYY-MM-DD')의 브리핑과 실린 기사 (없으면 null)
    getDigestByDate(digestDate: string): DigestDTO | null {
        return this.deps.digestRepository.findDigestByDate(digestDate)
    }

    // 지난 브리핑 목록 (최근 날짜부터, 날짜 · 오늘의 한 줄 · 실린 건수 · 저장한 건수)
    listDigests(): DigestSummaryDTO[] {
        return this.deps.digestRepository.listDigestSummaries()
    }

    // 마지막으로 브리핑을 만든 날짜 'YYYY-MM-DD' (브리핑이 하나도 없으면 null)
    getLastDigestDate(): string | null {
        return this.deps.digestRepository.findLatestDigestDate()
    }
}
