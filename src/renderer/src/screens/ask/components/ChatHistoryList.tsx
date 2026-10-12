// ============================================================================
// 지난 질문 목록
//
// [역할]
// - 질문한 적 있는 기사 · 브리핑을 최근에 질문한 것부터 한 줄씩 표시
// - 줄마다 마지막 질문 날짜 · 제목 · 출처 · 질문 수 · 가장 최근 질문 표시
// - J/K로 고르고 Enter · 두 번 누르기 · "보기"로 그 대화 열기 (기사는 읽기 화면의 질문 탭, 브리핑은 그날 브리핑의 대화)
// ============================================================================
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import type { ChatHistoryEntryDTO } from '@shared/types'
import { formatShortDate } from '@/common/lib/format'
import { paths } from '@/common/lib/paths'
import { useListKeys } from '@/common/lib/useListKeys'
import { EmptyState } from '@/common/ui/Notice'
import { SkeletonList } from '@/common/ui/Skeleton'
import { RowReadButton } from '@/domains/article/components/RowReadButton'
import { useChatHistoryQuery } from '@/domains/chat/queries'

// 목록의 줄을 구분하는 글자 (기사 번호 또는 브리핑 날짜)
const historyEntryKeyOf = (chatHistoryEntry: ChatHistoryEntryDTO) =>
    chatHistoryEntry.scope.kind === 'item' ? `item:${chatHistoryEntry.scope.itemId}` : `digest:${chatHistoryEntry.scope.date}`

/**
 * 지난 질문 목록 (질문한 적 있는 기사 · 브리핑)
 *
 * - 다른 목록처럼 J/K로 고르고 Enter · "보기"로 열기
 *
 * @returns {JSX.Element} 지난 질문 목록 (읽어 오는 중이면 자리 표시, 없으면 안내)
 */
