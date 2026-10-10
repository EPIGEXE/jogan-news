import { useEffect, useState } from 'react'
import { TextInput } from '@/common/ui/Form'

const DEBOUNCE_MS = 250

interface Props {
  value: string
  /** 입력을 멈추고 잠시 뒤에 불린다 */
  onChange(value: string): void
  label: string
  placeholder?: string
}

/** 검색창. 입력할 때마다가 아니라 잠깐 멈췄을 때 검색한다 */
export function SearchInput({ value, onChange, label, placeholder }: Props) {
  const [text, setText] = useState(value)

  useEffect(() => setText(value), [value])

  useEffect(() => {
    if (text === value) return
    const t = setTimeout(() => onChange(text), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [text, value, onChange])

  return (
    <label className="flex">
      <span className="sr-only">{label}</span>
      <TextInput
        type="search"
        width="wide"
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setText('')
            onChange('')
          }
        }}
      />
    </label>
  )
}
