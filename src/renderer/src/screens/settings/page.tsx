import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Route } from '@shared/ipc'
import { ApiKeyField } from '@/screens/settings/components/ApiKeyField'
import { SinglePane } from '@/common/layout/AppShell'
import { PageBody, PageSection, PageTitle, Row } from '@/common/layout/Page'
import { Button } from '@/common/ui/Button'
import { Checkbox, Field, TextInput } from '@/common/ui/Form'
import { Help, Meta } from '@/common/ui/Text'
import { api } from '@/common/lib/api'
import { formatUsd } from '@/common/lib/format'
import { qk } from '@/common/lib/queryKeys'
import { useUsage } from '@/common/lib/useUsage'

export function SettingsPage({ onNavigate }: { onNavigate(route: Route): void }) {
  const qc = useQueryClient()
  const keyStatus = useQuery({ queryKey: qk.apiKey, queryFn: () => api.getApiKeyStatus() }).data ?? null
  const settings = useQuery({ queryKey: qk.settings, queryFn: () => api.getSettings() }).data ?? null
  const autostart = useQuery({ queryKey: qk.autostart, queryFn: () => api.getAutostart() }).data ?? null
  const usage = useUsage().data ?? null
  // 입력란은 고치는 동안의 값이라 화면 상태로 두고, 설정을 처음 읽었을 때 채운다
  const [budget, setBudget] = useState('')
  const [dailyCap, setDailyCap] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!settings) return
    setBudget(String(settings.budgetUsd))
    setDailyCap(String(settings.dailyCapUsd))
  }, [settings])

  const saveKey = async (value: string | null) => {
    qc.setQueryData(qk.apiKey, await api.setApiKey(value))
    setMessage(value ? 'API 키를 저장했습니다.' : '저장된 API 키를 지웠습니다.')
  }

  const saveBudget = async () => {
    const b = Number(budget)
    const c = Number(dailyCap)
    if (!(b > 0) || !(c > 0)) {
      setMessage('예산과 하루 상한은 0보다 큰 숫자여야 합니다.')
      return
    }
    qc.setQueryData(qk.settings, await api.updateSettings({ budgetUsd: b, dailyCapUsd: c }))
    // 절약 모드 여부·예산 표시가 바뀐다 (메뉴 아래 비용 표시도 같은 캐시를 씀)
    void qc.invalidateQueries({ queryKey: qk.usage })
    setMessage('예산을 저장했습니다.')
  }

  const budgetUnchanged = !settings || (budget === String(settings.budgetUsd) && dailyCap === String(settings.dailyCapUsd))

  return (
    <SinglePane label="설정">
      <PageBody>
        <PageTitle>설정</PageTitle>
        {message && <Help role="status">{message}</Help>}

        <PageSection title="Groq API 키">
          <ApiKeyField status={keyStatus} onSave={saveKey} />
        </PageSection>

        <PageSection
          title="예산"
          aside={
            usage && (
              <Meta>
                이번 달 {formatUsd(usage.monthUsd)} · 오늘 {formatUsd(usage.todayUsd)}
                {usage.saveMode ? ' · 절약 모드' : ''}
              </Meta>
            )
          }
        >
          <Help>월 예산에 도달하면 작은 모델로 바꿔 실행하는 절약 모드가 됩니다. 하루 상한을 넘으면 그날은 새로 만들지 않습니다.</Help>
          <Row>
            <Field label="월 예산 (USD)">
              <TextInput type="number" min="0.5" step="0.5" width="narrow" value={budget} onChange={(e) => setBudget(e.target.value)} />
            </Field>
            <Field label="하루 상한 (USD)">
              <TextInput type="number" min="0.1" step="0.1" width="narrow" value={dailyCap} onChange={(e) => setDailyCap(e.target.value)} />
            </Field>
            <Button onClick={() => void saveBudget()} disabled={budgetUnchanged}>
              저장
            </Button>
          </Row>
        </PageSection>

        <PageSection title="실행">
          <Checkbox
            checked={autostart ?? false}
            disabled={autostart === null}
            onChange={(e) => void api.setAutostart(e.target.checked).then((on) => qc.setQueryData(qk.autostart, on))}
          >
            Windows 시작 시 실행 (창 없이 트레이에서 시작)
          </Checkbox>
          <Help>
            로그인하거나 잠금을 해제하면 오늘 브리핑이 없을 때 자동으로 만듭니다. PC를 켜둔 채라면 오전 8시에 만듭니다. 단축키
            Ctrl + Alt + N으로 언제든 창을 엽니다.
          </Help>
          <Row>
            <Button variant="text" onClick={() => onNavigate('diagnostics')}>
              진단 화면 열기
            </Button>
          </Row>
        </PageSection>
      </PageBody>
    </SinglePane>
  )
}
