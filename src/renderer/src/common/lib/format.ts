// ============================================================================
// 표시 형식
//
// [역할]
// - 날짜 · 시각 · 금액을 화면에 보여줄 글자로 변환
// - 오늘 날짜를 저장 · 조회에 쓰는 형식(YYYY-MM-DD)으로 제공
// ============================================================================

const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'] // 요일 이름 (Date.getDay() 순서)

/**
 * 날짜를 한국어 긴 형식으로 변환 (예: '2026-10-07'을 '2026년 10월 7일 수요일'로)
 *
 * @param {string} dateKey - 'YYYY-MM-DD' 날짜
 * @returns {string} '2026년 10월 7일 수요일' 모양의 글자
 */
export function formatKoreanDate(dateKey: string): string {
    const [year, month, dayOfMonth] = dateKey.split('-').map(Number) as [number, number, number]
    const weekdayIndex = new Date(year, month - 1, dayOfMonth).getDay()
    return `${year}년 ${month}월 ${dayOfMonth}일 ${WEEKDAY_NAMES[weekdayIndex]}요일`
}

/**
 * 날짜를 짧은 형식으로 변환 (예: '10/7(수)')
 *
 * @param {string} dateKeyOrIso - 'YYYY-MM-DD' 또는 ISO 시각
 * @returns {string} '월/일(요일)' 모양의 글자
 */
export function formatShortDate(dateKeyOrIso: string): string {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateKeyOrIso) ? new Date(`${dateKeyOrIso}T00:00:00`) : new Date(dateKeyOrIso)
    return `${date.getMonth() + 1}/${date.getDate()}(${WEEKDAY_NAMES[date.getDay()]})`
}

/**
 * 시각을 시:분으로 변환 (예: '07:41')
 *
 * @param {string} isoTime - ISO 시각
 * @returns {string} 두 자리 시와 분 (로컬 시간)
 */
export function formatTime(isoTime: string): string {
    const time = new Date(isoTime)
    return `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
}

/**
 * 금액을 달러 표기로 변환
 *
 * @param {number} amountUsd - 금액 (달러)
 * @returns {string} '$' 붙인 금액 (1달러 미만은 소수 셋째 자리, 그 이상은 둘째 자리까지)
 */
export function formatUsd(amountUsd: number): string {
    return `$${amountUsd < 1 ? amountUsd.toFixed(3) : amountUsd.toFixed(2)}`
}

/**
 * 오늘 날짜 읽기
 *
 * @returns {string} 로컬 날짜 'YYYY-MM-DD'
 */
export function todayKey(): string {
    const today = new Date()
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}
