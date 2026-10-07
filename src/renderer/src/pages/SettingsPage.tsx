import { useEffect, useState } from 'react'
import type { ApiKeyStatus, Route } from '@shared/ipc'
import type { AppSettings, UsageSummary } from '@shared/types'
import { SinglePane } from '../components/layout/AppShell'
import { PageBody, PageSection, PageTitle, Row } from '../components/layout/Page'
import { Button } from '../components/ui/Button'
import { Checkbox, Field, TextInput } from '../components/ui/Form'
import { Help, Meta } from '../components/ui/Text'
import { api } from '../lib/api'
import { formatUsd } from '../lib/format'

export function SettingsPage({ onNavigate, onUsageChanged }: { onNavigate(route: Route): void; onUsageChanged(): void }) {
  const [keyStatus, setKeyStatus] = useState<ApiKeyStatus | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [budget, setBudget] = useState('')
  const [dailyCap, setDailyCap] = useState('')
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [autostart, setAutostart] = useState<boolean | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void api.getApiKeyStatus().then(setKeyStatus)
    void api.getSettings().then((s) => {
      setSettings(s)
      setBudget(String(s.budgetUsd))
      setDailyCap(String(s.dailyCapUsd))
    })
    void api.getUsage().then(setUsage)
    void api.getAutostart().then(setAutostart)
  }, [])

  const saveKey = async (value: string | null) => {
    setKeyStatus(await api.setApiKey(value))
    setKeyInput('')
    setMessage(value ? 'API 키를 저장했습니다.' : '저장된 API 키를 지웠습니다.')
  }

  const saveBudget = async () => {
    const b = Number(budget)
    const c = Number(dailyCap)
    if (!(b > 0) || !(c > 0)) {
      setMessage('예산과 하루 상한은 0보다 큰 숫자여야 합니다.')
      return
    }
    setSettings(await api.updateSettings({ budgetUsd: b, dailyCapUsd: c }))
    setUsage(await api.getUsage())
    onUsageChanged()
    setMessage('예산을 저장했습니다.')
  }

  const keyText =
    keyStatus?.source === 'stored'
      ? `저장됨 (끝자리 …${keyStatus.hint})`
      : keyStatus?.source === 'env'
        ? `개발용 .env에서 읽는 중 (끝자리 …${keyStatus.hint})`
        : '없음'

  const budgetUnchanged = !settings || (budget === String(settings.budgetUsd) && dailyCap === String(settings.dailyCapUsd))

  return (
    <SinglePane label="설정">
      <PageBody>
        <PageTitle>설정</PageTitle>
        {message && <Help role="status">{message}</Help>}

        <PageSection title="Groq API 키">
          <Help>입력한 키는 이 PC의 Windows 계정으로 암호화해서 저장합니다. 현재: {keyText}</Help>
          <form
            className="flex flex-wrap items-center gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (keyInput.trim()) void saveKey(keyInput)
            }}
          >
            <label htmlFor="api-key" className="sr-only">
              Groq API 키
            </label>
            <TextInput
              id="api-key"
              type="password"
              autoComplete="off"
              placeholder="gsk_…"
              width="wide"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
            />
            <Button type="submit" variant="solid" disabled={!keyInput.trim()}>
              저장
            </Button>
            {keyStatus?.source === 'stored' && <Button onClick={() => void saveKey(null)}>지우기</Button>}
          </form>
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
            onChange={(e) => void api.setAutostart(e.target.checked).then(setAutostart)}
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
