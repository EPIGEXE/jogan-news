import { describe, expect, it } from 'vitest'
import { normalizeTitle, urlKey } from './normalize'

describe('urlKey', () => {
  it('arXiv abs, pdf, 버전, HF Papers 페이지를 같은 키로 묶는다', () => {
    const k = 'arxiv:2610.01234'
    expect(urlKey('https://arxiv.org/abs/2610.01234')).toBe(k)
    expect(urlKey('https://arxiv.org/pdf/2610.01234v2.pdf')).toBe(k)
    expect(urlKey('http://export.arxiv.org/abs/2610.01234v1')).toBe(k)
    expect(urlKey('https://huggingface.co/papers/2610.01234')).toBe(k)
  })

  it('추적 파라미터, 해시, www, 끝의 /를 버린다', () => {
    expect(urlKey('https://www.example.com/post/?utm_source=x&id=3#top')).toBe('example.com/post?id=3')
    expect(urlKey('https://example.com/post')).toBe('example.com/post')
  })

  it('남는 쿼리는 정렬해서 순서와 무관하게 같게 만든다', () => {
    expect(urlKey('https://a.com/p?b=2&a=1')).toBe(urlKey('https://a.com/p?a=1&b=2'))
  })

  it('HF 블로그 등 일반 huggingface.co 주소는 arXiv로 바꾸지 않는다', () => {
    expect(urlKey('https://huggingface.co/blog/some-post')).toBe('huggingface.co/blog/some-post')
  })
})

describe('normalizeTitle', () => {
  it('대소문자, 공백, 문장부호 차이를 무시한다', () => {
    expect(normalizeTitle('Mistral Large 4 — Preview!')).toBe(normalizeTitle('mistral large 4: preview'))
  })
  it('한글은 유지한다', () => {
    expect(normalizeTitle('소프트웨어 팩토리 패턴')).toBe('소프트웨어팩토리패턴')
  })
})
