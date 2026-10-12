// ============================================================================
// API 키 입력란
//
// [역할]
// - 저장된 Groq API 키를 가린 값으로 표시
// - 새 키 입력 · 저장 · 삭제
// - 키가 어디에 저장돼 있는지 안내
// ============================================================================
import { useState } from 'react'
import type { ApiKeyStatus } from '@shared/ipc'
import { Button } from '@/common/ui/Button'
import { TextInput } from '@/common/ui/Form'
import { HelpText } from '@/common/ui/Text'

interface Props {
    apiKeyStatus: ApiKeyStatus | null // 키 저장 상태 (읽어 오는 중이면 null)
    onSave(key: string | null): Promise<void> // 키 저장 (null이면 저장된 키 삭제)
}

// 저장된 키를 가려서 보여줄 때의 글자 (앞 접두어 + 별표 + 끝 4자리)
function maskedApiKey(keyHint: string | null): string {
    return `gsk_${'*'.repeat(20)}${keyHint ?? ''}`
}

/**
 * Groq API 키 입력
 *
 * - 키가 있으면 가린 값(gsk_****…끝4자리)만 표시
 * - 그 칸이나 "변경"을 누르면 새 키를 입력하는 칸으로 전환, Esc나 "취소"로 복귀
 *
 * @returns {JSX.Element} 키 표시 또는 입력란
 */
export function ApiKeyField({ apiKeyStatus, onSave }: Props) {
    // =============================== 상태 ===================================
    const [isEditing, setIsEditing] = useState(false) // 새 키를 입력하는 중인지
    const [newApiKey, setNewApiKey] = useState('') // 입력 중인 새 키

    // =============================== 계산 ===================================
    const hasKey = !!apiKeyStatus && apiKeyStatus.source !== 'none' // 쓸 수 있는 키가 있는지

    // 입력을 그만두고 가린 값 표시로 복귀
    const cancelEditing = () => {
        setIsEditing(false)
        setNewApiKey('')
    }

    // 키가 어디에 저장돼 있는지 알려주는 안내 문구
    const storageNotice =
        apiKeyStatus?.source === 'stored'
            ? '이 PC의 Windows 계정으로 암호화해서 저장했습니다.'
            : apiKeyStatus?.source === 'env'
              ? '개발용 .env 파일에서 읽고 있습니다. 여기서 새 키를 저장하면 그 키를 씁니다.'
              : '키가 없습니다. 입력한 키는 이 PC의 Windows 계정으로 암호화해서 저장합니다.'

    // 키가 있고 입력 중이 아니면 가린 값 표시
    if (hasKey && !isEditing) {
        return (
            <div className="flex flex-col gap-2">
                {/* 가린 키 · 변경 · 지우기 */}
                <div className="flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        onClick={() => setIsEditing(true)}
                        title="눌러서 새 키 입력"
                        aria-label="저장된 API 키 (눌러서 새 키 입력)"
                        className="min-h-10 grow basis-70 cursor-text rounded-control border border-control-border bg-paper-sunken px-3 text-left tracking-wider text-ink-secondary tabular-nums transition-colors duration-120 hover:border-ink"
                    >
                        {maskedApiKey(apiKeyStatus.hint)}
                    </button>
                    <Button onClick={() => setIsEditing(true)}>변경</Button>
                    {apiKeyStatus.source === 'stored' && (
                        <Button variant="text" onClick={() => void onSave(null)}>
                            지우기
                        </Button>
                    )}
                </div>
                <HelpText>{storageNotice}</HelpText>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-2">
            {/* 새 키 입력 (저장에 성공하면 입력란을 비우고 가린 값 표시로 복귀) */}
            <form
                className="flex flex-wrap items-center gap-3"
                onSubmit={(submitEvent) => {
                    submitEvent.preventDefault()
                    if (!newApiKey.trim()) return
                    void onSave(newApiKey.trim()).then(cancelEditing)
                }}
            >
                <label htmlFor="api-key" className="sr-only">
                    새 Groq API 키
                </label>
                <TextInput
                    id="api-key"
                    // "변경"을 눌러 입력 칸으로 바뀌면 바로 입력할 수 있게
                    autoFocus={isEditing}
                    type="password"
                    autoComplete="off"
                    placeholder={hasKey ? '새 키 입력 (gsk_…)' : 'gsk_…'}
                    width="wide"
                    value={newApiKey}
                    onChange={(changeEvent) => setNewApiKey(changeEvent.target.value)}
                    onKeyDown={(keyboardEvent) => {
                        if (keyboardEvent.key === 'Escape' && hasKey) cancelEditing()
                    }}
                />
                <Button type="submit" variant="solid" disabled={!newApiKey.trim()}>
                    저장
                </Button>
                {hasKey && (
                    <Button variant="text" onClick={cancelEditing}>
                        취소
                    </Button>
                )}
            </form>
            <HelpText>{storageNotice}</HelpText>
        </div>
    )
}
