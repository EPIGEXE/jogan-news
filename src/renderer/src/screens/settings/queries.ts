// ============================================================================
// 설정 화면 조회 · 변경 훅
//
// [역할]
// - API 키 저장 여부 · 설정 값 · 자동 시작 여부를 Main에서 읽어 오기
// - API 키 · 예산 · 자동 시작 변경을 Main에 전달하고 화면의 값 갱신
// ============================================================================
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AppSettings } from '@shared/types'
import { api } from '@/common/lib/api'
import { queryKeys } from '@/common/lib/queryKeys'

// =============================== 조회 ===================================

/**
 * API 키가 저장돼 있는지 조회 (키 값 자체는 화면으로 오지 않음)
 *
 * @returns {UseQueryResult} API 키 상태 조회 결과
 */
export function useApiKeyStatusQuery() {
    return useQuery({ queryKey: queryKeys.apiKey, queryFn: () => api.getApiKeyStatus() })
}

/**
 * 앱 설정 조회
 *
 * @returns {UseQueryResult} 설정 값 조회 결과
 */
export function useSettingsQuery() {
    return useQuery({ queryKey: queryKeys.settings, queryFn: () => api.getSettings() })
}

/**
 * Windows 시작 시 실행이 켜져 있는지 조회
 *
 * @returns {UseQueryResult} 자동 시작 여부 조회 결과
 */
export function useAutostartQuery() {
    return useQuery({ queryKey: queryKeys.autostart, queryFn: () => api.getAutostart() })
}

// =============================== 변경 ===================================

/**
 * API 키 저장 (null이면 저장된 키 삭제)
 *
 * @returns {UseMutationResult} 저장 실행 함수와 진행 상태
 */
export function useSetApiKeyMutation() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (apiKey: string | null) => api.setApiKey(apiKey),
        onSuccess: (apiKeyStatus) => queryClient.setQueryData(queryKeys.apiKey, apiKeyStatus)
    })
}

/**
 * 앱 설정 변경 (바꿀 항목만 전달)
 *
 * @returns {UseMutationResult} 변경 실행 함수와 진행 상태
 */
export function useUpdateSettingsMutation() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (settingsPatch: Partial<AppSettings>) => api.updateSettings(settingsPatch),
        onSuccess: (updatedSettings) => {
            queryClient.setQueryData(queryKeys.settings, updatedSettings)
            // 절약 모드 여부 · 예산 표시가 바뀌므로 사용액 다시 조회 (메뉴 아래 비용 표시도 같은 캐시 사용)
            void queryClient.invalidateQueries({ queryKey: queryKeys.usage })
        }
    })
}

/**
 * Windows 시작 시 실행 켜고 끄기
 *
 * @returns {UseMutationResult} 변경 실행 함수와 진행 상태
 */
export function useSetAutostartMutation() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (shouldAutostart: boolean) => api.setAutostart(shouldAutostart),
        onSuccess: (isAutostartEnabled) => queryClient.setQueryData(queryKeys.autostart, isAutostartEnabled)
    })
}
