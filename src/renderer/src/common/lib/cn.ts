// ============================================================================
// 클래스 이름 합치기
//
// [역할]
// - 조건에 따라 붙이거나 빼는 CSS 클래스 이름을 한 문자열로 합침
// ============================================================================

/**
 * 조건부 클래스 이름 합치기 (예: cn('a', on && 'b'))
 *
 * @param {(string | false | null | undefined)[]} parts - 클래스 이름들 (false · null · undefined · 빈 문자열은 제외)
 * @returns {string} 공백으로 이어 붙인 클래스 이름
 */
export function cn(...parts: (string | false | null | undefined)[]): string {
    return parts.filter(Boolean).join(' ')
}
