// ============================================================================
// 설정 저장소 테스트
//
// [역할]
// - 메모리 DB에 실제 쿼리를 돌려 설정 행의 조회와 저장 확인
// - 저장한 적 없으면 빈 목록, 같은 키를 다시 저장하면 값만 교체
// ============================================================================
import { describe, expect, it } from 'vitest'
import { openTestDatabase } from '@data/testing'
import { createSettingsRepository } from './settings-repository'

describe('settings-repository', () => {
    it('저장한 설정이 없으면 빈 목록을 돌려준다 (기본값은 서비스가 채움)', () => {
        const settingsRepository = createSettingsRepository(openTestDatabase())
        expect(settingsRepository.listSettings()).toEqual([])
    })

    it('설정 저장: 키마다 한 행으로 저장하고, 값은 받은 글자 그대로 둔다', () => {
        const settingsRepository = createSettingsRepository(openTestDatabase())
        settingsRepository.upsertSetting('budgetUsd', '3')
        settingsRepository.upsertSetting('dailyCapUsd', '0.5')

        const settingRows = settingsRepository.listSettings().sort((leftRow, rightRow) => leftRow.key.localeCompare(rightRow.key))
        expect(settingRows).toEqual([
            { key: 'budgetUsd', value: '3' },
            { key: 'dailyCapUsd', value: '0.5' }
        ])
    })

    it('설정 저장: 이미 있는 키면 값만 바꾸고 다른 키는 그대로 둔다', () => {
        const settingsRepository = createSettingsRepository(openTestDatabase())
        settingsRepository.upsertSetting('budgetUsd', '3')
        settingsRepository.upsertSetting('digestSize', '20')
        settingsRepository.upsertSetting('budgetUsd', '7')

        const valueByKey = Object.fromEntries(settingsRepository.listSettings().map((settingRow) => [settingRow.key, settingRow.value]))
        expect(valueByKey).toEqual({ budgetUsd: '7', digestSize: '20' })
    })
})
