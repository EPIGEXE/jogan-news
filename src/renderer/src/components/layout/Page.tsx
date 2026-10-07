import type { ReactNode } from 'react'
import { SectionLabel } from '../ui/Text'

// 단일 단 화면(설정, 진단, 준비 중 화면)의 지면 틀

export function PageBody({ children }: { children: ReactNode }) {
  return <div className="flex max-w-190 flex-col gap-6 px-7 pt-6 pb-7">{children}</div>
}

export function PageTitle({ children }: { children: string }) {
  return (
    <h1 className="border-b-3 border-double border-rule-strong pb-3 font-display text-headline font-bold tracking-tight">
      {children}
    </h1>
  )
}

/** 섹션 이름(+ 오른쪽 보조 정보)과 내용, 아래 괘선 */
export function PageSection({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-rule pb-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <SectionLabel as="h2">{title}</SectionLabel>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** 가로로 늘어놓는 줄 (버튼·입력란 묶음) */
export function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3">{children}</div>
}
