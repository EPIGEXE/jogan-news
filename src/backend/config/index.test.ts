// ============================================================================
// 설정 읽기 테스트
//
// [역할]
// - 저장소의 실제 설정 폴더(config/)가 오류 없이 읽히는지 확인
// - 설정에 적힌 모델의 단가가 단가표에 없으면 읽기를 거부하는지 확인 (비용을 못 세면 예산 · 하루 상한이 꺼지기 때문)
// ============================================================================
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from './index'

let tempConfigDir: string | null = null
afterEach(() => {
    if (tempConfigDir) rmSync(tempConfigDir, { recursive: true, force: true })
    tempConfigDir = null
})

describe('loadConfig', () => {
    it('저장소의 설정 폴더를 읽는다 (쓰는 모델마다 단가가 있음)', () => {
        const appConfig = loadConfig('config')
        for (const roleModelSpec of Object.values(appConfig.models)) expect(appConfig.pricing[roleModelSpec.model]).toBeDefined()
    })

    it('단가표에 없는 모델을 쓰면 어느 모델인지 알리고 읽기를 거부한다', () => {
        // 실제 설정을 복사한 뒤 단가표에서 한 모델만 남김
        tempConfigDir = mkdtempSync(join(tmpdir(), 'jogan-config-'))
        cpSync('config', tempConfigDir, { recursive: true })
        writeFileSync(join(tempConfigDir, 'pricing.yaml'), 'openai/gpt-oss-20b:\n  input: 0.075\n  cached_input: 0.0375\n  output: 0.30\n')

        expect(() => loadConfig(tempConfigDir!)).toThrow(/openai\/gpt-oss-120b.*pricing\.yaml/)
    })
})
