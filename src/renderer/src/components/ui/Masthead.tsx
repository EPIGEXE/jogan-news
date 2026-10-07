/** 제호 + 이중선 */
export function Masthead({ children }: { children: string }) {
  return (
    <div className="border-b-3 border-double border-rule-strong pb-3 font-display text-masthead font-bold tracking-tight">
      {children}
    </div>
  )
}
