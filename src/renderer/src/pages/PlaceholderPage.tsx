import { EmptyState } from '../components/app/Notice'
import { SinglePane } from '../components/layout/AppShell'
import { PageBody, PageTitle } from '../components/layout/Page'

/** 아직 만들지 않은 화면 */
export function PlaceholderPage({ title, stage, children }: { title: string; stage: string; children: string }) {
  return (
    <SinglePane label={title}>
      <PageBody>
        <PageTitle>{title}</PageTitle>
        <EmptyState title={`${stage}에서 만들 예정입니다`}>{children}</EmptyState>
      </PageBody>
    </SinglePane>
  )
}
