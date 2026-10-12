// ============================================================================
// 검색창
//
// [역할]
// - 검색어 입력란 표시
// - 입력할 때마다가 아니라 입력이 잠깐 멈췄을 때 검색어 전달
// - Esc로 검색어 지우기
// ============================================================================
import { useEffect, useState } from 'react'
import { TextInput } from '@/common/ui/Form'

const DEBOUNCE_MS = 250 // 입력이 멈춘 뒤 검색어를 전달하기까지 기다리는 시간 (ms)

interface Props {
    value: string // 지금 적용된 검색어
    onChange(value: string): void // 입력을 멈추고 잠시 뒤에 호출
    label: string // 화면 낭독기용 이름 (화면에는 보이지 않음)
    placeholder?: string
}

/**
 * 검색창
 *
 * - 입력할 때마다가 아니라 잠깐 멈췄을 때 검색
 *
 * @returns {JSX.Element} 검색어 입력란
 */
export function SearchInput({ value, onChange, label, placeholder }: Props) {
    // =============================== 상태 ===================================
    const [draftQuery, setDraftQuery] = useState(value) // 입력란에 보이는 글자 (아직 전달하지 않은 입력 포함)

    // =============================== useEffect ===================================
    // 바깥에서 검색어가 바뀌면 입력란에 반영
    useEffect(() => setDraftQuery(value), [value])

    // 입력이 멈추고 잠시 뒤에 바뀐 검색어 전달 (그 사이에 다시 입력하면 기다리던 전달 취소)
    useEffect(() => {
        if (draftQuery === value) return
        const debounceTimer = setTimeout(() => onChange(draftQuery), DEBOUNCE_MS)
        return () => clearTimeout(debounceTimer)
    }, [draftQuery, value, onChange])

    return (
        <label className="flex">
            <span className="sr-only">{label}</span>
            <TextInput
                type="search"
                width="wide"
                placeholder={placeholder}
                value={draftQuery}
                onChange={(changeEvent) => setDraftQuery(changeEvent.target.value)}
                onKeyDown={(keyboardEvent) => {
                    // Esc를 누르면 기다리지 않고 바로 검색어 지우기
                    if (keyboardEvent.key === 'Escape') {
                        setDraftQuery('')
                        onChange('')
                    }
                }}
            />
        </label>
    )
}
