import { Button } from '../ui/Button'

interface Props {
  saved: boolean
  onToggleSave(): void
  onOpenOriginal(): void
}

/** 저장 / 원문 열기 */
export function ArticleActions({ saved, onToggleSave, onOpenOriginal }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant={saved ? 'solid' : 'outline'}
        icon="bookmark"
        iconFilled={saved}
        aria-pressed={saved}
        onClick={onToggleSave}
        title="저장 (S)"
      >
        {saved ? '저장됨' : '저장'}
      </Button>
      <Button icon="external" onClick={onOpenOriginal} title="원문 열기 (Enter)">
        원문 열기
      </Button>
    </div>
  )
}
