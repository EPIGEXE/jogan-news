// ============================================================================
// GitHub 릴리스 버전 판별 테스트
//
// [역할]
// - 메이저 · 마이너 버전(x.y, x.y.0)만 소식으로 받는지 확인
// - 패치 버전 · 프리릴리스 · 버전 형식이 아닌 태그를 버리는지 확인
// ============================================================================
import { describe, expect, it } from 'vitest'
import { releaseVersion } from './index'

describe('releaseVersion', () => {
  it('메이저·마이너 버전만 받는다', () => {
    expect(releaseVersion('v0.31.0')).toBe('0.31.0')
    expect(releaseVersion('v2.1')).toBe('2.1')
    expect(releaseVersion('langgraph==1.2.0')).toBe('1.2.0')
  })

  it('패치 버전은 버린다', () => {
    expect(releaseVersion('v0.40.1')).toBeNull()
    expect(releaseVersion('langgraph-cli==0.4.33')).toBeNull()
  })

  it('프리릴리스는 버린다', () => {
    expect(releaseVersion('v0.31.0rc1')).toBeNull()
    expect(releaseVersion('v1.0.0-beta.2')).toBeNull()
    expect(releaseVersion('1.2.0a1')).toBeNull()
    expect(releaseVersion('v0.32.0-dev')).toBeNull()
  })

  it('버전 형식이 아니면 버린다 (llama.cpp의 b6789 같은 빌드 번호)', () => {
    expect(releaseVersion('b6789')).toBeNull()
  })
})
