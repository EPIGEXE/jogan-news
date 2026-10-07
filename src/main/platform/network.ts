import { net } from 'electron'
import type { NetworkPort } from '../services/ports'

// 로그인 직후에는 Wi-Fi·VPN이 늦게 붙을 수 있다. 실제로 Groq 서버까지 닿는지 확인하며 기다린다 (DESIGN.md 4.2절).

const PROBE_URL = 'https://api.groq.com/openai/v1/models'
const RETRY_INTERVAL_MS = 30_000
const MAX_WAIT_MS = 5 * 60_000

export class ElectronNetwork implements NetworkPort {
  private async reachable(): Promise<boolean> {
    if (!net.isOnline()) return false
    try {
      const res = await net.fetch(PROBE_URL, { method: 'GET', signal: AbortSignal.timeout(10_000) })
      return res.status < 500 // 키 없이 부르므로 401이 정상
    } catch {
      return false
    }
  }

  async waitUntilOnline(onWaiting: () => void): Promise<boolean> {
    const deadline = Date.now() + MAX_WAIT_MS
    let first = true
    while (Date.now() < deadline) {
      if (await this.reachable()) return true
      if (first) onWaiting()
      first = false
      await new Promise((r) => setTimeout(r, RETRY_INTERVAL_MS))
    }
    return false
  }
}
