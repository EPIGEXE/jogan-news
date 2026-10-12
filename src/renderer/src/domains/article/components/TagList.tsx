// ============================================================================
// 태그 목록
//
// [역할]
// - 기사에 붙은 태그를 나열하고 태그마다 떼기 제공
// - "태그 추가"를 누르면 입력창으로 바뀌어 새 태그 입력
// - 저장 직후 AI가 태그를 추천하는 동안 "태그 추천 중" 표시
// ============================================================================
import { useState } from 'react'
import { Button } from '@/common/ui/Button'
import { TextInput } from '@/common/ui/Form'
import { Tag } from '@/common/ui/Tag'

interface Props {
    tags: string[]
    onAdd(name: string): void
    onRemove(name: string): void
    isSuggestingTags?: boolean // 저장 직후 AI가 태그를 추천하는 중인지
}

/**
 * 기사에 붙은 태그와 태그 추가 입력
 *
 * @returns {JSX.Element} 태그 목록과 추가 버튼(또는 입력창)
 */
export function TagList({ tags, onAdd, onRemove, isSuggestingTags = false }: Props) {
    // =============================== 상태 ===================================
    const [isAdding, setIsAdding] = useState(false) // 태그 입력창이 열려 있는지
    const [tagNameDraft, setTagNameDraft] = useState('') // 입력 중인 태그 이름

    // =============================== 계산 ===================================
    // 입력한 이름으로 태그를 붙이고 입력창 닫기 (빈 이름이면 닫기만)
    const submitTag = () => {
        if (tagNameDraft.trim()) onAdd(tagNameDraft)
        setTagNameDraft('')
        setIsAdding(false)
    }

    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {/* 붙어 있는 태그 */}
            {tags.map((tag) => (
                <Tag key={tag} name={tag} onRemove={() => onRemove(tag)} />
            ))}
            {isSuggestingTags && tags.length === 0 && <span className="text-caption text-ink-faint">태그 추천 중…</span>}

            {/* 태그 추가 (입력창 또는 버튼) */}
            {isAdding ? (
                <form
                    className="flex"
                    onSubmit={(submitEvent) => {
                        submitEvent.preventDefault()
                        submitTag()
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
                        value={tagNameDraft}
                        onChange={(changeEvent) => setTagNameDraft(changeEvent.target.value)}
                        onBlur={submitTag}
                        onKeyDown={(keyboardEvent) => {
                            // Esc는 붙이지 않고 닫기
                            if (keyboardEvent.key === 'Escape') {
                                setTagNameDraft('')
                                setIsAdding(false)
                            }
                        }}
                    />
                </form>
            ) : (
                <Button variant="text" onClick={() => setIsAdding(true)}>
                    태그 추가
                </Button>
            )}
        </div>
    )
}
