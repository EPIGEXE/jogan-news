const DAYS = ['일', '월', '화', '수', '목', '금', '토']

/** '2026-10-07' → '2026년 10월 7일 수요일' */
export function formatKoreanDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number]
  const day = new Date(y, m - 1, d).getDay()
  return `${y}년 ${m}월 ${d}일 ${DAYS[day]}요일`
}

/** 'YYYY-MM-DD' 또는 ISO 시각 → '10/7(수)' */
export function formatShortDate(value: string): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value)
  return `${d.getMonth() + 1}/${d.getDate()}(${DAYS[d.getDay()]})`
}

/** ISO 시각 → '07:41' */
export function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function formatUsd(n: number): string {
  return `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}`
}

/** 로컬 날짜 'YYYY-MM-DD' */
export function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
