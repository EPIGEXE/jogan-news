// ============================================================================
// 기사 개요 패널
//
// [역할]
// - 목록에서 고른 기사의 개요(분류 · 출처 · 제목 · 요약 · 왜 중요한가)를 옆 패널에 표시
// - 저장 · 원문 열기 버튼과 태그 편집 제공
// ============================================================================
import { CATEGORY_LABEL } from '@shared/types'
import type { ArticleView } from '@/domains/article/types'
import { Button } from '@/common/ui/Button'
import { Kicker, MetaText, OriginalTitle } from '@/common/ui/Text'
import { TagList } from '@/domains/article/components/TagList'
import { WhyItMatters } from '@/domains/article/components/WhyItMatters'

interface Props {
    article: ArticleView
    onToggleSave(): void
    onOpenOriginal(): void
    onAddTag(name: string): void
    onRemoveTag(name: string): void
    isEnriching?: boolean // 저장 후 태그 추천 등 보강이 도는 중인지
}

/**
 * 옆 패널의 기사 개요
 *
 * - 개요만 표시 (읽기 화면은 목록 줄의 "읽기" 버튼, Enter, 두 번 누르기로 진입)
 *
 * @returns {JSX.Element} 기사 개요
 */
export function ArticlePreview({ article, onToggleSave, onOpenOriginal, onAddTag, onRemoveTag, isEnriching }: Props) {
    return (
        <article className="flex flex-col gap-4 px-7 py-6">
            {/* 분류 · 출처 */}
            <div className="flex flex-col gap-1">
                <Kicker>{CATEGORY_LABEL[article.category]}</Kicker>
                <MetaText>
                    {article.sourceName}
                    {article.engagementLabel ? ` · ${article.engagementLabel}` : ''}
                    {article.otherSources.length ? ` · 외 ${article.otherSources.length}곳` : ''}
                </MetaText>
            </div>

            {/* 제목 */}
            <div className="flex flex-col gap-1 border-b border-rule pb-4">
                <h2 className="font-display text-subhead font-bold tracking-tight">{article.titleKo}</h2>
                <OriginalTitle>{article.originalTitle}</OriginalTitle>
            </div>

            {/* 요약 */}
            <p className="text-reading text-ink-body">{article.summaryKo}</p>
            {article.whyItMatters && <WhyItMatters>{article.whyItMatters}</WhyItMatters>}

            {/* 저장 · 원문 버튼 */}
            <div className="flex flex-wrap gap-2">
                <Button icon="bookmark" iconFilled={article.isSaved} aria-pressed={article.isSaved} onClick={onToggleSave} title="저장 (S)">
                    {article.isSaved ? '저장됨' : '저장'}
                </Button>
                <Button variant="text" onClick={onOpenOriginal} title="원문 열기 (O)">
                    원문
                </Button>
            </div>

            {/* 태그 (저장한 기사이거나 태그가 있을 때만) */}
            {(article.isSaved || article.tags.length > 0) && (
                <TagList tags={article.tags} onAdd={onAddTag} onRemove={onRemoveTag} isSuggestingTags={isEnriching} />
            )}
        </article>
    )
}
