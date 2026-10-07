// Worker 진입점 (Electron utilityProcess). Main과 메시지로만 대화한다.

import type { MainToWorker, WorkerMethod, WorkerToMain } from '@shared/worker-protocol'
import { WorkerService } from './service'

const port = process.parentPort
let service: WorkerService | null = null

function send(msg: WorkerToMain): void {
  port.postMessage(msg)
}

const log = (level: 'info' | 'warn' | 'error', message: string) => send({ type: 'log', level, message })

async function handleRpc(id: number, method: WorkerMethod, params: unknown): Promise<void> {
  try {
    if (!service) throw new Error('Worker가 아직 초기화되지 않았습니다.')
    const fn = service[method] as (p: unknown) => unknown
    const result = await fn.call(service, params)
    send({ type: 'rpc-result', id, ok: true, result: result ?? null })
  } catch (err) {
    send({ type: 'rpc-result', id, ok: false, error: (err as Error).message })
  }
}

port.on('message', (e) => {
  const msg = e.data as MainToWorker
  switch (msg.type) {
    case 'init':
      try {
        service = new WorkerService({
          dbPath: msg.dbPath,
          configDir: msg.configDir,
          apiKey: msg.apiKey,
          onProgress: (progress) => send({ type: 'progress', progress }),
          onItemUpdated: (itemId) => send({ type: 'item-updated', itemId }),
          log
        })
        send({ type: 'ready' })
      } catch (err) {
        log('error', `Worker 초기화 실패: ${(err as Error).stack ?? (err as Error).message}`)
      }
      break
    case 'set-api-key':
      service?.setApiKey(msg.apiKey)
      break
    case 'rpc':
      void handleRpc(msg.id, msg.method, msg.params)
      break
  }
})

process.on('uncaughtException', (err) => log('error', `처리되지 않은 오류: ${err.stack ?? err.message}`))
process.on('unhandledRejection', (err) => log('error', `처리되지 않은 Promise 오류: ${String(err)}`))
