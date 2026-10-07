import { Caption } from '../ui/Text'

interface Props {
  paragraphs: string[] | null
  fullText: boolean
}

/** 읽기 모드 본문. 문단마다 번호(¶)를 붙인다 — 나중에 하이라이트와 AI 답변 인용의 기준이 된다 */
export function ArticleBody({ paragraphs, fullText }: Props) {
  if (paragraphs === null) return <Caption>본문을 불러오는 중…</Caption>
  if (paragraphs.length === 0) return <Caption>보관된 본문이 없습니다. 기사를 저장하면 원문에서 본문을 가져옵니다.</Caption>
  return (
    <div className="flex flex-col gap-3">
      {!fullText && <Caption>원문 본문을 가져오지 못해 요약·초록만 있습니다.</Caption>}
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {paragraphs.map((p, i) => (
          <li key={i} id={`p-${i + 1}`} className="flex gap-3">
            <span className="w-7 flex-none pt-0.5 text-right font-display text-caption text-ink-faint tabular-nums" aria-hidden="true">
              ¶{i + 1}
            </span>
            <p className="min-w-0 text-reading text-ink-body">{p}</p>
          </li>
        ))}
      </ol>
    </div>
  )
}
