// ============================================================================
// 인터넷 연결 확인
//
// [역할]
// - 인터넷이 연결되어 있는지 확인
// - 실제로 Groq 서버까지 닿을 때까지 기다림 (로그인 직후에는 Wi-Fi · VPN이 늦게 붙을 수 있음, DESIGN.md 4.2절)
// - 닿았다고 보는 기준: 서버 오류(5xx)가 아닌 응답 (키 없이 부르므로 401이 정상)
// - 30초마다 다시 확인하고, 5분이 지나도 안 되면 포기
// - OS가 보는 연결 상태만 빠르게 확인하는 방법도 따로 제공 (낮 동안 수집 타이머가 사용)
// ============================================================================
import { net } from 'electron'
import type { NetworkPort } from '../services/ports'

const PROBE_URL = 'https://api.groq.com/openai/v1/models' // 닿는지 확인할 때 부르는 주소
const RETRY_INTERVAL_MS = 30_000 // 다시 확인하는 간격
const MAX_WAIT_MS = 5 * 60_000 // 기다리는 최대 시간

/**
 * Electron 네트워크로 인터넷 연결 확인
 */
export class ElectronNetwork implements NetworkPort {
    // OS가 보는 연결 상태 (빠른 확인용, 실제로 닿는지는 확인하지 않음)
    isOnline(): boolean {
        return net.isOnline()
    }

    // Groq 서버까지 실제로 닿는지 (서버 오류가 아닌 응답이 오면 닿은 것)
    private async canReachProbeUrl(): Promise<boolean> {
        // OS가 오프라인이라고 하면 호출해 볼 것 없음
        if (!net.isOnline()) return false

        // 확인용 주소 호출 (10초 안에 응답이 없거나 연결에 실패하면 닿지 않은 것)
        try {
            const probeResponse = await net.fetch(PROBE_URL, { method: 'GET', signal: AbortSignal.timeout(10_000) })
            return probeResponse.status < 500 // 키 없이 부르므로 401이 정상
        } catch {
            return false
        }
    }

    /**
     * 연결될 때까지 대기
     *
     * @param {() => void} onWaiting - 처음 기다리기 시작할 때 한 번 부를 함수
     * @returns {Promise<boolean>} 연결되면 true, 최대 시간까지 안 되면 false
     */
    async waitUntilOnline(onWaiting: () => void): Promise<boolean> {
        const waitDeadline = Date.now() + MAX_WAIT_MS // 이 시각이 지나면 포기
        let isFirstAttempt = true // 첫 확인인지 (onWaiting을 한 번만 부르기 위함)
        while (Date.now() < waitDeadline) {
            // 닿으면 바로 끝 (처음부터 연결되어 있으면 onWaiting을 부르지 않음)
            if (await this.canReachProbeUrl()) return true

            // 첫 확인에서 닿지 않음 → 기다리기 시작했다고 알림
            if (isFirstAttempt) onWaiting()
            isFirstAttempt = false

            // 잠시 쉬었다가 다시 확인
            await new Promise((resolveAfterInterval) => setTimeout(resolveAfterInterval, RETRY_INTERVAL_MS))
        }

        // 최대 시간까지 연결되지 않음
        return false
    }
}
