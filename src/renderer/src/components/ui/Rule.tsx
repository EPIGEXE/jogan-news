const VARIANT = {
  hairline: 'border-t border-rule',
  soft: 'border-t border-rule-soft',
  strong: 'border-t border-rule-strong',
  double: 'border-t-3 border-double border-rule-strong'
} as const

/** 괘선. 칸 구분은 박스나 그림자 대신 이것으로 한다 */
export function Rule({ variant = 'hairline' }: { variant?: keyof typeof VARIANT }) {
  return <hr className={`m-0 border-0 ${VARIANT[variant]}`} />
}
