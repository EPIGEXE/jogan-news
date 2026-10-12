// ============================================================================
// "왜 중요한가" 상자
//
// [역할]
// - 기사가 왜 중요한지 적은 글을 위아래 굵은 괘선 상자로 표시
// ============================================================================

/**
 * "왜 중요한가" 상자 (위아래 굵은 괘선)
 *
 * @returns {JSX.Element} 제목과 설명 글이 든 상자
 */
export function WhyItMatters({ children }: { children: string }) {
    return (
        <div className="border-y border-rule-strong py-3">
            <div className="mb-0.5 font-display text-label font-bold">왜 중요한가</div>
            <p className="text-ink-secondary">{children}</p>
        </div>
    )
}
