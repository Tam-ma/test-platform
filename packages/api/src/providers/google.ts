import type { CompletionRequest, CompletionResult, LLMProvider, ProviderOptions } from './types'

/** Google Gemini (generativelanguage) provider. */
export class GoogleProvider implements LLMProvider {
  readonly name = 'google'

  constructor(private readonly opts: ProviderOptions) {
    if (!opts.apiKey) throw new Error('Google API key is required')
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const base = this.opts.baseURL ?? 'https://generativelanguage.googleapis.com'
    // Key goes in the x-goog-api-key header (current Gemini API auth; avoids
    // leaking the key in URLs/logs). encodeURIComponent guards the model segment.
    const res = await fetch(`${base}/v1beta/models/${encodeURIComponent(req.model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.opts.apiKey },
      body: JSON.stringify({
        contents: [
          { parts: [...(req.systemPrompt ? [{ text: req.systemPrompt }] : []), { text: req.prompt }] },
        ],
        generationConfig: {
          temperature: req.temperature ?? 0.7,
          maxOutputTokens: req.maxTokens ?? 4096,
        },
      }),
    })

    if (!res.ok) throw new Error(`Google API error: ${res.status} ${res.statusText}`)
    const data = (await res.json()) as any

    return {
      content: data.candidates?.[0]?.content?.parts?.[0]?.text ?? '',
      usage: {
        promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokens: data.usageMetadata?.totalTokenCount ?? 0,
      },
      model: req.model,
      finishReason: data.candidates?.[0]?.finishReason,
    }
  }
}
