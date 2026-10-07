import { describe, expect, it } from 'vitest'
import { TriageJsonSchema } from '../pipeline/schemas'
import { unwrapArrays } from './groq'

describe('unwrapArrays', () => {
  it('배열 자리에 {items: [...]}로 감싸 온 값을 배열로 푼다', () => {
    const wrapped = { results: { items: [{ id: 1, category: 'research', relevance: 0.5, importance: 3 }] } }
    expect(unwrapArrays(wrapped, TriageJsonSchema)).toEqual({
      results: [{ id: 1, category: 'research', relevance: 0.5, importance: 3 }]
    })
  })

  it('정상 값은 그대로 둔다', () => {
    const ok = { results: [{ id: 2, category: 'other', relevance: 0, importance: 1 }] }
    expect(unwrapArrays(ok, TriageJsonSchema)).toEqual(ok)
  })
})
