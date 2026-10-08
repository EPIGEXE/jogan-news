import { useEffect } from 'react'
import { Dialog } from '../ui/Dialog'

const GROUPS: { title: string; keys: [string, string][] }[] = [
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

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
}

/** 단축키 안내. ? 키를 누르거나 메뉴 아래 "? 단축키"를 누르면 뜬다 */
export function ShortcutHelp({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '?' && !isTyping(e)) {
        e.preventDefault()
        onOpenChange(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onOpenChange])

  return (
    <Dialog open={open} onClose={() => onOpenChange(false)} title="단축키">
      <div className="flex flex-col gap-5">
        {GROUPS.map((g) => (
          <section key={g.title} className="flex flex-col gap-2">
            <h3 className="font-display text-label font-bold tracking-label text-accent">{g.title}</h3>
            <dl className="m-0 flex flex-col gap-1">
              {g.keys.map(([k, v]) => (
                <div key={k} className="flex gap-4">
                  <dt className="w-32 flex-none font-bold text-ink">{k}</dt>
                  <dd className="m-0 text-ink-secondary">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  )
}
