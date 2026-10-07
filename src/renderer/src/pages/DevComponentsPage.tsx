import { useState } from 'react'
import type { DigestEntryDTO } from '@shared/types'
import { BudgetMeter, EmptyState, ErrorNotice } from '../components/app/Notice'
import { RunProgress } from '../components/app/RunProgress'
import { ArticleActions } from '../components/article/ArticleActions'
import { ArticleRow } from '../components/article/ArticleRow'
import { WhyItMatters } from '../components/article/WhyItMatters'
import { SinglePane } from '../components/layout/AppShell'
import { PageBody, PageSection, PageTitle, Row } from '../components/layout/Page'
import { Button } from '../components/ui/Button'
import { Checkbox, Field, TextInput } from '../components/ui/Form'
import { IconButton } from '../components/ui/IconButton'
import { KeyboardHints } from '../components/ui/KeyboardHints'
import { LinedTextarea } from '../components/ui/LinedTextarea'
import { Masthead } from '../components/ui/Masthead'
import { Rule } from '../components/ui/Rule'
import { Tabs } from '../components/ui/Tabs'
import { Caption, Help, Kicker, Meta, OriginalTitle, SectionLabel } from '../components/ui/Text'

// 개발용 견본 화면: 부품마다 상태별 모습을 한눈에 본다 (DESIGN.md 6.6절)

const COLOR_TOKENS = [
  'paper',
  'paper-raised',
  'paper-sunken',
  'paper-input',
  'ink',
  'ink-body',
  'ink-secondary',
  'ink-muted',
  'ink-faint',
  'ink-read',
  'rule',
  'rule-soft',
  'memo-line',
  'control-border',
  'accent',
  'danger'
]

const SAMPLE: DigestEntryDTO = {
  itemId: 1,
  rank: 3,
  section: 'top',
  category: 'agent_tooling',
  titleKo: 'OpenAI, 확률·선택지·점수를 돌려주는 Decisions API 공개 베타',
  originalTitle: 'OpenAI, Decisions API public beta',
  summaryKo: '텍스트·이미지를 평가해 확률, 선택지, 점수를 돌려준다.',
  keyPoints: [],
  whyItMatters: null,
  url: 'https://example.com',
  sourceName: 'GeekNews',
  engagementLabel: 'HN 640점',
  otherSources: [],
  publishedAt: null,
  isRead: false,
  isSaved: false,
  memo: '',
  tags: ['decision-model', 'openai']
}

const noop = () => {}

export function DevComponentsPage() {
  const [tab, setTab] = useState<'a' | 'b' | 'c'>('a')
  const [saved, setSaved] = useState(false)
  return (
    <SinglePane label="부품 견본">
      <PageBody>
        <PageTitle>부품 견본</PageTitle>

        <PageSection title="토큰 · 색">
          <div className="grid grid-cols-2 gap-3 wide:grid-cols-3">
            {COLOR_TOKENS.map((t) => (
              <div key={t} className="flex items-center gap-2 text-meta">
                {/* 토큰 이름으로 색을 보여주는 견본이라 인라인 style로 변수를 넣는다 */}
                <span className="size-7 border border-rule" style={{ background: `var(--color-${t})` }} />
                <code>{t}</code>
              </div>
            ))}
          </div>
        </PageSection>

        <PageSection title="글자">
          <Masthead>AI 조간</Masthead>
          <SectionLabel>섹션 이름</SectionLabel>
          <Kicker>에이전트·툴링</Kicker>
          <OriginalTitle>Original English title in italic</OriginalTitle>
          <Meta>GeekNews · HN 640점</Meta>
          <Caption>자동 저장됨 · 07:52</Caption>
          <Help>설명 문장</Help>
        </PageSection>

        <PageSection title="버튼 · 탭 · 괘선 · 입력">
          <Row>
            <Button variant="solid" icon="bookmark" iconFilled>
              저장됨
            </Button>
            <Button icon="external">원문 열기</Button>
            <Button variant="text">텍스트 버튼</Button>
            <Button disabled>비활성</Button>
            <IconButton icon="bookmark" label="저장" />
            <IconButton icon="bookmark" label="저장됨" active />
          </Row>
          <Tabs
            items={[
              { id: 'a', label: '전체 18' },
              { id: 'b', label: '에이전트 5' },
              { id: 'c', label: '비활성', disabled: true }
            ]}
            value={tab}
            onChange={setTab}
            label="견본 탭"
          />
          <Rule />
          <Rule variant="soft" />
          <Rule variant="strong" />
          <Rule variant="double" />
          <KeyboardHints hints={[{ keys: 'J K', label: '이동' }, { keys: 'S', label: '저장' }]} />
          <Row>
            <Field label="월 예산 (USD)">
              <TextInput width="narrow" defaultValue="5" />
            </Field>
            <TextInput width="wide" placeholder="넓은 입력란" />
          </Row>
          <Checkbox defaultChecked>체크박스</Checkbox>
        </PageSection>

        <PageSection title="기사 행 상태">
          <ol className="m-0 list-none p-0">
            <li>
              <ArticleRow entry={SAMPLE} selected={false} onSelect={noop} />
            </li>
            <li>
              <ArticleRow entry={{ ...SAMPLE, isRead: true }} selected={false} onSelect={noop} />
            </li>
            <li>
              <ArticleRow entry={SAMPLE} selected onSelect={noop} />
            </li>
            <li>
              <ArticleRow entry={{ ...SAMPLE, isSaved: true }} selected={false} onSelect={noop} />
            </li>
            <li>
              <ArticleRow entry={{ ...SAMPLE, memo: '메모 있음' }} selected={false} onSelect={noop} />
            </li>
          </ol>
        </PageSection>

        <PageSection title="기사 패널 부품">
          <WhyItMatters>분류·라우팅처럼 짧은 판단을 싸고 빠른 모델에 맡기는 구성이 표준이 될 수 있다.</WhyItMatters>
          <ArticleActions saved={saved} onToggleSave={() => setSaved(!saved)} onOpenOriginal={noop} />
          <LinedTextarea defaultValue={'줄 노트 메모장\n두 번째 줄'} aria-label="견본 메모" />
        </PageSection>

        <PageSection title="앱 부품">
          <RunProgress progress={{ stage: 'summarize', message: '한국어로 요약하는 중', current: 7, total: 18 }} />
          <ErrorNotice>Groq API 키가 없습니다. 설정에서 키를 입력하세요.</ErrorNotice>
          <BudgetMeter usage={{ monthUsd: 1.42, todayUsd: 0.08, budgetUsd: 5, dailyCapUsd: 0.5, saveMode: false }} />
          <BudgetMeter usage={{ monthUsd: 5.02, todayUsd: 0.2, budgetUsd: 5, dailyCapUsd: 0.5, saveMode: true }} />
          <EmptyState title="아직 브리핑이 없습니다" action={<Button variant="solid">지금 만들기</Button>}>
            빈 화면 견본
          </EmptyState>
        </PageSection>
      </PageBody>
    </SinglePane>
  )
}
