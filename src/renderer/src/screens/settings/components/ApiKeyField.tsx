import { useState } from 'react'
import type { ApiKeyStatus } from '@shared/ipc'
import { Button } from '@/common/ui/Button'
import { TextInput } from '@/common/ui/Form'
import { Help } from '@/common/ui/Text'

interface Props {
  status: ApiKeyStatus | null
  onSave(key: string | null): Promise<void>
}

/** 저장된 키를 가려서 보여줄 때: 앞 접두어 + 별표 + 끝 4자리 */
function masked(hint: string | null): string {
  return `gsk_${'*'.repeat(20)}${hint ?? ''}`
}

/**
 * Groq API 키 입력. 키가 있으면 가린 값(gsk_****…끝4자리)만 보여주고,
 * 그 칸이나 "변경"을 누르면 새 키를 입력하는 칸으로 바뀐다. Esc나 "취소"로 돌아간다.
 */
export function ApiKeyField({ status, onSave }: Props) {
  const hasKey = !!status && status.source !== 'none'
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')

  const cancel = () => {
    setEditing(false)
    setValue('')
  }

  const where =
    status?.source === 'stored'
      ? '이 PC의 Windows 계정으로 암호화해서 저장했습니다.'
      : status?.source === 'env'
        ? '개발용 .env 파일에서 읽고 있습니다. 여기서 새 키를 저장하면 그 키를 씁니다.'
        : '키가 없습니다. 입력한 키는 이 PC의 Windows 계정으로 암호화해서 저장합니다.'

  if (hasKey && !editing) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="눌러서 새 키 입력"
            aria-label="저장된 API 키 (눌러서 새 키 입력)"
            className="min-h-10 grow basis-70 cursor-text rounded-control border border-control-border bg-paper-sunken px-3 text-left tracking-wider text-ink-secondary tabular-nums transition-colors duration-120 hover:border-ink"
          >
            {masked(status.hint)}
          </button>
          <Button onClick={() => setEditing(true)}>변경</Button>
          {status.source === 'stored' && (
            <Button variant="text" onClick={() => void onSave(null)}>
              지우기
            </Button>
          )}
        </div>
        <Help>{where}</Help>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <form
        className="flex flex-wrap items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (!value.trim()) return
          void onSave(value.trim()).then(cancel)
        }}
      >
        <label htmlFor="api-key" className="sr-only">
          새 Groq API 키
        </label>
        <TextInput
          id="api-key"
          // "변경"을 눌러 입력 칸으로 바뀌면 바로 입력할 수 있게
          autoFocus={editing}
          type="password"
          autoComplete="off"
          placeholder={hasKey ? '새 키 입력 (gsk_…)' : 'gsk_…'}
          width="wide"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && hasKey) cancel()
          }}
        />
        <Button type="submit" variant="solid" disabled={!value.trim()}>
          저장
        </Button>
        {hasKey && (
          <Button variant="text" onClick={cancel}>
            취소
          </Button>
        )}
      </form>
      <Help>{where}</Help>
    </div>
  )
}
