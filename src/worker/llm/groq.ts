// ============================================================================
// Groq 호출
//
// [역할]
// - Groq API 호출 계층 (어떤 역할에 어떤 모델을 쓸지는 호출하는 쪽이 정해서 넘김, DESIGN.md 7.6절)
// - JSON 호출: strict 구조화 출력으로 받고 zod로 한 번 더 검증
// - 스트리밍 호출: 답변 조각이 올 때마다 알리고, 끝나면 전체 답변과 사용량을 돌려줌
// - 추론 강도가 정해진 모델은 추론 내용을 응답에서 빼도록 요청 (모델 계열마다 옵션 이름이 다름)
// - 모델이 배열을 객체로 감싸 보내는 실수 보정 (Groq이 400으로 거절한 응답도 풀어서 쓸 수 있으면 살림)
// - 요청 실패 재시도는 groq-sdk에 맡김 (최대 3회, 요청당 제한 시간 60초)
// - 사용량 기록 · 토큰 상한 · 동시 호출 제한은 하지 않음 (llm/service.ts가 담당)
// ============================================================================
import Groq, { BadRequestError } from 'groq-sdk'
import type { ChatCompletionCreateParamsNonStreaming, ChatCompletionCreateParamsStreaming } from 'groq-sdk/resources/chat/completions'
import type { z } from 'zod'
import type { TokenUsage } from './pricing'

// 역할 하나에 쓸 모델 설정 (config/models.yaml의 한 항목)
export interface ModelSpec {
    model: string // Groq 모델 ID
    // 추론 강도. GPT-OSS: low | medium | high, Qwen: none | default | low | medium | high (없으면 추론 옵션을 보내지 않음)
    reasoningEffort?: 'none' | 'default' | 'low' | 'medium' | 'high'
    maxCompletionTokens: number // 출력 토큰 상한
}

// JSON 호출 한 번의 결과
export interface JsonCallResult<T> {
    data: T // 검증을 통과한 응답 값
    usage: TokenUsage // 토큰 사용량 (거절된 응답을 살린 경우는 알 수 없어 모두 0)
    latencyMs: number // 요청부터 응답까지 걸린 시간 (밀리초)
}

/**
 * Groq 클라이언트 생성
 *
 * @param {string} apiKey - Groq API 키
 * @returns {Groq} 실패한 요청을 최대 3회 다시 시도하고, 요청당 60초까지 기다리는 클라이언트
 */
export function createGroqClient(apiKey: string): Groq {
    return new Groq({ apiKey, maxRetries: 3, timeout: 60_000 })
}

// 추론 강도와 "추론 내용을 응답에서 빼기" 옵션 (추론 강도가 없는 모델 설정이면 빈 객체)
function reasoningParams(modelSpec: ModelSpec): Partial<ChatCompletionCreateParamsNonStreaming> {
    if (!modelSpec.reasoningEffort) return {}

    // GPT-OSS는 include_reasoning, Qwen 등은 reasoning_format으로 추론 내용을 응답에서 뺌
    const hideReasoningParams = modelSpec.model.startsWith('openai/gpt-oss')
        ? { include_reasoning: false }
        : { reasoning_format: 'hidden' as const }
    return { reasoning_effort: modelSpec.reasoningEffort, ...hideReasoningParams }
}

/**
 * JSON 호출 (strict json_schema 구조화 출력으로 받고 zod로 한 번 더 검증)
 *
 * - Groq이 형식 오류(400 json_validate_failed)로 거절해도, 거절된 응답을 풀어 검증을 통과하면 그 값을 씀
 *
 * @param {Groq} groq - Groq 클라이언트
 * @param {ModelSpec} modelSpec - 호출할 모델과 추론 강도 · 출력 상한
 * @param prompt - 시스템 프롬프트와 사용자 입력
 * @param outputSchema - 응답 형식 (LLM에 보내는 JSON 스키마와 검증용 zod)
 * @returns {Promise<JsonCallResult<T>>} 검증된 값 · 사용량 · 걸린 시간 (빈 응답이거나 검증에 실패하면 오류)
 */
