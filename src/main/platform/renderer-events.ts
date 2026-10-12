// ============================================================================
// 화면으로 보내는 알림
//
// [역할]
// - Main에서 화면으로 보내는 알림(생성 진행 · 새 브리핑 · 기사 변경 · 화면 이동 · 답변 · 진단 기록)을 한곳에서 전송
// - 열려 있는 모든 창에 전송 (열린 창이 없으면 아무 일도 하지 않음)
// - 알림마다 정해진 IPC 채널 사용 (채널 이름은 shared/ipc.ts에 정의)
// - 보내기만 하고 응답은 기다리지 않음
// ============================================================================
import { BrowserWindow } from 'electron'
import { IPC, type DiagEvent, type Route } from '@shared/ipc'
import type { ChatEvent, RunProgress } from '@shared/types'
import type { RendererEvents } from '../services/ports'

/**
 * 열려 있는 모든 창에 알림 전송
 */
export class BroadcastEvents implements RendererEvents {
    // 채널 하나로 모든 창에 전송
    private send(channel: string, ...channelArgs: unknown[]): void {
        for (const browserWindow of BrowserWindow.getAllWindows()) browserWindow.webContents.send(channel, ...channelArgs)
    }

    // 브리핑 생성 진행 상황 (단계 · 안내 문구 · 진행 수)
    runProgress(runProgress: RunProgress): void {
        this.send(IPC.runProgress, runProgress)
    }

    // 새 브리핑 게시 (화면이 브리핑을 다시 읽도록 알림)
    digestUpdated(): void {
        this.send(IPC.digestUpdated)
    }

    // 기사 정보 변경 (본문 보강 · 번역 완료 등)
    itemUpdated(itemId: number): void {
        this.send(IPC.itemUpdated, itemId)
    }

    // 화면 이동 요청
    navigate(route: Route): void {
        this.send(IPC.navigate, route)
    }

    // AI 답변 스트리밍 (답변 조각 · 완료 · 오류)
    chatEvent(chatEvent: ChatEvent): void {
        this.send(IPC.chatEvent, chatEvent)
    }

    // 진단 기록 한 줄 (진단 화면에 바로 보이도록 전송)
    diagEvent(diagEvent: DiagEvent): void {
        this.send(IPC.diagEvent, diagEvent)
    }
}
