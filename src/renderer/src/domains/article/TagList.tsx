import { useState } from 'react'
import { Button } from '@/common/ui/Button'
import { TextInput } from '@/common/ui/Form'
import { Tag } from '@/common/ui/Tag'

interface Props {
  tags: string[]
  onAdd(name: string): void
  onRemove(name: string): void
  /** 저장 직후 AI가 태그를 추천하는 중 */
  pending?: boolean
}

/** 기사에 붙은 태그와 태그 추가 입력 */
export function TagList({ tags, onAdd, onRemove, pending = false }: Props) {
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')

  const submit = () => {
    if (text.trim()) onAdd(text)
    setText('')
    setAdding(false)
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {tags.map((t) => (
        <Tag key={t} name={t} onRemove={() => onRemove(t)} />
      ))}
      {pending && tags.length === 0 && <span className="text-caption text-ink-faint">태그 추천 중…</span>}
      {adding ? (
        <form
          className="flex"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <label className="sr-only" htmlFor="tag-input">
            새 태그
          </label>
          <TextInput
            id="tag-input"
            autoFocus
            width="narrow"
            placeholder="태그"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={submit}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setText('')
                setAdding(false)
              }
            }}
          />
        </form>
      ) : (
        <Button variant="text" onClick={() => setAdding(true)}>
          태그 추가
        </Button>
      )}
    </div>
  )
}
