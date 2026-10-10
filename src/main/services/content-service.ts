import type {
  DigestDTO,
  DigestSummaryDTO,
  HighlightDTO,
  HighlightRange,
  ItemDetailDTO,
  LibraryItemDTO,
  SearchParams,
  SourceStatsDTO,
  StatsPeriod,
  TagCount
} from '@shared/types'
import type { WorkerRpc } from './ports'

// 브리핑·기사·라이브러리 데이터. 지금은 대부분 Worker에 그대로 전달하지만,
// 화면 요청이 Worker를 직접 부르지 않고 이 서비스를 거치게 해서 규칙이 생기면 여기에 둔다.

export class ContentService {
  constructor(private readonly worker: WorkerRpc) {}

  getLatestDigest(): Promise<DigestDTO | null> {
    return this.worker.call('getLatestDigest')
  }

  getLastDigestDate(): Promise<string | null> {
    return this.worker.call('getLastDigestDate')
  }

  getDigest(date: string): Promise<DigestDTO | null> {
    return this.worker.call('getDigest', { date })
  }

  listDigests(): Promise<DigestSummaryDTO[]> {
    return this.worker.call('listDigests')
  }

  getItem(itemId: number): Promise<ItemDetailDTO | null> {
    return this.worker.call('getItem', { itemId })
  }

  translateItem(itemId: number): Promise<boolean> {
    return this.worker.call('translateItem', { itemId })
  }

  getSourceStats(period: StatsPeriod): Promise<SourceStatsDTO> {
    return this.worker.call('getSourceStats', { period })
  }

  /** 낮 동안 미리 수집 (LLM 없음) */
  collectOnly(): Promise<{ collected: number; skipped: boolean }> {
    return this.worker.call('collectOnly')
  }

  addHighlights(itemId: number, ranges: HighlightRange[]): Promise<HighlightDTO[]> {
    return this.worker.call('addHighlights', { itemId, ranges })
  }

  updateHighlightNote(id: number, note: string): Promise<HighlightDTO[]> {
    return this.worker.call('updateHighlightNote', { id, note })
  }

  removeHighlight(id: number): Promise<HighlightDTO[]> {
    return this.worker.call('removeHighlight', { id })
  }

  markRead(itemId: number): Promise<void> {
    return this.worker.call('markRead', { itemId })
  }

  setSaved(itemId: number, saved: boolean): Promise<void> {
    return this.worker.call('setSaved', { itemId, saved })
  }

  saveMemo(itemId: number, body: string): Promise<{ savedAt: string }> {
    return this.worker.call('saveMemo', { itemId, body })
  }

  addTag(itemId: number, name: string): Promise<string[]> {
    return this.worker.call('addTag', { itemId, name })
  }

  removeTag(itemId: number, name: string): Promise<string[]> {
    return this.worker.call('removeTag', { itemId, name })
  }

  search(p: SearchParams): Promise<LibraryItemDTO[]> {
    return this.worker.call('search', p)
  }

  listTags(): Promise<TagCount[]> {
    return this.worker.call('listTags')
  }
}
