import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { parse } from 'dotenv'
import type { ApiKeyStatus } from '@shared/ipc'
import type { ApiKeyStore } from '../services/ports'

/**
 * Groq API 키 보관. 설정에서 입력한 키는 safeStorage(Windows 계정 단위 암호화)로 저장한다.
 * 개발 중에는 저장된 키가 없으면 프로젝트의 .env를 읽는다.
 */
export class SafeStorageKeyStore implements ApiKeyStore {
  private readonly keyPath = join(app.getPath('userData'), 'groq-key.bin')

  private readStored(): string | null {
    if (!existsSync(this.keyPath) || !safeStorage.isEncryptionAvailable()) return null
    try {
      return safeStorage.decryptString(readFileSync(this.keyPath))
    } catch {
      return null
    }
  }

  private readDevEnv(): string | null {
    if (app.isPackaged) return null
    const envPath = join(app.getAppPath(), '.env')
    if (!existsSync(envPath)) return null
    return parse(readFileSync(envPath)).GROQ_API_KEY?.trim() || null
  }

  get(): string | null {
    return this.readStored() ?? this.readDevEnv()
  }

  status(): ApiKeyStatus {
    const stored = this.readStored()
    if (stored) return { source: 'stored', hint: stored.slice(-4) }
    const env = this.readDevEnv()
    if (env) return { source: 'env', hint: env.slice(-4) }
    return { source: 'none', hint: null }
  }

  set(key: string | null): void {
    const trimmed = key?.trim()
    if (!trimmed) {
      rmSync(this.keyPath, { force: true })
      return
    }
    if (!safeStorage.isEncryptionAvailable()) throw new Error('이 PC에서는 키를 암호화해 저장할 수 없습니다.')
    writeFileSync(this.keyPath, safeStorage.encryptString(trimmed))
  }
}