export function ChatHistoryList() {
    // =============================== 훅 ===================================
    const navigate = useNavigate()

    // =============================== 쿼리 훅 ===================================
    const chatHistoryEntries = useChatHistoryQuery().data ?? null // 지난 질문 목록 (읽어 오는 중이면 null)

    // =============================== 상태 ===================================
    const [selectedEntryKey, setSelectedEntryKey] = useState<string | null>(null) // 목록에서 고른 줄

    // =============================== Ref ===================================
    const rowRefs = useRef(new Map<string, HTMLButtonElement>()) // 줄별 행 버튼 (고른 행을 화면 안으로 스크롤하는 용도)

    // =============================== 계산 ===================================
    const entryKeys = useMemo(() => (chatHistoryEntries ?? []).map(historyEntryKeyOf), [chatHistoryEntries])
    const rowIndexes = useMemo(() => entryKeys.map((_entryKey, rowIndex) => rowIndex), [entryKeys]) // 단축키가 줄을 가리키는 번호 (목록 순서)
    const selectedRowIndex = selectedEntryKey !== null && entryKeys.includes(selectedEntryKey) ? entryKeys.indexOf(selectedEntryKey) : null
    const selectedEntry = selectedRowIndex !== null ? (chatHistoryEntries?.[selectedRowIndex] ?? null) : null

    // 단축키로 고른 줄을 선택하고 그 행이 보이도록 스크롤
    const selectRowByIndex = useCallback(
        (rowIndex: number) => {
            const entryKey = entryKeys[rowIndex]
            if (entryKey === undefined) return
            setSelectedEntryKey(entryKey)
            rowRefs.current.get(entryKey)?.scrollIntoView({ block: 'nearest' })
        },
        [entryKeys]
    )

    // 그 줄의 대화 열기 (기사면 읽기 화면의 질문 탭, 브리핑이면 그날 브리핑의 대화)
    const openEntry = (chatHistoryEntry: ChatHistoryEntryDTO) =>
        void navigate(
            chatHistoryEntry.scope.kind === 'item'
                ? paths.askHistoryItem(chatHistoryEntry.scope.itemId)
                : paths.askHistoryDigest(chatHistoryEntry.scope.date)
        )

    // =============================== useEffect ===================================
    // 처음이거나 고른 줄이 목록에서 없어지면 맨 위(가장 최근에 질문한 것) 선택
    useEffect(() => {
        if (selectedEntryKey !== null && entryKeys.includes(selectedEntryKey)) return
        setSelectedEntryKey(entryKeys[0] ?? null)
    }, [entryKeys, selectedEntryKey])

    // 목록 단축키
    useListKeys({
        ids: rowIndexes,
        selectedId: selectedRowIndex,
        onSelect: selectRowByIndex,
        onOpen: selectedEntry ? () => openEntry(selectedEntry) : undefined
    })

    // 목록을 읽어 오는 중
    if (!chatHistoryEntries) return <SkeletonList />

    // 질문한 적이 없을 때
    if (chatHistoryEntries.length === 0) {
        return (
            <EmptyState title="아직 질문한 기사가 없습니다">
                기사 읽기 화면의 질문 탭이나 "오늘 브리핑에 질문"에서 물어보면 여기에 모입니다.
            </EmptyState>
        )
    }

    return (
        <ol className="m-0 list-none p-0">
            {/* 질문한 기사 · 브리핑 (한 번 누르면 선택, 두 번 누르거나 "보기"로 열기) */}
            {chatHistoryEntries.map((chatHistoryEntry) => {
                const entryKey = historyEntryKeyOf(chatHistoryEntry)
                const isSelected = entryKey === selectedEntryKey
                return (
                    <li key={entryKey} className="group/row relative">
                        <button
                            ref={(rowElement) => {
                                if (rowElement) rowRefs.current.set(entryKey, rowElement)
                                else rowRefs.current.delete(entryKey)
                            }}
                            type="button"
                            aria-current={isSelected ? 'true' : undefined}
                            data-selected={isSelected || undefined}
                            onClick={() => setSelectedEntryKey(entryKey)}
                            onDoubleClick={() => openEntry(chatHistoryEntry)}
                            className="relative flex w-full cursor-pointer flex-col gap-1 border-0 border-b border-rule-soft bg-transparent py-4 pr-24 pl-3 text-left transition-colors duration-120 hover:bg-paper-sunken/50 data-selected:bg-paper-sunken before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:origin-top before:scale-y-0 before:bg-accent before:transition-transform before:duration-200 before:ease-ink data-selected:before:scale-y-100"
                        >
                            {/* 마지막으로 질문한 날짜 · 출처 */}
                            <span className="flex flex-wrap gap-x-3 gap-y-1 text-meta font-medium tracking-dateline text-ink-muted tabular-nums">
                                <span>{formatShortDate(chatHistoryEntry.lastAskedAt)}</span>
                                {chatHistoryEntry.sourceName && <span>{chatHistoryEntry.sourceName}</span>}
                            </span>

                            {/* 제목 (브리핑이면 앞에 "브리핑 전체" 표시) */}
                            <span className="font-display text-title font-semibold text-ink">
                                {chatHistoryEntry.scope.kind === 'digest' && (
                                    <span className="mr-2 font-body text-meta font-bold tracking-kicker text-accent">브리핑 전체</span>
                                )}
                                {chatHistoryEntry.title}
                            </span>

                            {/* 질문 수 · 가장 최근 질문 (한 줄로 자름) */}
                            <span className="min-w-0 truncate text-meta text-ink-secondary">
                                질문 {chatHistoryEntry.questionCount} · "{chatHistoryEntry.lastQuestion}"
                            </span>
                        </button>
                        <RowReadButton
                            selected={isSelected}
                            onClick={() => openEntry(chatHistoryEntry)}
                            label="보기"
                            title="이 대화 보기 (Enter)"
                        />
                    </li>
                )
            })}
        </ol>
    )
}
