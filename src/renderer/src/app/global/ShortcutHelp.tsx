// ============================================================================
// 단축키 안내
//
// [역할]
// - 앱에서 쓸 수 있는 단축키를 화면별로 묶어 대화상자로 표시
// - ? 키를 누르면 안내 열기 (입력란에 글을 쓰는 중에는 무시)
// ============================================================================
import { useEffect } from 'react'
import { Dialog } from '@/common/ui/Dialog'

// 안내에 보여줄 단축키 목록 (묶음 제목과 [키, 설명] 쌍)
const SHORTCUT_GROUPS: { title: string; keys: [string, string][] }[] = [
    {
        title: '목록 (오늘·라이브러리·아카이브)',
        keys: [
            ['J / ↓', '다음 기사'],
            ['K / ↑', '이전 기사'],
            ['Enter', '기사 읽기'],
            ['S', '저장 / 저장 해제'],
            ['O', '원문 열기']
        ]
    },
    {
        title: '기사 읽기 화면',
        keys: [
            ['Esc', '목록으로'],
            ['J / K', '다음·이전 기사'],
            ['M', '메모 쓰기'],
            ['/', '질문하기'],
            ['T', '본문 한국어 · 원문 · 함께 보기 전환'],
            ['H', '드래그한 문장 하이라이트'],
            ['S · O', '저장 · 원문 열기']
        ]
    },
    {
        title: '어디서나',
        keys: [
            ['Ctrl + Alt + N', '앱 창 열기 (다른 프로그램을 쓰는 중에도)'],
            ['?', '이 단축키 안내']
        ]
    }
]

// 입력란에 글을 쓰는 중인지
function isTyping(keyboardEvent: KeyboardEvent): boolean {
    const targetElement = keyboardEvent.target as HTMLElement | null
    return !!targetElement && (targetElement.tagName === 'INPUT' || targetElement.tagName === 'TEXTAREA' || targetElement.isContentEditable)
}

/**
 * 단축키 안내 대화상자
 *
 * - ? 키를 누르거나 메뉴 아래 "? 단축키"를 누르면 표시
 *
 * @returns {JSX.Element} 단축키 목록을 담은 대화상자
 */
export function ShortcutHelp({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
    // ? 키로 안내 열기
    useEffect(() => {
        const onKeyDown = (keyboardEvent: KeyboardEvent) => {
            if (keyboardEvent.key === '?' && !isTyping(keyboardEvent)) {
                keyboardEvent.preventDefault()
                onOpenChange(true)
            }
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [onOpenChange])

    return (
        <Dialog open={open} onClose={() => onOpenChange(false)} title="단축키">
            <div className="flex flex-col gap-5">
                {/* 단축키 묶음 */}
                {SHORTCUT_GROUPS.map((shortcutGroup) => (
                    <section key={shortcutGroup.title} className="flex flex-col gap-2">
                        <h3 className="font-display text-label font-bold tracking-label text-accent">{shortcutGroup.title}</h3>
                        <dl className="m-0 flex flex-col gap-1">
                            {shortcutGroup.keys.map(([keyLabel, keyDescription]) => (
                                <div key={keyLabel} className="flex gap-4">
                                    <dt className="w-32 flex-none font-bold text-ink">{keyLabel}</dt>
                                    <dd className="m-0 text-ink-secondary">{keyDescription}</dd>
                                </div>
                            ))}
                        </dl>
                    </section>
                ))}
            </div>
        </Dialog>
    )
}
