// ============================================================================
// API 키 보관
//
// [역할]
// - 설정에서 입력한 Groq API 키를 암호화해 저장 · 읽기 · 삭제 (safeStorage, Windows 계정 단위 암호화)
// - 암호화한 키는 데이터 폴더의 groq-key.bin 파일에 보관
// - 쓸 키를 고르는 순서: 저장된 키가 먼저, 없으면 개발 중에만 프로젝트의 .env (설치판은 .env를 읽지 않음)
// - 저장된 파일을 풀 수 없으면 저장된 키가 없는 것으로 봄
// - 이 PC에서 암호화를 쓸 수 없으면 저장하지 않고 오류
// - 키가 어디서 왔는지와 끝 4자리 제공 (키 전체는 화면으로 보내지 않음)
// ============================================================================
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { parse } from 'dotenv'
import type { ApiKeyStatus } from '@shared/ipc'
import type { ApiKeyStore } from '../services/ports'

/**
 * Groq API 키 보관
 *
 * - 설정에서 입력한 키는 safeStorage(Windows 계정 단위 암호화)로 저장
 * - 개발 중에는 저장된 키가 없으면 프로젝트의 .env를 읽음
 */
export class SafeStorageKeyStore implements ApiKeyStore {
    private readonly keyPath = join(app.getPath('userData'), 'groq-key.bin') // 암호화한 키 파일

    // 암호화해 저장한 키 읽기 (파일이 없거나 풀 수 없으면 null)
    private readStored(): string | null {
        // 저장한 적이 없거나 이 PC에서 암호화를 쓸 수 없으면 없는 것으로 봄
        if (!existsSync(this.keyPath) || !safeStorage.isEncryptionAvailable()) return null

        // 파일을 풀어 키로 되돌림 (풀지 못하면 없는 것으로 봄)
        try {
            return safeStorage.decryptString(readFileSync(this.keyPath))
        } catch {
            return null
        }
    }

    // 개발용 .env의 키 읽기 (설치판에서는 읽지 않음)
    private readDevEnv(): string | null {
        // 설치판 → .env를 쓰지 않음
        if (app.isPackaged) return null

        // 프로젝트 폴더의 .env에서 GROQ_API_KEY 읽기 (파일이 없거나 값이 비어 있으면 null)
        const envPath = join(app.getAppPath(), '.env')
        if (!existsSync(envPath)) return null
        return parse(readFileSync(envPath)).GROQ_API_KEY?.trim() || null
    }

    // 쓸 키 읽기 (저장된 키가 먼저, 없으면 .env)
    getApiKey(): string | null {
        return this.readStored() ?? this.readDevEnv()
    }

    // 키가 어디서 왔는지와 끝 4자리 (get과 같은 순서로 찾음)
    getStatus(): ApiKeyStatus {
        // 설정에서 입력해 저장한 키
        const storedKey = this.readStored()
        if (storedKey) return { source: 'stored', hint: storedKey.slice(-4) }

        // 개발용 .env의 키
        const devEnvKey = this.readDevEnv()
        if (devEnvKey) return { source: 'env', hint: devEnvKey.slice(-4) }

        // 어디에도 없음
        return { source: 'none', hint: null }
    }

    /**
     * 키 저장 또는 삭제
     *
     * @param {string | null} apiKey - 저장할 키 (null이거나 비어 있으면 저장된 키 삭제)
     */
    setApiKey(apiKey: string | null): void {
        const trimmedKey = apiKey?.trim()

        // 키가 비어 있음 → 저장된 키 파일 삭제 (파일이 없어도 오류 없이 끝)
        if (!trimmedKey) {
            rmSync(this.keyPath, { force: true })
            return
        }

        // 암호화해 파일에 저장 (암호화를 쓸 수 없는 PC면 평문으로 남기지 않고 오류)
        if (!safeStorage.isEncryptionAvailable()) throw new Error('이 PC에서는 키를 암호화해 저장할 수 없습니다.')
        writeFileSync(this.keyPath, safeStorage.encryptString(trimmedKey))
    }
}
