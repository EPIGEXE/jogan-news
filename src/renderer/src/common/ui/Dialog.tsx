// ============================================================================
// 대화상자
//
// [역할]
// - 화면 가운데에 제목 · 내용 · 버튼 줄을 담은 대화상자 표시
// - Esc나 바깥(어두운 배경) 클릭으로 닫기
// ============================================================================
import { useEffect, useRef, type ReactNode } from 'react'

interface Props {
    open: boolean
    onClose(): void // Esc · 바깥 클릭으로 닫힐 때 호출
    title: string
    children: ReactNode
    actions?: ReactNode // 아래쪽 버튼 줄
}

/**
 * 가운데 뜨는 대화상자
 *
 * - 브라우저 기본 <dialog>라서 Esc로 닫히고 포커스가 안에 갇힘
 *
 * @returns {JSX.Element} 제목 · 내용 · 버튼 줄을 담은 대화상자
 */
export function Dialog({ open, onClose, title, children, actions }: Props) {
    // =============================== Ref ===================================
    const dialogRef = useRef<HTMLDialogElement>(null) // <dialog> 요소 (열기 · 닫기와 바깥 클릭 판별에 사용)

    // =============================== useEffect ===================================
    // open 값에 맞춰 대화상자 열기 · 닫기
    useEffect(() => {
        const dialogElement = dialogRef.current
        if (!dialogElement) return
        if (open && !dialogElement.open) dialogElement.showModal()
        if (!open && dialogElement.open) dialogElement.close()
    }, [open])

    return (
        <dialog
            ref={dialogRef}
            onClose={onClose}
            onClick={(mouseEvent) => {
                // 바깥(어두운 배경)을 누르면 닫기
                if (mouseEvent.target === dialogRef.current) onClose()
            }}
            className="paper-dialog m-auto w-full max-w-120 rounded-control border border-rule-strong bg-paper p-0 text-ink"
        >
            <div className="flex flex-col gap-4 p-6">
                {/* 제목 */}
                <h2 className="border-b-3 border-double border-rule-strong pb-2 font-display text-subhead font-bold">{title}</h2>

                {/* 내용 */}
                <div>{children}</div>

                {/* 버튼 줄 */}
                {actions && <div className="flex flex-wrap justify-end gap-2">{actions}</div>}
            </div>
        </dialog>
    )
}
