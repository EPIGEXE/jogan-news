// ============================================================================
// 설정 서비스 테스트
//
// [역할]
// - API 키를 저장 · 삭제할 때 Worker에 실제로 쓸 키를 바로 알리는지 확인
// - 저장된 키가 없을 때 개발용 .env 키 또는 null로 돌아가는지 확인
// ============================================================================
import { describe, expect, it, vi } from 'vitest'
import type { ApiKeyStatus } from '@shared/ipc'
import type { ApiKeyStore, WorkerRpc } from './ports'
import { SettingsService } from './settings-service'

/** 메모리에만 저장하는 가짜 키 보관소. envKey는 개발용 .env 키 흉내 */
function memoryKeys(envKey: string | null = null): ApiKeyStore {
  let stored: string | null = null
  return {
    getApiKey: () => stored ?? envKey,
    getStatus: (): ApiKeyStatus =>
      stored ? { source: 'stored', hint: stored.slice(-4) } : envKey ? { source: 'env', hint: envKey.slice(-4) } : { source: 'none', hint: null },
    setApiKey: (k) => {
      stored = k?.trim() || null
    }
  }
}

function setup(envKey: string | null = null) {
  const worker = { call: vi.fn(), setApiKey: vi.fn() } as unknown as WorkerRpc & { setApiKey: ReturnType<typeof vi.fn> }
  const service = new SettingsService({ keys: memoryKeys(envKey), autostart: { isEnabled: () => false, setEnabled: (on) => on }, worker })
  return { service, worker }
}

describe('SettingsService', () => {
  it('키를 저장하면 Worker에 새 키를 바로 알리고 상태를 돌려준다', () => {
    const { service, worker } = setup()
    expect(service.setApiKey('  gsk_abcd1234  ')).toEqual({ source: 'stored', hint: '1234' })
    expect(worker.setApiKey).toHaveBeenLastCalledWith('gsk_abcd1234')
  })

  it('저장된 키를 지우면 개발용 .env 키로 돌아가고 Worker에도 그 키를 알린다', () => {
    const { service, worker } = setup('gsk_env_9999')
    service.setApiKey('gsk_user_1111')
    expect(service.setApiKey(null)).toEqual({ source: 'env', hint: '9999' })
    expect(worker.setApiKey).toHaveBeenLastCalledWith('gsk_env_9999')
  })

  it('키가 하나도 없으면 Worker에 null을 알린다', () => {
    const { service, worker } = setup()
    expect(service.setApiKey('')).toEqual({ source: 'none', hint: null })
    expect(worker.setApiKey).toHaveBeenLastCalledWith(null)
  })
})
