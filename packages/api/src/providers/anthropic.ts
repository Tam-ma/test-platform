import type { CompletionRequest, CompletionResult, LLMProvider, ProviderOptions } from './types'

/** Anthropic Messages API provider. */
export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic'

  constructor(private readonly opts: ProviderOptions) {
    if (!opts.apiKey) throw new Error('Anthropic API key is required')
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const res = await fetch(`${this.opts.baseURL ?? 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.opts.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens ?? 4096,
        temperature: req.temperature ?? 0.7,
        ...(req.systemPrompt ? { system: req.systemPrompt } : {}),
        messages: [{ role: 'user', content: req.prompt }],
      }),
    })

    if (!res.ok) throw new Error(`Anthropic API error: ${res.status} ${res.statusText}`)
    const data = (await res.json()) as any
    const inputTokens = data.usage?.input_tokens ?? 0
    const outputTokens = data.usage?.output_tokens ?? 0

    return {
      content: data.content?.[0]?.text ?? '',
      usage: {
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      model: data.model ?? req.model,
      finishReason: data.stop_reason,
    }
  }
}