export async function completeJson<T>(
    groq: Groq,
    modelSpec: ModelSpec,
    prompt: { system: string; user: string },
    outputSchema: { name: string; jsonSchema: Record<string, unknown>; zod: z.ZodType<T> }
): Promise<JsonCallResult<T>> {
    const startedAtMs = Date.now() // 걸린 시간 계산용

    // 구조화 출력으로 요청 (스키마에 맞는 JSON만 받도록 strict)
    const completionResponse = await groq.chat.completions
        .create({
            model: modelSpec.model,
            messages: [
                { role: 'system', content: prompt.system },
                { role: 'user', content: prompt.user }
            ],
            max_completion_tokens: modelSpec.maxCompletionTokens,
            response_format: {
                type: 'json_schema',
                json_schema: { name: outputSchema.name, strict: true, schema: outputSchema.jsonSchema }
            },
            ...reasoningParams(modelSpec)
        })
        .catch((requestError: unknown) => {
            // strict 모드에서 모델이 배열을 {items: [...]}로 감싸면 Groq이 400(json_validate_failed)을 줌
            // 응답에 실린 failed_generation을 풀어서 쓸 수 있으면 살림 (살릴 수 없으면 원래 오류를 그대로 던짐)
            const recoveredData = recoverFailedGeneration(requestError, outputSchema)
            if (recoveredData === undefined) throw requestError
            return { recovered: recoveredData }
        })

    // 거절된 응답을 살린 경우 → 그 값을 결과로 (이 경우 토큰 사용량은 알 수 없어 0으로 둠)
    if ('recovered' in completionResponse) {
        return {
            data: completionResponse.recovered,
            latencyMs: Date.now() - startedAtMs,
            usage: { input: 0, cachedInput: 0, output: 0, reasoning: 0 }
        }
    }

    // 정상 응답 → 내용을 꺼냄 (내용이 비었으면 끝난 이유와 함께 오류)
    const latencyMs = Date.now() - startedAtMs
    const responseContent = completionResponse.choices[0]?.message.content
    if (!responseContent) throw new Error(`빈 응답 (finish_reason=${completionResponse.choices[0]?.finish_reason})`)

    // 감싸진 배열을 풀고 zod로 검증 (맞지 않으면 여기서 오류)
    const validatedData = outputSchema.zod.parse(unwrapArrays(JSON.parse(responseContent), outputSchema.jsonSchema))

    // Groq이 알려 준 사용량을 TokenUsage 모양으로 옮김 (없는 값은 0)
    const completionUsage = completionResponse.usage
    return {
        data: validatedData,
        latencyMs,
        usage: {
            input: completionUsage?.prompt_tokens ?? 0,
            cachedInput: completionUsage?.prompt_tokens_details?.cached_tokens ?? 0,
            output: completionUsage?.completion_tokens ?? 0,
            reasoning: completionUsage?.completion_tokens_details?.reasoning_tokens ?? 0
        }
    }
}

// 대화의 한 마디
export interface ChatTurn {
    role: 'system' | 'user' | 'assistant' // 누구의 말인지 (시스템 프롬프트 · 사용자 · AI)
    content: string // 내용
}

/**
 * 스트리밍 호출
 *
 * - 글자가 올 때마다 onDelta를 부르고, 끝나면 전체 답과 사용량을 돌려줌
 *
 * @param {Groq} groq - Groq 클라이언트
 * @param {ModelSpec} modelSpec - 호출할 모델과 추론 강도 · 출력 상한
 * @param {ChatTurn[]} chatTurns - 보낼 대화
 * @param onDelta - 답변 조각이 올 때마다 부르는 함수
 * @returns 전체 답변(text) · 사용량 · 걸린 시간 (스트림에 오류가 실려 오면 오류)
 */
export async function streamChat(
    groq: Groq,
    modelSpec: ModelSpec,
    chatTurns: ChatTurn[],
    onDelta: (deltaText: string) => void
): Promise<{ text: string; usage: TokenUsage; latencyMs: number }> {
    const startedAtMs = Date.now() // 걸린 시간 계산용

    // 스트리밍 요청 준비
    // 추론 옵션은 비스트리밍 타입으로 만들어지므로, 스트리밍 요청 타입으로 합쳐서 넘김
    const streamingParams: ChatCompletionCreateParamsStreaming = {
        ...(reasoningParams(modelSpec) as Omit<ChatCompletionCreateParamsStreaming, 'model' | 'messages' | 'stream'>),
        model: modelSpec.model,
        messages: chatTurns,
        max_completion_tokens: modelSpec.maxCompletionTokens,
        stream: true
    }
    const completionStream = await groq.chat.completions.create(streamingParams)

    // 조각을 받는 대로 이어 붙이고 호출한 쪽에 알림
    let answerText = '' // 지금까지 받은 답변
    let streamUsage: Groq.CompletionUsage | null | undefined // 마지막 조각이 올 때까지는 비어 있음
    for await (const streamChunk of completionStream) {
        // 내용이 있는 조각만 붙임
        const deltaText = streamChunk.choices[0]?.delta.content
        if (deltaText) {
            answerText += deltaText
            onDelta(deltaText)
        }

        // 사용량은 마지막 조각의 x_groq.usage에 실려 옴
        streamUsage = streamChunk.x_groq?.usage ?? streamUsage

        // 스트림 도중 Groq이 오류를 실어 보내면 중단
        if (streamChunk.x_groq?.error) throw new Error(streamChunk.x_groq.error)
    }

    // 전체 답변과 사용량 반환 (사용량이 오지 않았으면 0)
    return {
        text: answerText,
        latencyMs: Date.now() - startedAtMs,
        usage: {
            input: streamUsage?.prompt_tokens ?? 0,
            cachedInput: streamUsage?.prompt_tokens_details?.cached_tokens ?? 0,
            output: streamUsage?.completion_tokens ?? 0,
            reasoning: streamUsage?.completion_tokens_details?.reasoning_tokens ?? 0
        }
    }
}

