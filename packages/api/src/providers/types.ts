/**
 * LLM provider abstraction — a small, Workers-compatible (fetch-based) interface
 * over chat/completion APIs. A provider is constructed with credentials; the
 * model is chosen per request. See registry.ts for the factory.
 *
 * NOTE: services/benchmark/model-interface.ts is an older, benchmark-specific
 * variant (generateCode). It should migrate onto this module when the benchmark
 * engine (Epic 4) is rebuilt — this is the canonical provider layer.
 */

export interface CompletionRequest {
  model: string
  prompt: string
  systemPrompt?: string
  maxTokens?: number
  temperature?: number
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface CompletionResult {
  content: string
  usage: TokenUsage
  model: string
  finishReason?: string
}

export interface ProviderOptions {
  apiKey: string
  /** Override the API base URL (gateways, proxies, OpenAI-compatible endpoints). */
  baseURL?: string
}

export interface LLMProvider {
  readonly name: string
  complete(request: CompletionRequest): Promise<CompletionResult>
}
