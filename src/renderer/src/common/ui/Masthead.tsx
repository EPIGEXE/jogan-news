import { WORDMARK } from '@shared/wordmark'

/** 제호: 블랙레터 "Jogan" + 이중선 + 작은 부제 (글자 모양은 shared/wordmark.ts의 경로) */
export function Masthead() {
  return (
    <div className="flex flex-col gap-1.5 border-b-3 border-double border-rule-strong pb-3">
      <svg role="img" aria-label="Jogan" viewBox={`0 0 ${WORDMARK.width} ${WORDMARK.height}`} className="h-9 w-auto self-start fill-ink">
        <path d={WORDMARK.d} />
      </svg>
      <span className="text-caption tracking-label text-ink-muted">朝刊 · 매일 아침 AI 소식</span>
    </div>
  )
}
