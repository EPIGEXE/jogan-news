import { join } from 'node:path'
import { app, utilityProcess, type UtilityProcess } from 'electron'
import type { RunProgress } from '@shared/types'
import type {
  MainToWorker,
  WorkerMethod,
  WorkerParams,
  WorkerResult,
  WorkerToMain
} from '@shared/worker-protocol'
import type { LogFn, WorkerRpc } from '../services/ports'

// Worker(utilityProcess)를 띄우고 RPC로 부른다. Worker가 죽으면 잠시 뒤 다시 띄운다.

interface Pending {
  resolve(v: unknown): void
  reject(e: Error): void
}

const RESTART_DELAY_MS = 3000

export class WorkerClient implements WorkerRpc {
  private child: UtilityProcess | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private ready: Promise<void> = Promise.resolve()
  private stopping = false

  constructor(
    private readonly opts: {
      dbPath: string
      configDir: string
      getApiKey(): string | null
      onProgress(p: RunProgress): void
      onItemUpdated(itemId: number): void
      log: LogFn
    }
  ) {}

  start(): void {
    const child = utilityProcess.fork(join(import.meta.dirname, 'worker.js'), [], {
      serviceName: 'AINews Worker',
      stdio: 'pipe'
    })
    this.child = child
    child.stdout?.on('data', (d: Buffer) => process.stdout.write(`[worker] ${d}`))
    child.stderr?.on('data', (d: Buffer) => process.stderr.write(`[worker] ${d}`))

    this.ready = new Promise<void>((resolve) => {
      child.on('message', (msg: WorkerToMain) => {
        if (msg.type === 'ready') resolve()
        else this.handle(msg)
      })
    })
    child.on('exit', (code) => {
      this.child = null
      for (const p of this.pending.values()) p.reject(new Error('Worker가 종료됐습니다.'))
      this.pending.clear()
      if (this.stopping) return
      this.opts.log('worker-exit', `코드 ${code}, ${RESTART_DELAY_MS / 1000}초 뒤 다시 시작`)
      setTimeout(() => this.start(), RESTART_DELAY_MS)
    })
    this.post({
      type: 'init',
      dbPath: this.opts.dbPath,
      configDir: this.opts.configDir,
      apiKey: this.opts.getApiKey()
    })
  }

  stop(): void {
    this.stopping = true
    this.child?.kill()
  }

  setApiKey(apiKey: string | null): void {
    this.post({ type: 'set-api-key', apiKey })
  }

  async call<M extends WorkerMethod>(method: M, ...params: WorkerParams<M> extends undefined ? [] : [WorkerParams<M>]): Promise<WorkerResult<M>> {
    await this.ready
    const id = this.nextId++
    return new Promise<WorkerResult<M>>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.post({ type: 'rpc', id, method, params: params[0] })
    })
  }

  private post(msg: MainToWorker): void {
    if (!this.child) throw new Error('Worker가 실행 중이 아닙니다.')
    this.child.postMessage(msg)
  }

  private handle(msg: WorkerToMain): void {
    switch (msg.type) {
      case 'rpc-result': {
        const p = this.pending.get(msg.id)
        if (!p) return
        this.pending.delete(msg.id)
        if (msg.ok) p.resolve(msg.result)
        else p.reject(new Error(msg.error))
        break
      }
      case 'progress':
        this.opts.onProgress(msg.progress)
        break
      case 'item-updated':
        this.opts.onItemUpdated(msg.itemId)
        break
      case 'log':
        if (msg.level !== 'info') this.opts.log(`worker-${msg.level}`, msg.message)
        else if (!app.isPackaged) console.log(`[worker] ${msg.message}`)
        break
    }
  }
}
