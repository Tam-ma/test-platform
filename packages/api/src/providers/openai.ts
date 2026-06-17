import type { CompletionRequest, CompletionResult, LLMProvider, ProviderOptions } from './types'

/** OpenAI Chat Completions provider (also works with OpenAI-compatible endpoints via baseURL). */
export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai'

  constructor(private readonly opts: ProviderOptions) {
    if (!opts.apiKey) throw new Error('OpenAI API key is required')
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const res = await fetch(`${this.opts.baseURL ?? 'https://api.openai.com'}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify({
        model: req.model,
        messages: [
          ...(req.systemPrompt ? [{ role: 'system', content: req.systemPrompt }] : []),
          { role: 'user', content: req.prompt },
        ],
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens ?? 4096,
      }),
    })

    if (!res.ok) throw new Error(`OpenAI API error: ${res.status} ${res.statusText}`)
    const data = (await res.json()) as any

    return {
      content: data.choices?.[0]?.message?.content ?? '',
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
      model: data.model ?? req.model,
      finishReason: data.choices?.[0]?.finish_reason,
    }
  }
}
