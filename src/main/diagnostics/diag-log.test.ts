// ============================================================================
// 진단 기록 테스트
//
// [역할]
// - 기록 파일이 끝없이 커지지 않고 최근 기록만 남는지 확인
// - 다시 시작했을 때 파일에서 최근 기록을 읽어 오는지 확인
// ============================================================================
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DiagLog } from './diag-log'

let tempDir: string
let logFilePath: string

const lineCount = (): number => readFileSync(logFilePath, 'utf8').trim().split('\n').length

beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'jogan-diag-'))
    logFilePath = join(tempDir, 'diagnostics.log')
})
afterEach(() => rmSync(tempDir, { recursive: true, force: true }))

describe('DiagLog', () => {
    it('기록이 쌓여도 파일은 600줄을 넘지 않고, 줄일 때 최근 300건을 남긴다', () => {
        const diagLog = new DiagLog(logFilePath)
        for (let eventNumber = 1; eventNumber <= 601; eventNumber++) diagLog.log('test', String(eventNumber))

        expect(lineCount()).toBe(300)
        expect(diagLog.listEvents()).toHaveLength(300)
        expect(diagLog.listEvents()[0]!.detail).toBe('302')
        expect(diagLog.listEvents().at(-1)!.detail).toBe('601')
    })

    it('이미 길어진 파일은 시작할 때 최근 300건으로 줄이고, 깨진 줄은 건너뛴다', () => {
        const oldLines = Array.from({ length: 1000 }, (_, lineIndex) =>
            JSON.stringify({ at: '2026-10-01T00:00:00.000Z', kind: 'old', detail: String(lineIndex + 1) })
        )
        oldLines[998] = '{깨진 줄'
        writeFileSync(logFilePath, oldLines.join('\n') + '\n')

        const diagLog = new DiagLog(logFilePath)

        expect(diagLog.listEvents()).toHaveLength(299)
        expect(diagLog.listEvents().at(-1)!.detail).toBe('1000')
        expect(lineCount()).toBe(299)
    })
})