/**
 * 배열 자리에 객체로 감싸 온 값을 안의 배열로 풀기
 *
 * - 스키마가 배열을 기대하는 자리에 {items: [...]} 같은 객체 하나로 감싼 값이 오면 안의 배열로 바꿈
 * - gpt-oss가 strict 모드에서 자주 보이는 실수
 * - 스키마를 따라 배열의 원소와 객체의 속성까지 내려가며 같은 보정을 함
 *
 * @param {unknown} jsonValue - 모델이 보낸 값
 * @param jsonSchema - 그 자리에 기대하는 JSON 스키마
 * @returns {unknown} 보정한 값 (보정할 것이 없으면 받은 값 그대로)
 */
export function unwrapArrays(jsonValue: unknown, jsonSchema: Record<string, unknown>): unknown {
    // 배열을 기대하는 자리
    if (jsonSchema['type'] === 'array') {
        // 배열 대신 객체가 왔고 그 안에 배열인 값이 딱 하나면 그 배열로 바꿈 (둘 이상이면 어느 것인지 알 수 없어 그대로 둠)
        if (jsonValue && typeof jsonValue === 'object' && !Array.isArray(jsonValue)) {
            const arrayValues = Object.values(jsonValue).filter(Array.isArray)
            if (arrayValues.length === 1) jsonValue = arrayValues[0]
        }

        // 원소마다 원소 스키마로 같은 보정 (배열이 아니거나 원소 스키마가 없으면 그대로)
        const elementSchema = jsonSchema['items'] as Record<string, unknown> | undefined
        return Array.isArray(jsonValue) && elementSchema
            ? jsonValue.map((elementValue) => unwrapArrays(elementValue, elementSchema))
            : jsonValue
    }

    // 객체를 기대하는 자리에 객체가 옴 → 스키마에 있는 속성마다 같은 보정 (받은 객체는 고치지 않고 복사본을 만듦)
    if (jsonSchema['type'] === 'object' && jsonValue && typeof jsonValue === 'object' && !Array.isArray(jsonValue)) {
        const propertySchemas = (jsonSchema['properties'] ?? {}) as Record<string, Record<string, unknown>>
        const unwrappedObject: Record<string, unknown> = { ...(jsonValue as Record<string, unknown>) }
        for (const [propertyName, propertySchema] of Object.entries(propertySchemas))
            if (propertyName in unwrappedObject) unwrappedObject[propertyName] = unwrapArrays(unwrappedObject[propertyName], propertySchema)
        return unwrappedObject
    }

    // 그 밖(글자 · 숫자 등)은 그대로
    return jsonValue
}

// Groq이 형식 오류로 거절한 응답(failed_generation)을 풀어 검증을 통과하면 그 값을 돌려줌 (살릴 수 없으면 undefined)
function recoverFailedGeneration<T>(
    requestError: unknown,
    outputSchema: { jsonSchema: Record<string, unknown>; zod: z.ZodType<T> }
): T | undefined {
    // 400(잘못된 요청)이 아닌 오류는 살릴 것이 없음
    if (!(requestError instanceof BadRequestError)) return undefined

    // 형식 검증 실패(json_validate_failed)일 때만 모델이 실제로 보낸 글을 꺼냄
    const errorBody = requestError.error as { error?: { code?: string; failed_generation?: string } } | undefined
    const failedGeneration = errorBody?.error?.code === 'json_validate_failed' ? errorBody.error.failed_generation : undefined
    if (!failedGeneration) return undefined

    try {
        // 감싸진 배열을 풀고 검증 (통과하면 그 값, 아니면 살리지 못함)
        const parseResult = outputSchema.zod.safeParse(unwrapArrays(JSON.parse(failedGeneration), outputSchema.jsonSchema))
        return parseResult.success ? parseResult.data : undefined
    } catch {
        // JSON으로 읽을 수 없는 글
        return undefined
    }
}
