import { useEffect, useRef, type ReactNode } from 'react'

interface Props {
  open: boolean
  onClose(): void
  title: string
  children: ReactNode
  /** 아래쪽 버튼 줄 */
  actions?: ReactNode
}

/** 가운데 뜨는 대화상자. 브라우저 기본 <dialog>라서 Esc로 닫히고 포커스가 안에 갇힌다 */
export function Dialog({ open, onClose, title, children, actions }: Props) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        // 바깥(어두운 배경)을 누르면 닫는다
        if (e.target === ref.current) onClose()
      }}
      className="paper-dialog m-auto w-full max-w-120 rounded-control border border-rule-strong bg-paper p-0 text-ink"
    >
      <div className="flex flex-col gap-4 p-6">
        <h2 className="border-b-3 border-double border-rule-strong pb-2 font-display text-subhead font-bold">{title}</h2>
        <div>{children}</div>
        {actions && <div className="flex flex-wrap justify-end gap-2">{actions}</div>}
      </div>
    </dialog>
  )
}
