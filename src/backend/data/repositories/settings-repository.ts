// ============================================================================
// 설정 저장소
//
// [역할]
// - 사용자 설정(settings)을 키 · 값 행으로 읽고 씀 (Main이 쓰는 테이블)
// - 값은 받은 글자 그대로 저장 (JSON으로 바꾸고 푸는 일은 서비스)
// - 규칙은 넣지 않음 (기본값 채우기, 설정 항목의 타입, 값이 없는 항목 건너뛰기는 서비스)
// ============================================================================
import type { AppDatabase } from '@data/client'
import { settings } from '@data/schema'

export type SettingRow = typeof settings.$inferSelect // 설정 한 행 (키 · 값)

export interface SettingsRepository {
    listSettings(): SettingRow[] // 저장된 설정 전부 (저장한 적 없는 항목은 행이 없음)
    upsertSetting(settingKey: string, settingValue: string): void // 설정 한 항목 저장 (이미 있으면 값만 교체)
}

/**
 * 설정 저장소 생성
 *
 * @param {AppDatabase} database - DB 연결
 * @returns {SettingsRepository} 설정 저장소
 */
export function createSettingsRepository(database: AppDatabase): SettingsRepository {
    return {
        listSettings() {
            return database.select().from(settings).all()
        },

        upsertSetting(settingKey, settingValue) {
            database
                .insert(settings)
                .values({ key: settingKey, value: settingValue })
                .onConflictDoUpdate({ target: settings.key, set: { value: settingValue } })
                .run()
        }
    }
}
