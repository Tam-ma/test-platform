import type { CompletionRequest, CompletionResult, LLMProvider, TokenUsage } from './types'

export interface MockProviderOptions {
  /** Fixed response content; defaults to an echo of the prompt. */
  response?: string
  usage?: Partial<TokenUsage>
}

/**
 * Deterministic in-memory provider for tests and local development — no network,
 * no API key. Lets the benchmark pipeline run end-to-end before real keys exist.
 */
export class MockProvider implements LLMProvider {
  readonly name = 'mock'

  constructor(private readonly opts: MockProviderOptions = {}) {}

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const content = this.opts.response ?? `[mock:${req.model}] ${req.prompt}`
    const promptTokens = this.opts.usage?.promptTokens ?? Math.ceil(req.prompt.length / 4)
    const completionTokens = this.opts.usage?.completionTokens ?? Math.ceil(content.length / 4)
    return {
      content,
      usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
      model: req.model,
      finishReason: 'stop',
    }
  }
}
