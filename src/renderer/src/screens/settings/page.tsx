// ============================================================================
// 설정 화면
//
// [역할]
// - Groq API 키 저장 · 변경 · 삭제
// - 월 예산과 하루 상한 설정, 이번 달 · 오늘 사용액 표시
// - Windows 시작 시 실행 켜고 끄기, 진단 화면으로 이동
// ============================================================================
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { ApiKeyField } from '@/screens/settings/components/ApiKeyField'
import {
    useApiKeyStatusQuery,
    useAutostartQuery,
    useSetApiKeyMutation,
    useSetAutostartMutation,
    useSettingsQuery,
    useUpdateSettingsMutation
} from '@/screens/settings/queries'
import { SinglePane } from '@/common/layout/AppShell'
import { PageBody, PageSection, PageTitle, PageRow } from '@/common/layout/Page'
import { Button } from '@/common/ui/Button'
import { Checkbox, Field, TextInput } from '@/common/ui/Form'
import { HelpText, MetaText } from '@/common/ui/Text'
import { formatUsd } from '@/common/lib/format'
import { paths } from '@/common/lib/paths'
import { useUsageQuery } from '@/common/lib/useUsageQuery'

/**
 * 설정 화면 (API 키 · 예산 · 실행)
 *
 * @returns {JSX.Element} 설정 화면
 */
export function SettingsPage() {
    // =============================== 훅 ===================================
    const navigate = useNavigate()

    // =============================== 쿼리 훅 ===================================
    const apiKeyStatus = useApiKeyStatusQuery().data ?? null
    const settings = useSettingsQuery().data ?? null
    const isAutostartEnabled = useAutostartQuery().data ?? null // Windows 시작 시 실행 여부 (읽어 오는 중이면 null)
    const { mutateAsync: setApiKey } = useSetApiKeyMutation()
    const { mutateAsync: updateSettings } = useUpdateSettingsMutation()
    const { mutate: setAutostart } = useSetAutostartMutation()
    const usage = useUsageQuery().data ?? null // 이번 달 · 오늘 LLM 사용액

    // =============================== 상태 ===================================
    // 입력란은 고치는 동안의 값이라 화면 상태로 두고, 설정을 처음 읽었을 때 채움
    const [budgetInput, setBudgetInput] = useState('')
    const [dailyCapInput, setDailyCapInput] = useState('')
    const [statusMessage, setStatusMessage] = useState<string | null>(null) // 저장 결과 · 입력 오류 안내 문구

    // =============================== 계산 ===================================
    // API 키 저장 (null이면 저장된 키 삭제)
    const saveApiKey = async (apiKey: string | null) => {
        await setApiKey(apiKey)
        setStatusMessage(apiKey ? 'API 키를 저장했습니다.' : '저장된 API 키를 지웠습니다.')
    }

    // 예산 저장 (둘 다 0보다 큰 숫자일 때만)
    const saveBudget = async () => {
        const budgetUsd = Number(budgetInput)
        const dailyCapUsd = Number(dailyCapInput)
        if (!(budgetUsd > 0) || !(dailyCapUsd > 0)) {
            setStatusMessage('예산과 하루 상한은 0보다 큰 숫자여야 합니다.')
            return
        }
        await updateSettings({ budgetUsd, dailyCapUsd })
        setStatusMessage('예산을 저장했습니다.')
    }

    const isBudgetUnchanged = !settings || (budgetInput === String(settings.budgetUsd) && dailyCapInput === String(settings.dailyCapUsd)) // 입력값이 저장된 값과 같은지 (같으면 저장 버튼 비활성)

    // =============================== useEffect ===================================
    // 설정을 읽으면 예산 입력란에 저장된 값 채우기
    useEffect(() => {
        if (!settings) return
        setBudgetInput(String(settings.budgetUsd))
        setDailyCapInput(String(settings.dailyCapUsd))
    }, [settings])

    return (
        <SinglePane label="설정">
            <PageBody>
                {/* 제목 · 저장 결과 안내 */}
                <PageTitle>설정</PageTitle>
                {statusMessage && <HelpText role="status">{statusMessage}</HelpText>}

                {/* API 키 */}
                <PageSection title="Groq API 키">
                    <ApiKeyField apiKeyStatus={apiKeyStatus} onSave={saveApiKey} />
                </PageSection>

                {/* 예산 */}
                <PageSection
                    title="예산"
                    aside={
                        usage && (
                            <MetaText>
                                이번 달 {formatUsd(usage.monthUsd)} · 오늘 {formatUsd(usage.todayUsd)}
                                {usage.saveMode ? ' · 절약 모드' : ''}
                            </MetaText>
                        )
                    }
                >
                    <HelpText>
                        월 예산에 도달하면 작은 모델로 바꿔 실행하는 절약 모드가 됩니다. 하루 상한을 넘으면 그날은 새로 만들지 않습니다.
                    </HelpText>
                    <PageRow>
                        <Field label="월 예산 (USD)">
                            <TextInput
                                type="number"
                                min="0.5"
                                step="0.5"
                                width="narrow"
                                value={budgetInput}
                                onChange={(changeEvent) => setBudgetInput(changeEvent.target.value)}
                            />
                        </Field>
                        <Field label="하루 상한 (USD)">
                            <TextInput
                                type="number"
                                min="0.1"
                                step="0.1"
                                width="narrow"
                                value={dailyCapInput}
                                onChange={(changeEvent) => setDailyCapInput(changeEvent.target.value)}
                            />
                        </Field>
                        <Button onClick={() => void saveBudget()} disabled={isBudgetUnchanged}>
                            저장
                        </Button>
                    </PageRow>
                </PageSection>

                {/* 실행 (자동 시작 · 진단 화면) */}
                <PageSection title="실행">
                    <Checkbox
                        checked={isAutostartEnabled ?? false}
                        disabled={isAutostartEnabled === null}
                        onChange={(changeEvent) => setAutostart(changeEvent.target.checked)}
                    >
                        Windows 시작 시 실행 (창 없이 트레이에서 시작)
                    </Checkbox>
                    <HelpText>
                        로그인하거나 잠금을 해제하면 오늘 브리핑이 없을 때 자동으로 만듭니다. PC를 켜둔 채라면 오전 8시에 만듭니다. 단축키
                        Ctrl + Alt + N으로 언제든 창을 엽니다.
                    </HelpText>
                    <PageRow>
                        <Button variant="text" onClick={() => navigate(paths.of('diagnostics'))}>
                            진단 화면 열기
                        </Button>
                    </PageRow>
                </PageSection>
            </PageBody>
        </SinglePane>
    )
}
