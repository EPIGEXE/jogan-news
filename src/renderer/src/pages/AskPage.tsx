import { useMemo } from 'react'
import type { DigestDTO } from '@shared/types'
import { EmptyState } from '../components/app/Notice'
import { ListHeader } from '../components/app/ListHeader'
import { ChatPanel } from '../components/article/ChatPanel'
import { SinglePane } from '../components/layout/AppShell'
import { formatKoreanDate } from '../lib/format'
import { useChat, useQuickActions } from '../lib/useChat'

interface Props {
  digest: DigestDTO | null
  /** 답변의 [#n]을 누르면 그 기사를 오늘 화면에서 연다 */
  onOpenItem(itemId: number): void
}

/** 질문: 그날 브리핑 전체를 근거로 묻고 답한다 */
export function AskPage({ digest, onOpenItem }: Props) {
  const chat = useChat(digest ? { kind: 'digest', date: digest.date } : null)
  const quick = useQuickActions()
  const byRank = useMemo(() => new Map(digest?.entries.map((e) => [e.rank, e]) ?? []), [digest])

  if (!digest) {
    return (
      <SinglePane label="질문">
        <div className="max-w-190 px-7 py-6">
          <EmptyState title="아직 브리핑이 없습니다">브리핑이 만들어지면 그날 소식 전체에 대해 질문할 수 있습니다.</EmptyState>
        </div>
      </SinglePane>
    )
  }

  return (
    <SinglePane label="질문">
      <div className="flex max-w-190 flex-col gap-5 px-7 pt-6 pb-7">
        <ListHeader title="질문" meta={`${formatKoreanDate(digest.date)} 브리핑 · ${digest.entries.length}건`}>
          <p className="font-display text-title font-semibold text-ink-secondary">{digest.headline}</p>
        </ListHeader>
        <ChatPanel
          messages={chat.messages}
          streaming={chat.streaming}
          error={chat.error}
          quickActions={quick?.digest ?? []}
          onAsk={chat.ask}
          onClear={chat.clear}
          onCite={(rank) => {
            const e = byRank.get(rank)
            if (e) onOpenItem(e.itemId)
          }}
          citeTitle={(rank) => byRank.get(rank)?.titleKo ?? ''}
          emptyHint="오늘 브리핑 전체에 대해 물어보세요. 답변의 #번호를 누르면 그 기사로 갑니다."
          placeholder="오늘 브리핑에 대해 질문"
        />
      </div>
    </SinglePane>
  )
}
