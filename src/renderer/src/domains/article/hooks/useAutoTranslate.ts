// ============================================================================
// 본문 자동 번역
//
// [역할]
// - 번역이 아직 없는 기사를 열면 번역을 자동으로 요청
// - 번역 중 · 번역 실패 여부와 다시 시도 함수를 화면에 제공
// ============================================================================
import { useEffect, useRef, useState } from 'react'
import type { ItemDetailDTO } from '@shared/types'
import { useTranslateItemMutation } from '@/domains/article/queries'

/**
 * 번역이 아직 없는 기사를 열면 번역 요청 (절약 모드였거나 브리핑 밖에서 저장한 기사)
 *
 * - 번역이 끝나면 Worker가 item-updated를 보내 기사 상세를 다시 읽음
 * - 기사마다 한 번만 자동 요청, 실패하면 retry로 다시 요청
 *
 * @param {ItemDetailDTO | null} itemDetail - 지금 보는 기사의 상세 (아직 못 받았으면 null)
 * @returns {{ translating: boolean, failed: boolean, retry: () => void }} 번역 중 여부, 실패 여부, 다시 시도 함수
 */
export function useAutoTranslate(itemDetail: ItemDetailDTO | null) {
    // =============================== 쿼리 훅 ===================================
    const { mutate: translateItem, variables: lastRequestedItemId, isPending, isError, data: wasTranslated } = useTranslateItemMutation()

    // =============================== 상태 ===================================
    const [retryCount, setRetryCount] = useState(0) // 다시 시도한 횟수 (바뀌면 번역을 다시 요청)

    // =============================== Ref ===================================
    const requestedItemIds = useRef(new Set<number>()) // 이미 자동으로 번역을 요청한 기사 번호들

    // =============================== 계산 ===================================
    const itemId = itemDetail?.itemId ?? null
    const isRequestForThisItem = itemId !== null && lastRequestedItemId === itemId // 마지막으로 요청한 기사가 지금 보는 기사인지 (그럴 때만 그 요청의 상태 표시)

    // =============================== useEffect ===================================
    // 번역이 없고 아직 요청하지 않은 기사면 번역 요청
    useEffect(() => {
        if (!itemDetail || itemDetail.translation !== 'missing' || requestedItemIds.current.has(itemDetail.itemId)) return
        requestedItemIds.current.add(itemDetail.itemId)
        translateItem(itemDetail.itemId)
    }, [itemDetail, retryCount, translateItem])

    return {
        isTranslating: isRequestForThisItem && isPending,
        // 번역하지 못했으면(오류, 또는 키 없음 · 하루 상한으로 false) 다시 시도 버튼 표시
        hasFailed: isRequestForThisItem && !isPending && (isError || wasTranslated === false) && itemDetail?.translation === 'missing',
        retry: () => {
            if (itemId === null) return
            requestedItemIds.current.delete(itemId)
            setRetryCount((previousRetryCount) => previousRetryCount + 1)
        }
    }
}
