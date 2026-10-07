/** 조건부 클래스 이름 합치기: cn('a', on && 'b') */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}
