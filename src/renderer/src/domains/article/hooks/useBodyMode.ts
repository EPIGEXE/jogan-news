// ============================================================================
// 본문 보기 방식
//
// [역할]
// - 기사 본문을 한국어 · 원문 · 함께 보기 중 어느 방식으로 볼지 보관
// - 마지막에 고른 방식을 이 PC에 기억 (다음에 기사를 열 때 그대로 적용)
// ============================================================================
import { useCallback, useState } from 'react'
import type { BodyMode } from '@/domains/article/components/ArticleBody'

const BODY_MODE_STORAGE_KEY = 'ainews.bodyMode' // 고른 보기 방식을 이 PC에 기억해 두는 저장 이름

/**
 * 본문 보기 방식(한국어 · 원문 · 함께 보기)
 *
 * - 이 PC에서 마지막에 고른 값을 기억
 *
 * @returns {readonly [BodyMode, (nextBodyMode: BodyMode) => void]} 지금 보기 방식과, 방식을 바꾸는 함수
 */
export function useBodyMode() {
    // =============================== 상태 ===================================
    // 처음 값은 기억해 둔 값 (없거나 읽지 못하면 한국어)
    const [bodyMode, setBodyMode] = useState<BodyMode>(() => {
        try {
            const storedBodyMode = localStorage.getItem(BODY_MODE_STORAGE_KEY)
            return storedBodyMode === 'original' || storedBodyMode === 'both' ? storedBodyMode : 'ko'
        } catch {
            return 'ko'
        }
    })

    // =============================== 계산 ===================================
    // 보기 방식을 바꾸고 이 PC에 기억
    const changeBodyMode = useCallback((nextBodyMode: BodyMode) => {
        setBodyMode(nextBodyMode)
        try {
            localStorage.setItem(BODY_MODE_STORAGE_KEY, nextBodyMode)
        } catch {
            // 기억하지 못해도 이번 화면에서는 바뀐 값 사용
        }
    }, [])

    return [bodyMode, changeBodyMode] as const
}
